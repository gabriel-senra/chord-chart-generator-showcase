/**
 * Shared vocabulary for the whole project.
 *
 * These types are the contract between the three consumers: the renderers turn
 * them into SVG, the MCP server ships them to the model as `structuredContent`,
 * and the widget receives them over postMessage. Keep them JSON-clean — no
 * classes, no functions, nothing that won't survive a round trip.
 */

export type FrettedInstrument = "guitar" | "ukulele";
export type Instrument = FrettedInstrument | "piano";

/** One playable shape on a fretted instrument. */
export interface Voicing {
  /**
   * One entry per string, lowest-pitched string first. `-1` means muted,
   * `0` means open. Values are relative to `baseFret`, so a fret of `1` with a
   * `baseFret` of 5 sounds at the 5th fret.
   */
  frets: number[];
  /** Fretting-hand finger per string, 1–4; `0` means open or unplayed. */
  fingers: number[];
  /** Fret the diagram window starts at. `1` is an open-position chord. */
  baseFret: number;
  /** Barred frets, relative to `baseFret`. */
  barres: number[];
  /** MIDI note numbers actually sounding, low to high. */
  midi: number[];
}

/** Everything known about a chord symbol, independent of how it gets drawn. */
export interface ChordInfo {
  /** The symbol as the caller wrote it, e.g. `Am7`. */
  symbol: string;
  /** Normalised display name, e.g. `Am7` for input `Amin7`. */
  name: string;
  tonic: string;
  /** Slash-chord bass note, or `null` when the root is in the bass. */
  bass: string | null;
  /** Human-readable chord type, e.g. `minor seventh`. */
  type: string;
  quality: string;
  /** Pitch classes in chord order, e.g. `["A","C","E","G"]`. */
  notes: string[];
  /** Interval from the root for each note, e.g. `["1P","3m","5P","7m"]`. */
  intervals: string[];
  /** A plain close-position voicing as MIDI numbers — what the piano diagram draws. */
  keyboard: number[];
}

export interface ScaleInfo {
  name: string;
  tonic: string;
  type: string;
  notes: string[];
  intervals: string[];
  /** One octave as MIDI numbers, starting near middle C. */
  keyboard: number[];
  /** Scale degrees as roman numerals of the diatonic triads, when they exist. */
  triads: string[];
}

/** A fretted instrument's physical layout. */
export interface InstrumentSpec {
  name: FrettedInstrument;
  strings: number;
  /** How many frets a chord diagram shows at once. */
  fretsOnChord: number;
  /** Open-string pitches, lowest-pitched string first. */
  tuning: string[];
}
