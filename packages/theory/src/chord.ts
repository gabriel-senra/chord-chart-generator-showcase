import { Chord, Note, Progression } from "tonal";
import { lookupShapes } from "./db.ts";
import type { ChordInfo, FrettedInstrument, Voicing } from "./types.ts";

export class UnknownChordError extends Error {
  constructor(symbol: string) {
    super(
      `Could not parse "${symbol}" as a chord. Expected a symbol like Am7, Cmaj7, F#m, Bb13 or C/E.`,
    );
    this.name = "UnknownChordError";
  }
}

/**
 * Stack the chord tones upward from `startOctave`, each note placed at the
 * lowest octave that keeps it above the one before. That gives the close
 * position voicing a keyboard diagram wants, and it handles slash chords for
 * free because tonal already puts the bass note first.
 */
function voiceUpward(notes: string[], startOctave: number): number[] {
  const midi: number[] = [];
  let previous = -Infinity;
  for (const note of notes) {
    let pitch = Note.midi(`${note}${startOctave}`);
    if (pitch === null) continue;
    while (pitch <= previous) pitch += 12;
    midi.push(pitch);
    previous = pitch;
  }
  return midi;
}

export function getChord(symbol: string): ChordInfo {
  const chord = Chord.get(symbol);
  if (chord.empty || !chord.tonic) throw new UnknownChordError(symbol);

  return {
    symbol,
    name: chord.symbol || symbol,
    tonic: chord.tonic,
    bass: chord.bass || null,
    // tonal leaves `type` blank for a few chords (add9, maj13#11). Its aliases
    // are symbols rather than prose — `M13#11` reads worse than nothing next to
    // the chord name — so an unnamed type stays empty and callers omit it.
    type: chord.type,
    quality: chord.quality,
    notes: chord.notes,
    intervals: chord.intervals,
    keyboard: voiceUpward(chord.notes, 3),
  };
}

export interface ShapeOptions {
  instrument?: FrettedInstrument;
  /** How many alternative shapes to return. Open positions come first. */
  limit?: number;
}

/**
 * Playable shapes for a chord symbol. Returns `[]` when the shape library has
 * nothing for this chord — that is a normal outcome for exotic symbols, not an
 * error, and callers should still render the notes and keyboard.
 */
export function getShapes(symbol: string, options: ShapeOptions = {}): Voicing[] {
  const chord = Chord.get(symbol);
  if (chord.empty || !chord.tonic) throw new UnknownChordError(symbol);

  return lookupShapes({
    tonic: chord.tonic,
    aliases: chord.aliases,
    isMinor: chord.quality === "Minor",
    bass: chord.bass || null,
    instrument: options.instrument ?? "guitar",
    limit: options.limit,
  });
}

/** Splits a numeral into its degree (`IIm7` → `II`) and quality (`m7`). */
const NUMERAL = /^([IViv]+)(.*)$/;

/**
 * tonal spells every numeral in upper case with the quality appended — `IIm`,
 * `VIIdim`, `VIIm7b5`. Chord sheets expect case to carry the quality instead:
 * `ii`, `vii°`, `viiø7`. This converts one to the other.
 */
function conventionalNumeral(numeral: string): string {
  const match = NUMERAL.exec(numeral);
  if (!match) return numeral;
  const [, degree, quality] = match;

  if (quality.startsWith("dim")) return `${degree.toLowerCase()}°${quality.slice(3)}`;
  if (quality === "aug") return `${degree}+`;
  if (quality.startsWith("m") && !quality.startsWith("maj")) {
    const rest = quality.slice(1);
    if (rest === "7b5") return `${degree.toLowerCase()}ø7`;
    return degree.toLowerCase() + rest;
  }
  return degree + quality;
}

/**
 * Roman numeral analysis of a progression, e.g. `["C","Am","F","G"]` in C
 * becomes `["I","vi","IV","V"]`. Returns `null` when no key is supplied or when
 * any chord falls outside it, since a partial analysis is worse than none.
 */
export function romanNumerals(chords: string[], key: string | null): string[] | null {
  if (!key) return null;
  try {
    const numerals = Progression.toRomanNumerals(key, chords);
    if (numerals.some((n) => !n)) return null;
    return numerals.map(conventionalNumeral);
  } catch {
    return null;
  }
}

/**
 * Transpose a chord symbol by an interval, e.g. `("Am7", "2M")` gives `Bm7`.
 * Used by the capo and transpose controls.
 */
export function transposeChord(symbol: string, interval: string): string {
  return Chord.transpose(symbol, interval);
}
