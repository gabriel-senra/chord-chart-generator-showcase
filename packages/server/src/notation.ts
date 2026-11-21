/**
 * Engraved staff notation and guitar tab, from ABC.
 *
 * ABC is the input format because the *model* writes it. Asking a language
 * model for MusicXML produces verbose, frequently malformed output; ABC is
 * compact, line-oriented, and something models emit reliably. abcjs then does
 * the engraving, which is far too intricate to reimplement.
 *
 * abcjs is a browser library, so it runs here against a jsdom document. That is
 * the one place this project departs from DOM-free rendering, and it is
 * contained entirely within this file.
 */

import { themeFor, type Theme } from "@music-ai/render";
import { rasteriseSvg } from "./raster.ts";
import type { RenderResult, ThemeName } from "./tools.ts";

interface AbcRuntime {
  // abcjs has no bundled types; the surface used here is small and checked at runtime.
  renderAbc: (target: string, abc: string, options: Record<string, unknown>) => AbcTune[];
  document: Document;
}

interface AbcTune {
  warnings?: string[];
  metaText?: Record<string, string>;
  getKeySignature?: () => { root?: string; mode?: string } | undefined;
  getMeterFraction?: () => { num?: number; den?: number } | undefined;
}

let runtime: AbcRuntime | null = null;

/**
 * Builds the jsdom document and loads abcjs against it, once per process.
 *
 * The globals have to be in place *before* abcjs is imported, because it reads
 * `window` at module scope — hence the dynamic import rather than a static one.
 */
async function ensureRuntime(): Promise<AbcRuntime> {
  if (runtime) return runtime;

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<!doctype html><body><div id="paper"></div></body>');

  // `navigator` is an accessor on Node's global object, so plain assignment
  // throws under ESM's strict mode. defineProperty works for all three.
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
    ["navigator", dom.window.navigator],
  ] as const) {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  }

  const imported = (await import("abcjs")) as unknown as { default?: unknown };
  const abcjs = (imported.default ?? imported) as { renderAbc: AbcRuntime["renderAbc"] };

  runtime = { renderAbc: abcjs.renderAbc, document: dom.window.document };
  return runtime;
}

/** abcjs marks up its warnings for HTML display; the model wants plain text. */
function stripMarkup(warning: string): string {
  return warning.replace(/<[^>]*>/g, "").trim();
}

export class InvalidNotationError extends Error {
  constructor(warnings: string[]) {
    super(
      `The ABC notation could not be engraved:\n${warnings.map((w) => `  • ${w}`).join("\n")}`,
    );
    this.name = "InvalidNotationError";
  }
}

/**
 * abcjs draws everything in `currentColor`, which resvg will not resolve on its
 * own. Swapping it for a concrete value themes the whole score in one pass and
 * costs nothing, since the colour appears only as an attribute value.
 */
function themeSvg(markup: string, theme: Theme): string {
  let svg = markup.replaceAll("currentColor", theme.ink);
  if (!svg.includes("xmlns=")) {
    svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // Painted behind everything so the PNG is never transparent-on-unknown.
  return svg.replace(
    /(<svg[^>]*>)/,
    `$1<rect x="0" y="0" width="100%" height="100%" fill="${theme.background}"/>`,
  );
}

/** abcjs reports modes as ABC's short codes; these are what a reader expects. */
const MODE_NAMES: Record<string, string> = {
  "": "major",
  maj: "major",
  m: "minor",
  min: "minor",
  dor: "dorian",
  phr: "phrygian",
  lyd: "lydian",
  mix: "mixolydian",
  loc: "locrian",
};

const modeName = (mode: string | undefined): string => MODE_NAMES[mode ?? ""] ?? mode ?? "major";

export interface RenderNotationInput {
  abc: string;
  showTab?: boolean;
  theme?: ThemeName;
  staffWidth?: number;
}

export async function renderNotation(input: RenderNotationInput): Promise<RenderResult> {
  const theme = themeFor(input.theme ?? "light");
  const { renderAbc, document } = await ensureRuntime();

  const paper = document.getElementById("paper");
  if (!paper) throw new Error("Notation runtime failed to initialise.");
  paper.innerHTML = "";

  const staffWidth = Math.min(Math.max(input.staffWidth ?? 620, 240), 1200);
  const tunes = renderAbc("paper", input.abc, {
    staffwidth: staffWidth,
    paddingtop: 10,
    paddingbottom: 16,
    paddingleft: 12,
    paddingright: 12,
    ...(input.showTab ? { tablature: [{ instrument: "guitar" }] } : {}),
  });

  const tune = tunes[0];
  const warnings = (tune?.warnings ?? []).map(stripMarkup).filter(Boolean);

  const svgElement = paper.querySelector("svg");
  if (!svgElement) throw new InvalidNotationError(warnings.length ? warnings : ["No music found."]);

  const svg = themeSvg(svgElement.outerHTML, theme);
  const image = rasteriseSvg(svg, theme.background);

  const meta = tune?.metaText ?? {};
  const key = tune?.getKeySignature?.();
  const meter = tune?.getMeterFraction?.();

  const mode = modeName(key?.mode);
  const descriptors = [
    meta.title ? `"${meta.title}"` : null,
    key?.root ? `key of ${key.root}${mode === "major" ? "" : ` ${mode}`}` : null,
    meter?.num && meter?.den ? `${meter.num}/${meter.den}` : null,
    input.showTab ? "with guitar tab" : null,
  ].filter(Boolean);

  const warningNote = warnings.length
    ? ` It engraved with warnings: ${warnings.join("; ")}.`
    : "";

  return {
    summary:
      `Engraved ${descriptors.length ? descriptors.join(", ") : "the notation"}.${warningNote}` +
      ` The score above is already shown to the user — talk about how to play it rather than` +
      ` restating the notes.`,
    structured: {
      kind: "notation",
      abc: input.abc,
      title: meta.title ?? null,
      composer: meta.composer ?? null,
      key: key?.root ?? null,
      mode: key?.root ? mode : null,
      meter: meter?.num && meter?.den ? `${meter.num}/${meter.den}` : null,
      showTab: Boolean(input.showTab),
      warnings,
      theme: theme.name,
    },
    // ~20 KB of path data. It belongs to the widget, not the model's context.
    meta: { "music-ai/svg": svg },
    image,
  };
}
