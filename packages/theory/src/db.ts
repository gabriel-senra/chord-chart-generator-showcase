/**
 * Access to the chords-db shape library.
 *
 * Kept in its own module because the JSON is several megabytes. Only the server
 * ever loads this — the widget receives already-resolved voicings, so it must
 * never reach past `@music-ai/theory/types`.
 */

import { createRequire } from "node:module";
import { Note } from "tonal";
import type { FrettedInstrument, InstrumentSpec, Voicing } from "./types.ts";

const require = createRequire(import.meta.url);

interface DbPosition {
  frets: number[];
  fingers: number[];
  baseFret?: number;
  barres?: number[];
  capo?: boolean;
  midi: number[];
}

interface DbChord {
  key: string;
  suffix: string;
  positions: DbPosition[];
}

interface Db {
  main: { strings: number; fretsOnChord: number; name: string };
  keys: string[];
  suffixes: string[];
  chords: Record<string, DbChord[]>;
}

const DBS: Record<FrettedInstrument, Db> = {
  guitar: require("@tombatossals/chords-db/lib/guitar.json"),
  ukulele: require("@tombatossals/chords-db/lib/ukulele.json"),
};

/**
 * chords-db carries no tuning information, so the open strings live here.
 * Lowest-pitched string first, matching the order of `Voicing.frets`.
 */
const TUNINGS: Record<FrettedInstrument, string[]> = {
  guitar: ["E2", "A2", "D3", "G3", "B3", "E4"],
  // Standard re-entrant ukulele: the 4th string sounds *above* the 3rd.
  ukulele: ["G4", "C4", "E4", "A4"],
};

export function instrumentSpec(instrument: FrettedInstrument): InstrumentSpec {
  const db = DBS[instrument];
  return {
    name: instrument,
    strings: db.main.strings,
    fretsOnChord: db.main.fretsOnChord,
    tuning: TUNINGS[instrument],
  };
}

/**
 * The `chords` object is keyed with `#` spelled out (`Csharp`), while the
 * `keys` array uses the symbol (`C#`). And the two instruments disagree about
 * spelling: guitar indexes sharps, ukulele indexes flats. Matching on chroma
 * sidesteps all of it.
 */
function findKey(db: Db, note: string): string | null {
  const chroma = Note.chroma(note);
  if (chroma === undefined) return null;
  return db.keys.find((k) => Note.chroma(k) === chroma) ?? null;
}

const objectKey = (key: string): string => key.replace("#", "sharp");

/**
 * tonal's chord aliases already line up with most chords-db suffixes (`m7`,
 * `maj7`, `sus4`, `13`). These are the handful that don't: tonal spells plain
 * triads as `""`/`"M"`/`"m"`, chords-db as `"major"`/`"minor"`.
 */
const SUFFIX_ALIASES: Record<string, string> = {
  "": "major",
  M: "major",
  "^": "major",
  maj: "major",
  m: "minor",
  min: "minor",
  "-": "minor",
  "°": "dim",
  o: "dim",
  "°7": "dim7",
  o7: "dim7",
  ø: "m7b5",
  h: "m7b5",
  h7: "m7b5",
  "+": "aug",
};

/**
 * Pick the chords-db suffix for a chord.
 *
 * `aliases` comes from tonal and is tried in order, so the most idiomatic
 * spelling wins. For slash chords chords-db uses dedicated `/E` and `m/E`
 * suffixes, which are matched on the bass note's chroma rather than spelling.
 */
function findSuffix(
  db: Db,
  entries: DbChord[],
  aliases: string[],
  isMinor: boolean,
  bass: string | null,
): string | null {
  const available = new Set(entries.map((e) => e.suffix));

  if (bass) {
    const bassChroma = Note.chroma(bass);
    const prefix = isMinor ? "m/" : "/";
    for (const suffix of available) {
      if (!suffix.startsWith(prefix)) continue;
      if (Note.chroma(suffix.slice(prefix.length)) === bassChroma) return suffix;
    }
    // No dedicated slash shape — fall through to the plain triad below.
  }

  for (const alias of aliases) {
    const mapped = SUFFIX_ALIASES[alias] ?? alias;
    if (available.has(mapped)) return mapped;
  }
  return null;
}

export interface ShapeQuery {
  tonic: string;
  /** tonal's alias list for the chord type, most idiomatic first. */
  aliases: string[];
  isMinor: boolean;
  bass: string | null;
  instrument: FrettedInstrument;
  /** Cap on how many shapes to return; open positions come first. */
  limit?: number;
}

/**
 * Look up playable shapes for a chord, or return `[]` when the library has
 * none. Callers must handle the empty case — chords-db is broad but not total,
 * and an exotic symbol should still render its notes and keyboard diagram.
 */
export function lookupShapes(query: ShapeQuery): Voicing[] {
  const db = DBS[query.instrument];
  const key = findKey(db, query.tonic);
  if (!key) return [];

  const entries = db.chords[objectKey(key)];
  if (!entries) return [];

  const suffix = findSuffix(db, entries, query.aliases, query.isMinor, query.bass);
  if (!suffix) return [];

  const entry = entries.find((e) => e.suffix === suffix);
  if (!entry) return [];

  return entry.positions.slice(0, query.limit ?? 4).map((p) => ({
    frets: p.frets,
    fingers: p.fingers,
    baseFret: p.baseFret ?? 1,
    barres: p.barres ?? [],
    midi: p.midi,
  }));
}
