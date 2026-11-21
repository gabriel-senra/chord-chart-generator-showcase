/**
 * The UI resource that hosts render inline.
 *
 * Tools point at `widgetUri()` through metadata; the host fetches the resource
 * once, caches it, and runs it in a sandboxed iframe. Everything the widget
 * needs is inside that one file — see `packages/widgets/build.ts`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `text/html+skybridge` is what OpenAI's own reference server ships, and
 * ChatGPT is the host with the mature widget implementation, so it wins the
 * default. The MCP Apps spec calls for `text/html;profile=mcp-app`; hosts that
 * insist on it can be served by setting `MUSIC_AI_WIDGET_MIME`.
 */
export const WIDGET_MIME = process.env.MUSIC_AI_WIDGET_MIME ?? "text/html+skybridge";

const WIDGET_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../widgets/dist/sheet.html",
);

interface Bundle {
  html: string;
  uri: string;
}

let cached: Bundle | null = null;

function load(): Bundle {
  if (cached) return cached;

  let html: string;
  try {
    html = readFileSync(WIDGET_PATH, "utf8");
  } catch {
    throw new Error(
      `Widget bundle missing at ${WIDGET_PATH}. Run \`npm run build\` before starting the server.`,
    );
  }

  // Hosts cache UI resources by URI and will happily keep serving a stale
  // widget forever. Hashing the contents into the URI means a rebuilt widget is
  // simply a different resource, so there is nothing stale to serve. OpenAI's
  // reference widgets hash their filenames for the same reason.
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 8);
  cached = { html, uri: `ui://music-ai/sheet-${hash}.html` };
  return cached;
}

export const widgetHtml = (): string => load().html;

/** Content-addressed, so it changes whenever the widget does. */
export const widgetUri = (): string => load().uri;

/**
 * Links a tool to the widget.
 *
 * `ui.resourceUri` is the MCP Apps standard; `openai/outputTemplate` is the
 * older Apps SDK spelling of the same thing. Emitting both is what lets one
 * server drive ChatGPT and MCP Apps hosts without branching.
 */
export function widgetMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: widgetUri(), visibility: ["model", "app"] },
    "openai/outputTemplate": widgetUri(),
    // Lets the widget call back into the server, which the transpose and
    // playback controls will need.
    "openai/widgetAccessible": true,
  };
}

/**
 * Resource metadata, attached both to the resource listing and to the body
 * returned by `resources/read`.
 *
 * The duplication is intentional: OpenAI's reference server repeats the same
 * `_meta` — `openai/outputTemplate` included — in all three places, and hosts
 * differ over which one they actually read.
 */
export function widgetResourceMeta(): Record<string, unknown> {
  // The bundle is fully self-contained and makes no network requests, so both
  // lists are empty by design. They are still declared rather than omitted:
  // ChatGPT reports a missing block as "Widget CSP is not set" and requires one
  // before an app can be submitted.
  const csp = { connect_domains: [] as string[], resource_domains: [] as string[] };

  // Only meaningful once the server has a stable public origin. App submission
  // requires it; developer-mode testing does not, so it stays optional.
  const domain = process.env.MUSIC_AI_WIDGET_DOMAIN;

  return {
    ...widgetMeta(),
    ui: {
      resourceUri: widgetUri(),
      // Asking for a border is asking the host to draw one container around
      // everything, which turns four chord cards into a single widget-shaped
      // blob. Declining it makes the iframe boundary invisible, so the cards
      // the widget draws are the only edges on screen and each one reads as
      // its own object — the same way the host's native cards do.
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: [] },
      ...(domain ? { domain } : {}),
    },
    "openai/widgetPrefersBorder": false,
    "openai/widgetDescription":
      "Chord diagrams, chord sheets, fretboard maps and engraved notation, drawn to scale.",
    "openai/widgetCSP": csp,
    ...(domain ? { "openai/widgetDomain": domain } : {}),
  };
}
