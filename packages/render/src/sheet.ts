import type { ChordInfo, Instrument, Voicing } from "@music-ai/theory/types";
import { renderChordBox, shapeToText } from "./guitar.ts";
import { keyboardSpan, renderChordKeyboard } from "./piano.ts";
import { line, place, text, type Drawing, type Theme } from "./svg.ts";

/**
 * `3m` → `b3`, `5d` → `b5`, `13M` → `13`. tonal's interval names encode the
 * quality as a trailing letter; players read the alteration as a prefix.
 */
export function formatInterval(interval: string): string {
  const match = /^(\d+)([PMmdA]+)$/.exec(interval);
  if (!match) return interval;
  const [, rawDegree, quality] = match;
  // An inversion puts the root an octave up, which tonal calls `8P`. Players
  // read that as the root, so a slash chord spells `1 3 5`, not `3 5 8`.
  const degree = rawDegree === "8" ? "1" : rawDegree;
  if (quality === "P" || quality === "M") return degree;
  if (quality === "m" || quality.startsWith("d")) return `b${degree}`;
  if (quality.startsWith("A")) return `#${degree}`;
  return degree;
}

/** Pairs each chord tone with the MIDI note the keyboard should mark. */
function keyboardLabels(chord: ChordInfo): Record<number, string> {
  const labels: Record<number, string> = {};
  chord.keyboard.forEach((midi, index) => {
    const note = chord.notes[index];
    if (note) labels[midi] = note;
  });
  return labels;
}

export interface ChordCardOptions {
  theme: Theme;
  /** Which diagrams to draw, in order. */
  instruments?: Instrument[];
  /** Alternative fretted shapes to show. */
  maxShapes?: number;
}

/**
 * One chord, explained: its spelling and intervals, several playable shapes,
 * and where it sits on a keyboard. This is the `render_chord` view.
 */
export function renderChordCard(
  chord: ChordInfo,
  shapes: Voicing[],
  options: ChordCardOptions,
): Drawing {
  const { theme, maxShapes = 3 } = options;
  const instruments = options.instruments ?? ["guitar", "piano"];
  const parts: string[] = [];
  let y = 0;
  let width = 0;

  parts.push(text(chord.name, 0, 24, { size: 26, weight: 600, fill: theme.ink }));
  // The rule sits below the title's descenders and above the description's
  // ascenders — 33 clears a 26pt face, 47 is the next baseline down.
  const ruleY = 33;
  y = 47;

  const spelling = chord.notes.join(" · ");
  const intervals = chord.intervals.map(formatInterval).join(" ");
  const description = [chord.type, spelling, intervals].filter(Boolean).join("   |   ");
  parts.push(text(description, 0, y, { size: 11.5, fill: theme.inkMuted }));
  y += 10;
  // Rough advance width — good enough to keep the rule from ending mid-text.
  width = Math.max(width, description.length * 5.6, 180);

  const shown = shapes.slice(0, maxShapes);
  const fretted = instruments.filter((i) => i !== "piano");

  if (fretted.length && shown.length) {
    y += 8;
    let x = 0;
    let tallest = 0;
    shown.forEach((voicing, index) => {
      const box = renderChordBox(voicing, {
        theme,
        title: index === 0 ? chord.name : undefined,
        showFingers: true,
      });
      parts.push(place(box, x, y));
      parts.push(
        text(shapeToText(voicing), x + box.width / 2, y + box.height + 12, {
          size: 9.5,
          anchor: "middle",
          fill: theme.inkMuted,
        }),
      );
      x += box.width + 22;
      tallest = Math.max(tallest, box.height + 18);
    });
    width = Math.max(width, x - 22);
    y += tallest + 14;
  } else if (fretted.length) {
    parts.push(
      text("No stock shape for this chord — see the keyboard below.", 0, y + 12, {
        size: 11,
        italic: true,
        fill: theme.inkMuted,
      }),
    );
    y += 24;
  }

  if (instruments.includes("piano")) {
    // No name here: the chord is already titled at the top of this view, and
    // repeating it reads as a second, unrelated chord.
    const keyboard = renderChordKeyboard({
      theme,
      notes: chord.keyboard,
      root: chord.keyboard[0],
      labels: keyboardLabels(chord),
    });
    parts.push(place(keyboard, 0, y));
    width = Math.max(width, keyboard.width);
    y += keyboard.height;
  }

  // Inserted after the title, but only now that the true content width is known.
  parts.splice(1, 0, line(0, ruleY, width, ruleY, theme.rule, 1));

  return { content: parts.join(""), width, height: y };
}

export interface SheetEntry {
  chord: ChordInfo;
  shapes: Voicing[];
  /** Roman numeral for this degree, when the sheet has a key. */
  numeral?: string | null;
}

export interface SheetOptions {
  theme: Theme;
  title?: string;
  /** Key the progression is analysed in, e.g. `C` or `A minor`. */
  key?: string | null;
  /** One instrument per sheet — real chord sheets do not mix them. */
  instrument?: Instrument;
  /** Chords per line. Defaults to something sane for the instrument. */
  perLine?: number;
}

/** Height reserved above a fretted cell for its roman numeral. */
const NUMERAL_BAND = 14;

/**
 * Lays cells out left to right, wrapping, with every cell padded to a common
 * box. Uniform columns are most of what makes a page of diagrams read as one
 * sheet rather than a pile.
 */
function grid(cells: Drawing[], columns: number, columnGap: number, rowGap: number): Drawing {
  const cellWidth = Math.max(0, ...cells.map((c) => c.width));
  const cellHeight = Math.max(0, ...cells.map((c) => c.height));
  const cols = Math.min(columns, Math.max(1, cells.length));

  const parts = cells.map((cell, index) =>
    place(
      cell,
      // Centre each cell in its column so a narrow diagram next to a wide one
      // still shares a common axis.
      (index % cols) * (cellWidth + columnGap) + (cellWidth - cell.width) / 2,
      Math.floor(index / cols) * (cellHeight + rowGap),
    ),
  );

  const rows = Math.ceil(cells.length / cols);
  return {
    content: parts.join(""),
    width: cols * cellWidth + (cols - 1) * columnGap,
    height: Math.max(0, rows * (cellHeight + rowGap) - rowGap),
  };
}

/** A fretted diagram with its roman numeral set above it. */
function frettedCell(entry: SheetEntry, theme: Theme, showNumerals: boolean): Drawing {
  const voicing = entry.shapes[0];
  const box: Drawing = voicing
    ? renderChordBox(voicing, { theme, title: entry.chord.name, showFingers: true })
    : {
        // Keep the grid intact when a shape is missing: the name still needs a slot.
        content:
          text(entry.chord.name, 40, 15, { size: 15, weight: 600, anchor: "middle", fill: theme.ink }) +
          text("no shape", 40, 60, {
            size: 10,
            anchor: "middle",
            italic: true,
            fill: theme.inkMuted,
          }),
        width: 80,
        height: 128,
      };

  if (!showNumerals) return box;
  const numeral = entry.numeral
    ? text(entry.numeral, box.width / 2, 10, {
        size: 11,
        anchor: "middle",
        weight: 600,
        fill: theme.accent,
      })
    : "";
  return {
    content: numeral + place(box, 0, NUMERAL_BAND),
    width: box.width,
    height: box.height + NUMERAL_BAND,
  };
}

/**
 * Every keyboard in a row is drawn to the widest span any of them needs, so
 * they are identical widths and their keys line up column for column across
 * the row. Keyboards that are almost the same width look like a mistake.
 */
function chordKeyboards(entries: SheetEntry[], theme: Theme): Drawing[] {
  const whites = Math.max(
    0,
    ...entries.map((entry) => keyboardSpan(entry.chord.keyboard).whites),
  );
  return entries.map((entry) =>
    renderChordKeyboard({
      theme,
      name: entry.chord.name,
      badge: entry.numeral,
      notes: entry.chord.keyboard,
      root: entry.chord.keyboard[0],
      labels: keyboardLabels(entry.chord),
      minWhites: whites,
    }),
  );
}

/**
 * A progression laid out as a chord sheet: a heading, then a grid of diagrams
 * in playing order.
 *
 * On piano each chord is a bare keyboard carrying its own name and
 * numeral, sitting directly on the host's background. On fretted instruments
 * the diagrams sit under a rule, as before.
 */
export function renderProgressionSheet(entries: SheetEntry[], options: SheetOptions): Drawing {
  const { theme } = options;
  const instrument = options.instrument ?? "guitar";
  const isPiano = instrument === "piano";
  const perLine = options.perLine ?? (isPiano ? 2 : 4);
  const showNumerals = entries.some((e) => e.numeral);

  const cells = isPiano
    ? chordKeyboards(entries, theme)
    : entries.map((entry) => frettedCell(entry, theme, showNumerals));
  // Nothing boxes these keyboards in, so the gap between them is the only
  // thing keeping one chord from running into the next.
  const body = grid(cells, perLine, isPiano ? 30 : 18, isPiano ? 26 : 22);

  const parts: string[] = [];
  let y = 0;

  if (options.title) {
    parts.push(text(options.title, 0, 20, { size: 20, weight: 600, fill: theme.ink }));
    y = 28;
  }

  const subtitle = [
    options.key ? `Key of ${options.key}` : null,
    entries.map((e) => e.chord.name).join("  –  "),
  ]
    .filter(Boolean)
    .join("   ·   ");
  parts.push(text(subtitle, 0, y + 11, { size: 11.5, fill: theme.inkMuted }));
  y += 20;

  // Bare keyboards need no rule above them to be told apart; the fretted sheet
  // still wants one.
  if (!isPiano) {
    parts.push(line(0, y, body.width, y, theme.rule, 1));
    y += 18;
  } else {
    y += 10;
  }

  parts.push(place(body, 0, y));

  return { content: parts.join(""), width: body.width, height: y + body.height };
}
