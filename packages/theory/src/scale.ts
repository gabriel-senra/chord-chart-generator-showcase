import { Chord, Note, Scale } from "tonal";
import type { ScaleInfo } from "./types.ts";

export class UnknownScaleError extends Error {
  constructor(name: string) {
    super(
      `Could not parse "${name}" as a scale. Expected something like "C major", "E minor blues" or "F lydian".`,
    );
    this.name = "UnknownScaleError";
  }
}

/**
 * Build the chord on each scale degree by stacking thirds *within the scale*,
 * then ask tonal to name the result. Wrapping past the end of the array is what
 * makes the upper degrees come out right.
 *
 * Only meaningful for seven-note scales. Stacking thirds through a hexatonic
 * scale like the blues produces plausible-looking nonsense (`Gm/Bb` as the
 * chord on the fourth degree), so anything else returns nothing at all.
 */
function diatonicTriads(notes: string[]): string[] {
  if (notes.length !== 7) return [];
  return notes.map((_, degree) => {
    const triad = [0, 2, 4].map((step) => notes[(degree + step) % notes.length]);
    // tonal names a major triad `CM`; chord sheets write it `C`.
    return (Chord.detect(triad)[0] ?? "").replace(/M$/, "");
  });
}

export function getScale(name: string): ScaleInfo {
  const scale = Scale.get(name);
  if (scale.empty || !scale.tonic) throw new UnknownScaleError(name);

  // One octave, ascending from the tonic, plus the octave on top so the
  // keyboard diagram closes the shape the way a player would hear it.
  const keyboard: number[] = [];
  let previous = -Infinity;
  for (const note of [...scale.notes, scale.tonic]) {
    let pitch = Note.midi(`${note}4`);
    if (pitch === null) continue;
    while (pitch <= previous) pitch += 12;
    keyboard.push(pitch);
    previous = pitch;
  }

  return {
    name: scale.name,
    tonic: scale.tonic,
    type: scale.type,
    notes: scale.notes,
    intervals: scale.intervals,
    keyboard,
    triads: diatonicTriads(scale.notes),
  };
}

/**
 * Every position on the fretboard that belongs to the scale, as
 * `[stringIndex, fret]` pairs with string 0 being the lowest-pitched.
 * The fretboard diagram draws these directly.
 */
export function scaleFretboard(
  notes: string[],
  tuning: string[],
  frets: number,
): Array<{ string: number; fret: number; note: string; isTonic: boolean }> {
  const chromas = new Set(notes.map((n) => Note.chroma(n)));
  const tonicChroma = Note.chroma(notes[0]);
  const positions: Array<{ string: number; fret: number; note: string; isTonic: boolean }> = [];

  tuning.forEach((open, string) => {
    const openMidi = Note.midi(open);
    if (openMidi === null) return;
    for (let fret = 0; fret <= frets; fret++) {
      const chroma = (openMidi + fret) % 12;
      if (!chromas.has(chroma)) continue;
      positions.push({
        string,
        fret,
        // Spell the note the way the scale spells it, not how tonal defaults.
        note: notes.find((n) => Note.chroma(n) === chroma) ?? Note.fromMidi(openMidi + fret),
        isTonic: chroma === tonicChroma,
      });
    }
  });

  return positions;
}
