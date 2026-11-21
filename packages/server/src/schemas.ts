/**
 * Output schemas for the tools.
 *
 * ChatGPT's app settings flags every tool without one as "Output schema
 * recommended", and hosts use the schema to decide what to hand the widget as
 * `toolOutput`. They also serve as an executable spec for the contract between
 * the server and the widget — the SDK validates every result against them, so a
 * payload change that would silently blank the widget fails loudly instead.
 *
 * Keep these in step with `serialiseChord` and `serialiseVoicing` in tools.ts.
 */

import { z } from "zod";

const THEME = z.enum(["light", "dark"]);

/** Mirrors `ChordInfo` plus the player-facing interval spellings. */
const CHORD = z.object({
  symbol: z.string(),
  name: z.string(),
  tonic: z.string(),
  bass: z.string().nullable(),
  type: z.string(),
  quality: z.string(),
  notes: z.array(z.string()),
  intervals: z.array(z.string()),
  intervalsShorthand: z.array(z.string()),
  keyboard: z.array(z.number()),
});

/** Mirrors `Voicing` plus which instrument it is for and its tab shorthand. */
const VOICING = z.object({
  frets: z.array(z.number()),
  fingers: z.array(z.number()),
  baseFret: z.number(),
  barres: z.array(z.number()),
  midi: z.array(z.number()),
  instrument: z.string(),
  tab: z.string(),
});

export const CHORD_OUTPUT = {
  kind: z.literal("chord"),
  chord: CHORD,
  shapes: z.array(VOICING),
  instruments: z.array(z.string()),
  theme: THEME,
};

export const PROGRESSION_OUTPUT = {
  kind: z.literal("progression"),
  title: z.string().nullable(),
  key: z.string().nullable(),
  instrument: z.string(),
  theme: THEME,
  entries: z.array(
    z.object({
      chord: CHORD,
      numeral: z.string().nullable(),
      shape: VOICING.nullable(),
    }),
  ),
};

export const SCALE_OUTPUT = {
  kind: z.literal("scale"),
  scale: z.object({
    name: z.string(),
    tonic: z.string(),
    type: z.string(),
    notes: z.array(z.string()),
    intervals: z.array(z.string()),
    intervalsShorthand: z.array(z.string()),
    keyboard: z.array(z.number()),
    triads: z.array(z.string()),
  }),
  title: z.string(),
  instrument: z.string(),
  frets: z.number(),
  tuning: z.array(z.string()),
  positions: z.array(
    z.object({
      string: z.number(),
      fret: z.number(),
      note: z.string(),
      isTonic: z.boolean(),
    }),
  ),
  theme: THEME,
};

export const NOTATION_OUTPUT = {
  kind: z.literal("notation"),
  abc: z.string(),
  title: z.string().nullable(),
  composer: z.string().nullable(),
  key: z.string().nullable(),
  mode: z.string().nullable(),
  meter: z.string().nullable(),
  showTab: z.boolean(),
  warnings: z.array(z.string()),
  theme: THEME,
};
