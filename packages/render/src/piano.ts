import { keyShape, line, place, text, type Drawing, type Theme } from "./svg.ts";

/**
 * The keys are butted edge to edge with no gap, no backing and no rounding
 * except at the keyboard's two outer bottom corners. That is the whole
 * difference between a keyboard and a row of pills: give each key its own
 * radius and its own margin and it stops belonging to the instrument.
 *
 * Nothing is drawn behind the keys either — the keyboard sits directly on
 * whatever the host is painting.
 */
const WHITE_WIDTH = 15;
const WHITE_HEIGHT = 52;
const BLACK_WIDTH = 8.6;
const BLACK_HEIGHT = 32;
/** Applied only where the keyboard meets the air, never between keys. */
const OUTER_RADIUS = 3;
const BLACK_RADIUS = 1.8;
const HAIRLINE = 1;

const LABEL_GAP = 13;
const LABEL_SIZE = 9.5;
const LABEL_BAND = LABEL_GAP + 2;

/** One white key of air on each side, so the chord is never flush to the edge. */
const EDGE_PADDING_KEYS = 1;
/** Below this the keyboard stops reading as a keyboard and becomes a barcode. */
const MIN_WHITE_KEYS = 8;

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const isBlackKey = (midi: number): boolean => BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);

const whiteAtOrBelow = (midi: number): number => (isBlackKey(midi) ? midi - 1 : midi);
const whiteAtOrAbove = (midi: number): number => (isBlackKey(midi) ? midi + 1 : midi);
const previousWhite = (midi: number): number => whiteAtOrBelow(midi - 1);
const nextWhite = (midi: number): number => whiteAtOrAbove(midi + 1);

function countWhites(start: number, end: number): number {
  let count = 0;
  for (let midi = start; midi <= end; midi++) if (!isBlackKey(midi)) count++;
  return count;
}

export interface Span {
  /** Always a white key, so no black key is ever cut in half at an edge. */
  start: number;
  end: number;
  whites: number;
}

/**
 * The narrowest keyboard that holds these notes comfortably.
 *
 * Both ends land on a white key: a black key straddles the boundary between
 * two whites, so starting or ending on one would slice it down the middle.
 * Callers that lay several keyboards out in a row pass the widest span they
 * saw back in as `minWhites`, which is what keeps a row of them aligned.
 */
export function keyboardSpan(notes: number[], minWhites = MIN_WHITE_KEYS): Span {
  const lowest = notes.length ? Math.min(...notes) : 60;
  const highest = notes.length ? Math.max(...notes) : 72;

  let start = whiteAtOrBelow(lowest);
  let end = whiteAtOrAbove(highest);
  for (let i = 0; i < EDGE_PADDING_KEYS; i++) {
    start = previousWhite(start);
    end = nextWhite(end);
  }

  // Grow outwards, top first, until the span is wide enough. Alternating keeps
  // the chord roughly centred instead of pinned to one end.
  let whites = countWhites(start, end);
  while (whites < minWhites) {
    if ((minWhites - whites) % 2 === 1) end = nextWhite(end);
    else start = previousWhite(start);
    whites++;
  }
  return { start, end, whites };
}

export interface KeyboardOptions {
  theme: Theme;
  /** MIDI notes to mark as sounding. */
  notes: number[];
  /**
   * The lowest sounding note — the root of a plain chord, the bass of a slash
   * chord. Every lit key is the same colour, so this only sets which label is
   * emphasised; it is the one note a player needs to find first.
   */
  root?: number;
  /**
   * Note names by MIDI number. Supplied by the caller rather than derived here,
   * so the diagram spells a chord the way theory does — `Ab`, not `G#`.
   */
  labels?: Record<number, string>;
  /** Widens the span to match sibling keyboards. See `keyboardSpan`. */
  minWhites?: number;
}

/**
 * A piano keyboard with the sounding keys filled edge to edge.
 *
 * Filling the whole key rather than dotting it is only possible because a lit
 * key gets its own colour: it no longer has to contrast with the key beneath
 * it, so a lit black key and a lit white key can look like the same thing,
 * which is what they are.
 */
export function renderKeyboard(options: KeyboardOptions): Drawing {
  const { theme, notes } = options;
  const sounding = new Set(notes);
  const showLabels = Boolean(options.labels);
  const span = keyboardSpan(notes, options.minWhites);
  const lastWhite = span.whites - 1;

  const whites: string[] = [];
  const blacks: string[] = [];
  const labels: string[] = [];

  let whiteIndex = 0;
  for (let midi = span.start; midi <= span.end; midi++) {
    const black = isBlackKey(midi);
    const lit = sounding.has(midi);

    // Each white key fills its whole slot; a black key straddles the boundary
    // between two slots, which is exactly `whiteIndex * WHITE_WIDTH` once the
    // white key to its left has been placed.
    const x = black ? whiteIndex * WHITE_WIDTH - BLACK_WIDTH / 2 : whiteIndex * WHITE_WIDTH;
    const width = black ? BLACK_WIDTH : WHITE_WIDTH;
    const fill = lit ? theme.keyLit : black ? theme.keyBlack : theme.keyWhite;

    if (black) {
      blacks.push(
        keyShape(x, 0, width, BLACK_HEIGHT, { fill, left: BLACK_RADIUS, right: BLACK_RADIUS }),
      );
    } else {
      whites.push(
        keyShape(x, 0, width, WHITE_HEIGHT, {
          fill,
          // Only the keyboard's outermost corners round off.
          left: whiteIndex === 0 ? OUTER_RADIUS : 0,
          right: whiteIndex === lastWhite ? OUTER_RADIUS : 0,
        }),
      );
    }

    const label = lit ? options.labels?.[midi] : undefined;
    if (label) {
      const isRoot = options.root !== undefined && midi === options.root;
      labels.push(
        text(label, x + width / 2, WHITE_HEIGHT + LABEL_GAP, {
          size: LABEL_SIZE,
          anchor: "middle",
          weight: isRoot ? 600 : 400,
          fill: isRoot ? theme.ink : theme.inkMuted,
        }),
      );
    }

    if (!black) whiteIndex++;
  }

  const width = span.whites * WHITE_WIDTH;

  // A divider at every boundary, including the ones a colour change already
  // marks. Drawing them only where they are strictly needed leaves a single
  // hairline stranded wherever two unlit keys happen to meet, which reads as a
  // rendering fault rather than as structure.
  const dividers: string[] = [];
  for (let i = 1; i <= lastWhite; i++) {
    dividers.push(line(i * WHITE_WIDTH, 0, i * WHITE_WIDTH, WHITE_HEIGHT, theme.keyOutline, HAIRLINE));
  }

  // No outline around the keyboard. Its edge is where the key fill stops, which
  // is why `keyWhite` is a shade off the page rather than pure white: a stroke
  // would draw a box around every chord, and a box around each chord is the one
  // thing this is not supposed to look like.
  return {
    content: [...whites, ...dividers, ...blacks, ...labels].join(""),
    width,
    height: WHITE_HEIGHT + (showLabels ? LABEL_BAND : 0),
  };
}

export interface ChordKeyboardOptions extends KeyboardOptions {
  /** Chord name, set in the host's own font above the keyboard. */
  name?: string;
  /** A roman numeral or degree, set small and muted opposite the name. */
  badge?: string | null;
}

const TITLE_SIZE = 15;
const TITLE_BAND = 23;

/**
 * One chord: its name, then its keyboard. No card, no surface, no border —
 * the keyboard is the object, and it sits in the host's own space.
 */
export function renderChordKeyboard(options: ChordKeyboardOptions): Drawing {
  const { theme } = options;
  const keyboard = renderKeyboard(options);
  const parts: string[] = [];
  let y = 0;

  if (options.name) {
    parts.push(text(options.name, 0, TITLE_SIZE, { size: TITLE_SIZE, weight: 600, fill: theme.ink }));
    if (options.badge) {
      parts.push(
        text(options.badge, keyboard.width, TITLE_SIZE - 1, {
          size: 11,
          anchor: "end",
          weight: 500,
          fill: theme.inkMuted,
        }),
      );
    }
    y = TITLE_BAND;
  }

  parts.push(place(keyboard, 0, y));

  return {
    content: parts.join(""),
    width: keyboard.width,
    height: y + keyboard.height,
  };
}
