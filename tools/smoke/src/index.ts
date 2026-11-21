/**
 * End-to-end check of the MCP server over a real stdio transport.
 *
 * Speaks the actual protocol rather than calling the handlers directly, so it
 * catches the things unit tests miss: schema registration, content block shapes,
 * transport framing, and whether the PNG survives base64 round-tripping.
 *
 * Run with `npm run smoke`. Images land in `preview/smoke/` for inspection.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = join(ROOT, "preview", "smoke");
/** Content-hashed by the server, so it is discovered rather than hard-coded. */
let WIDGET_URI = "";

interface Case {
  slug: string;
  tool: string;
  args: Record<string, unknown>;
  /** Set when the call is meant to fail, so a clean error counts as a pass. */
  expectError?: boolean;
}

const CASES: Case[] = [
  { slug: "chord-am7", tool: "render_chord", args: { symbol: "Am7" } },
  {
    slug: "chord-c-slash-e-piano",
    tool: "render_chord",
    args: { symbol: "C/E", instruments: ["piano"], theme: "dark" },
  },
  {
    slug: "prog-four-chords",
    tool: "render_chord_progression",
    args: { chords: ["C", "G", "Am", "F"], key: "C", title: "The Four Chords" },
  },
  {
    slug: "prog-uke-dark",
    tool: "render_chord_progression",
    args: { chords: ["F", "C", "Dm", "Bb"], key: "F", instrument: "ukulele", theme: "dark" },
  },
  { slug: "scale-e-minor-pent", tool: "render_scale", args: { scale: "E minor pentatonic" } },
  {
    slug: "notation-twinkle",
    tool: "render_notation",
    args: {
      abc: 'X:1\nT:Twinkle, Twinkle\nC:Trad.\nM:4/4\nL:1/4\nK:C\n"C"C C "F"G G | "C"A A "G7"G2 | "F"F F "C"E E | "G7"D D "C"C2 |]',
    },
  },
  {
    slug: "notation-riff-tab",
    tool: "render_notation",
    args: {
      abc: 'X:1\nT:Em riff\nM:4/4\nL:1/8\nK:Em\n"Em"E2 G2 B2 e2 | "D"d4 B4 |]',
      showTab: true,
      theme: "dark",
    },
  },
  // The model will mistype chords; a clear error beats a stack trace.
  { slug: "bad-chord", tool: "render_chord", args: { symbol: "Hmaj9" }, expectError: true },
];

/**
 * Runs the built widget against a payload the server actually produced.
 *
 * This is the contract most likely to rot: the server reshapes
 * `structuredContent` and the widget silently draws nothing. Rendering it in a
 * real DOM and looking for an `<svg>` catches that immediately.
 */
async function renderInWidget(
  html: string,
  data: unknown,
  meta: Record<string, unknown>,
): Promise<string> {
  const { JSDOM } = await import("jsdom");
  // jsdom does not execute ES modules, and the shipped widget uses
  // `type="module"` so the browser defers it past the host's global injection.
  // Downgrading the tag here exercises the same bundle; module-vs-classic is a
  // load-timing concern in real hosts, not a rendering one.
  const dom = new JSDOM(html.replace('<script type="module">', "<script>"), {
    runScripts: "dangerously",
    // Seeded before the bundle executes, so the widget's preview host sees it.
    beforeParse(window) {
      (window as unknown as Record<string, unknown>).__MUSIC_AI_PREVIEW__ = {
        theme: "light",
        data,
        meta,
      };
    },
  });
  const output = dom.window.document.getElementById("sheet")?.innerHTML ?? "";
  dom.window.close();
  return output;
}

let failures = 0;

function check(condition: unknown, message: string): void {
  if (condition) return;
  console.error(`  ✗ ${message}`);
  failures++;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "packages/server/src/stdio.ts")],
  });
  const client = new Client({ name: "music-ai-smoke", version: "0.1.0" });
  await client.connect(transport);

  const { resources } = await client.listResources();
  const widget = resources.find((r) => r.uri.startsWith("ui://music-ai/sheet"));
  check(Boolean(widget), "no ui://music-ai/sheet resource is registered");
  WIDGET_URI = widget?.uri ?? "";
  check(
    /^ui:\/\/music-ai\/sheet-[0-9a-f]{8}\.html$/.test(WIDGET_URI),
    `widget URI must be content-hashed for cache busting, got "${WIDGET_URI}"`,
  );

  const { tools } = await client.listTools();
  console.log(`Connected. ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  check(tools.length === 4, "expected 4 registered tools");
  for (const tool of tools) {
    check(
      (tool.description?.length ?? 0) > 120,
      `${tool.name} needs a description that tells the model when to call it`,
    );
    // Both spellings must be present or the widget renders in only one host.
    const meta = (tool._meta ?? {}) as Record<string, any>;
    check(
      meta.ui?.resourceUri === WIDGET_URI,
      `${tool.name} is missing _meta.ui.resourceUri (MCP Apps hosts)`,
    );
    check(
      meta["openai/outputTemplate"] === WIDGET_URI,
      `${tool.name} is missing openai/outputTemplate (ChatGPT)`,
    );
  }

  const read = await client.readResource({ uri: WIDGET_URI });
  // Resource contents are text-or-blob; the widget must arrive as text.
  const body = read.contents[0] as { mimeType?: string; text?: string } | undefined;
  const html = String(body?.text ?? "");
  check(html.startsWith("<!doctype html>"), "widget resource is not an HTML document");
  check(
    !/(?:src|href)\s*=\s*["']https?:\/\//i.test(html),
    "widget references external URLs and will be blocked by the host CSP",
  );
  console.log(
    `Widget resource: ${(html.length / 1024).toFixed(1)} KB, mime ${String(body?.mimeType)}\n`,
  );

  for (const testCase of CASES) {
    const result = await client.callTool({ name: testCase.tool, arguments: testCase.args });
    const content = (result.content ?? []) as Array<Record<string, any>>;
    const text = content.find((block) => block.type === "text");
    const image = content.find((block) => block.type === "image");

    if (testCase.expectError) {
      console.log(`${testCase.slug}: ${result.isError ? "rejected as expected" : "NOT REJECTED"}`);
      check(result.isError, `${testCase.slug} should have failed`);
      check(
        typeof text?.text === "string" && text.text.includes("chord"),
        `${testCase.slug} error should explain what a valid chord looks like`,
      );
      if (result.isError) console.log(`  → ${text?.text}\n`);
      continue;
    }

    check(!result.isError, `${testCase.slug} returned an error: ${text?.text}`);
    check(Boolean(text?.text), `${testCase.slug} has no text summary`);
    check(Boolean(image?.data), `${testCase.slug} has no image block`);
    check(image?.mimeType === "image/png", `${testCase.slug} image is not a PNG`);
    check(Boolean(result.structuredContent), `${testCase.slug} has no structuredContent`);

    // ChatGPT delivers `toolOutput: null` to widgets today, so the payload is
    // mirrored into _meta. Losing this mirror silently blanks the widget.
    const meta = (result._meta ?? {}) as Record<string, unknown>;
    check(
      JSON.stringify(meta["music-ai/payload"]) === JSON.stringify(result.structuredContent),
      `${testCase.slug} _meta["music-ai/payload"] must mirror structuredContent`,
    );

    // Notation is too bulky for structuredContent, so it travels in _meta,
    // which hosts forward to the widget but never show the model.
    if (testCase.tool === "render_notation") {
      const svg = (result._meta as Record<string, unknown> | undefined)?.["music-ai/svg"];
      check(
        typeof svg === "string" && svg.includes("<svg"),
        `${testCase.slug} should carry engraved SVG in _meta for the widget`,
      );
    }

    if (image?.data) {
      const png = Buffer.from(image.data, "base64");
      // PNG magic number — proves the base64 survived the transport intact.
      check(png.subarray(1, 4).toString() === "PNG", `${testCase.slug} is not a valid PNG`);
      writeFileSync(join(OUT_DIR, `${testCase.slug}.png`), png);
      console.log(`${testCase.slug}: ${(png.length / 1024).toFixed(0)} KB PNG`);
    }

    const drawn = await renderInWidget(
      html,
      result.structuredContent,
      (result._meta ?? {}) as Record<string, unknown>,
    );
    check(
      drawn.includes("<svg"),
      `${testCase.slug} produced no SVG in the widget — server payload and widget disagree`,
    );

    console.log(`  → ${text?.text}\n`);
  }

  await client.close();

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`All checks passed. Images in ${OUT_DIR}`);
}

await main();
