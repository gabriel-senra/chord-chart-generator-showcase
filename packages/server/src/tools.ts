/**
 * The rendering tools, independent of transport.
 *
 * Each handler returns the same triple: a `summary` for the model to read and
 * paraphrase, `structured` data the host can hand to a widget, and an `image`
 * that renders in every MCP client today. `server.ts` packages them; nothing in
 * here knows about MCP.
 */

import {
  formatInterval,
  renderChordCard,
  renderFretboard,
  renderProgressionSheet,
  shapeToText,
  themeFor,
  type Theme,
} from "@music-ai/render";
import {
  getChord,
  getScale,
  getShapes,
  instrumentSpec,
  romanNumerals,
  scaleFretboard,
  type ChordInfo,
  type FrettedInstrument,
  type Instrument,
  type Voicing,
} from "@music-ai/theory";
import { rasterise, type RenderedImage } from "./raster.ts";

export interface RenderResult {
  summary: string;
  structured: Record<string, unknown>;
  image: RenderedImage;
  /**
   * Extra payload for the widget, attached to the tool result's `_meta`.
   * Hosts forward it to the iframe but never show it to the model, which is
   * where anything too bulky for `structuredContent` belongs.
   */
  meta?: Record<string, unknown>;
}

export type ThemeName = "light" | "dark";

const isFretted = (instrument: Instrument): instrument is FrettedInstrument =>
  instrument === "guitar" || instrument === "ukulele";

/**
 * The serialised shapes below are supersets of `ChordInfo` and `Voicing` rather
 * than reshaped views of them. That is what lets the widget feed
 * `structuredContent` straight into the renderers with no translation layer —
 * and it means the model and the widget are always looking at the same data.
 */
function serialiseChord(chord: ChordInfo) {
  return {
    ...chord,
    /** Player-facing interval names: `1 b3 5 b7` rather than `1P 3m 5P 7m`. */
    intervalsShorthand: chord.intervals.map(formatInterval),
  };
}

function serialiseVoicing(voicing: Voicing, instrument: FrettedInstrument) {
  return { ...voicing, instrument, tab: shapeToText(voicing) };
}

/** `Am7 — minor seventh. Notes A C E G (1 b3 5 b7).` */
function describeChord(chord: ChordInfo): string {
  const head = chord.type ? `${chord.name} — ${chord.type}.` : `${chord.name}.`;
  const intervals = chord.intervals.map(formatInterval).join(" ");
  return `${head} Notes ${chord.notes.join(" ")} (${intervals}).`;
}

export interface RenderChordInput {
  symbol: string;
  instruments?: Instrument[];
  shapes?: number;
  theme?: ThemeName;
}

export function renderChord(input: RenderChordInput): RenderResult {
  const theme: Theme = themeFor(input.theme ?? "light");
  const instruments: Instrument[] = input.instruments?.length
    ? input.instruments
    : ["guitar", "piano"];
  const limit = Math.min(Math.max(input.shapes ?? 3, 1), 5);

  const chord = getChord(input.symbol);
  const frettedInstrument = instruments.find(isFretted);
  const voicings = frettedInstrument
    ? getShapes(input.symbol, { instrument: frettedInstrument, limit })
    : [];

  const drawing = renderChordCard(chord, voicings, { theme, instruments, maxShapes: limit });

  const shapeText = voicings.length
    ? ` ${frettedInstrument} shapes: ${voicings
        .map((v) => (v.baseFret > 1 ? `${shapeToText(v)} (${v.baseFret}fr)` : shapeToText(v)))
        .join(", ")}.`
    : frettedInstrument
      ? ` No stock ${frettedInstrument} shape for this chord; the keyboard diagram shows the notes.`
      : "";

  return {
    summary: `${describeChord(chord)}${shapeText} The diagram above is already shown to the user — describe it, don't re-list it.`,
    structured: {
      kind: "chord",
      chord: serialiseChord(chord),
      shapes: frettedInstrument
        ? voicings.map((v) => serialiseVoicing(v, frettedInstrument))
        : [],
      instruments,
      theme: theme.name,
    },
    image: rasterise(drawing, theme),
  };
}

export interface RenderProgressionInput {
  chords: string[];
  key?: string;
  title?: string;
  instrument?: Instrument;
  theme?: ThemeName;
}

export function renderProgression(input: RenderProgressionInput): RenderResult {
  const theme: Theme = themeFor(input.theme ?? "light");
  const instrument: Instrument = input.instrument ?? "guitar";
  const key = input.key ?? null;

  const chords = input.chords.map(getChord);
  const numerals = romanNumerals(input.chords, key);

  const entries = chords.map((chord, index) => ({
    chord,
    shapes: isFretted(instrument) ? getShapes(input.chords[index], { instrument, limit: 1 }) : [],
    numeral: numerals?.[index] ?? null,
  }));

  const drawing = renderProgressionSheet(entries, {
    theme,
    title: input.title,
    key,
    instrument,
  });

  const analysis = numerals
    ? ` In ${key} that is ${numerals.join(" – ")}.`
    : key
      ? ` Not all of these belong to ${key}, so it is shown without roman numerals.`
      : "";
  const missing = entries.filter((e) => isFretted(instrument) && !e.shapes.length);
  const missingNote = missing.length
    ? ` No stock ${instrument} shape for ${missing.map((e) => e.chord.name).join(", ")}.`
    : "";

  return {
    summary:
      `Chord sheet for ${input.chords.join(" – ")} on ${instrument}.${analysis}${missingNote}` +
      ` The sheet above is already shown to the user — talk about how to play it, don't re-list the chords.`,
    structured: {
      kind: "progression",
      title: input.title ?? null,
      key,
      instrument,
      theme: theme.name,
      entries: entries.map((entry) => ({
        chord: serialiseChord(entry.chord),
        numeral: entry.numeral,
        shape:
          entry.shapes[0] && isFretted(instrument)
            ? serialiseVoicing(entry.shapes[0], instrument)
            : null,
      })),
    },
    image: rasterise(drawing, theme),
  };
}

export interface RenderScaleInput {
  scale: string;
  instrument?: FrettedInstrument;
  frets?: number;
  theme?: ThemeName;
}

export function renderScale(input: RenderScaleInput): RenderResult {
  const theme: Theme = themeFor(input.theme ?? "light");
  const instrument = input.instrument ?? "guitar";
  const frets = Math.min(Math.max(input.frets ?? 12, 4), 22);

  const scale = getScale(input.scale);
  const spec = instrumentSpec(instrument);
  const positions = scaleFretboard(scale.notes, spec.tuning, frets);

  const drawing = renderFretboard({
    theme,
    tuning: spec.tuning,
    frets,
    positions,
    title: `${scale.name} — ${scale.notes.join(" ")}`,
  });

  const chords = scale.triads.length
    ? ` Chords that fit: ${scale.triads.join(", ")}.`
    : " (Diatonic chords are only meaningful for seven-note scales, so none are listed.)";

  return {
    summary:
      `${scale.name}: ${scale.notes.join(" ")} (${scale.intervals.map(formatInterval).join(" ")}).` +
      `${chords} The fretboard above shows every position through fret ${frets}, with the tonic highlighted.`,
    structured: {
      kind: "scale",
      scale: { ...scale, intervalsShorthand: scale.intervals.map(formatInterval) },
      title: `${scale.name} — ${scale.notes.join(" ")}`,
      instrument,
      frets,
      tuning: spec.tuning,
      positions,
      theme: theme.name,
    },
    image: rasterise(drawing, theme),
  };
}
