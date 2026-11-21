/**
 * The sheet widget.
 *
 * Receives a tool's `structuredContent` from whichever host it is running in
 * and draws it with the same renderers the server uses for its PNG fallback.
 * Because those renderers emit SVG strings and pull in no runtime dependencies,
 * the whole bundle stays small enough to inline under a `default-src 'none'`
 * policy — which is the constraint that shaped this design.
 */

import {
  frame,
  renderChordCard,
  renderFretboard,
  renderProgressionSheet,
  type Drawing,
  type Theme,
} from "@music-ai/render";
import { connect, type HostState } from "./bridge.ts";
import { hostTheme } from "./tokens.ts";

/** Server payloads are structurally the renderers' inputs; see `serialiseChord`. */
type Payload = Record<string, any>;

/** Engraved scores ride in `_meta` so their bulk never reaches the model. */
const SVG_META_KEY = "music-ai/svg";

const root = document.getElementById("sheet")!;

/**
 * A chord box is about 120 units wide and a keyboard about 150 plus its gap.
 * Fitting the columns to the pane the host actually gave us is the main thing
 * the widget does that a static image cannot.
 */
function columnsFor(width: number | undefined, instrument: string): number {
  const cell = instrument === "piano" ? 180 : 122;
  if (!width) return 4;
  return Math.max(1, Math.min(6, Math.floor((width - 16) / cell)));
}

function draw(payload: Payload, theme: Theme, width?: number): Drawing | null {
  switch (payload.kind) {
    case "chord":
      return renderChordCard(payload.chord, payload.shapes ?? [], {
        theme,
        instruments: payload.instruments,
      });

    case "progression":
      return renderProgressionSheet(
        (payload.entries ?? []).map((entry: Payload) => ({
          chord: entry.chord,
          shapes: entry.shape ? [entry.shape] : [],
          numeral: entry.numeral,
        })),
        {
          theme,
          title: payload.title ?? undefined,
          key: payload.key,
          instrument: payload.instrument,
          perLine: columnsFor(width, payload.instrument),
        },
      );

    case "scale":
      return renderFretboard({
        theme,
        tuning: payload.tuning,
        frets: payload.frets,
        positions: payload.positions,
        title: payload.title,
      });

    default:
      return null;
  }
}

function message(text: string, theme: Theme): string {
  return `<p class="note" style="color:${theme.inkMuted}">${text}</p>`;
}

function render(state: HostState): void {
  const theme = hostTheme(state.theme);
  document.body.style.colorScheme = state.theme;
  const payload = state.data as Payload | undefined;

  if (!payload || typeof payload !== "object") {
    root.innerHTML = message("Waiting for a chord to draw…", theme);
    return;
  }

  // Notation is engraved server-side by abcjs; the widget's job is to scale it.
  if (payload.kind === "notation") {
    const svg = state.meta?.[SVG_META_KEY];
    root.innerHTML =
      typeof svg === "string"
        ? svg
        : message("This score is shown as an image above.", theme);
    return;
  }

  const drawing = draw(payload, theme, state.width);
  root.innerHTML = drawing
    ? // Capped at one unit per pixel. The diagrams were sized to sit in the
      // host's own space, and stretching them to fill a wide pane would scale
      // the hairlines and type right back out of agreement with it.
      frame(drawing, theme, { padding: 8, capToNaturalWidth: true })
    : message(`Nothing to draw for "${String(payload.kind)}".`, theme);
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** How long to wait before assuming no host is going to send anything. */
const DIAGNOSTIC_DELAY_MS = 13000;

const host = connect();
let received = false;

host.subscribe((state) => {
  if (state.data) received = true;
  try {
    render(state);
  } catch (error) {
    const theme = hostTheme(state.theme);
    root.innerHTML = message(
      `Could not draw this: ${error instanceof Error ? error.message : String(error)}`,
      theme,
    );
  }
});

/**
 * A widget that renders nothing tells you nothing. If no payload has arrived by
 * now, show what the bridge actually saw — which host was detected, what the
 * runtime exposed — so a silent failure becomes a readable one.
 */
window.setTimeout(() => {
  if (received) return;
  root.innerHTML =
    `<pre class="diag">No data arrived from the host after ${DIAGNOSTIC_DELAY_MS / 1000}s.\n\n` +
    `${escapeHtml(host.describe())}</pre>`;
}, DIAGNOSTIC_DELAY_MS);
