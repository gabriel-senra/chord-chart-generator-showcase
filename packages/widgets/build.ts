/**
 * Bundles the widget into one self-contained HTML file.
 *
 * MCP Apps hosts serve UI resources under `default-src 'none'` unless a server
 * explicitly requests otherwise, so the output may not reference a single
 * external URL — no CDN, no font file, no stylesheet. Everything is inlined
 * here, and `assertSelfContained` fails the build if anything slips in.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "dist");

/** Above this the host's fetch of the resource starts to feel slow. */
const SIZE_BUDGET_KB = 120;

const CSS = `
  :root { color-scheme: light dark; }
  html, body {
    margin: 0;
    padding: 0;
    /* Transparent on purpose, and the server no longer asks the host for a
       border. With no frame of its own the iframe boundary is invisible, so
       the cards drawn inside become the visual unit — which is the only way a
       row of chords can read as a row rather than as one panel. */
    background: transparent;
    font: 13px/1.5 'OpenAI Sans', 'Söhne', ui-sans-serif, system-ui, -apple-system,
          'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  #sheet { display: block; width: 100%; overflow-x: auto; }
  #sheet svg { display: block; width: 100%; height: auto; }
  .note { margin: 0; padding: 16px; font-style: italic; }
  .diag {
    margin: 0; padding: 14px; white-space: pre-wrap; word-break: break-word;
    font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    opacity: 0.75;
  }
`;

function assertSelfContained(html: string): void {
  // Any absolute URL in the output would be blocked by the host's CSP at
  // runtime, which shows up as a silently broken widget rather than an error.
  const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi);
  if (external) {
    throw new Error(`Widget references external resources:\n  ${external.join("\n  ")}`);
  }
}

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [join(HERE, "src/main.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    write: false,
    legalComments: "none",
  });

  const script = result.outputFiles[0].text;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chord sheet</title>
<style>${CSS}</style>
</head>
<body>
<div id="sheet"></div>
<!-- A module script, matching OpenAI's reference widgets. Modules are deferred
     until after parsing, so the host has finished injecting its globals by the
     time this runs; a classic inline script executes mid-parse and can miss them. -->
<script type="module">${script}</script>
</body>
</html>
`;

  assertSelfContained(html);

  const sizeKb = Buffer.byteLength(html) / 1024;
  if (sizeKb > SIZE_BUDGET_KB) {
    throw new Error(`Widget is ${sizeKb.toFixed(0)} KB, over the ${SIZE_BUDGET_KB} KB budget.`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "sheet.html"), html);
  console.log(`Built dist/sheet.html — ${sizeKb.toFixed(1)} KB, self-contained.`);
}

await main();
