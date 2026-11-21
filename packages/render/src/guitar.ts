import type { Voicing } from "@music-ai/theory/types";
import { circle, line, rect, text, type Drawing, type Theme } from "./svg.ts";

const STRING_GAP = 16;
const FRET_GAP = 20;
const DOT_RADIUS = 6.5;
/**
 * Room on the left for the `5fr` position label, reserved on every box so a row
 * of them aligns. It has to clear a barre, which overhangs the outer string by
 * a dot radius.
 */
const LEFT_MARGIN = 25;
const RIGHT_MARGIN = 6;
const TITLE_HEIGHT = 20;
const MARKER_HEIGHT = 12;

export interface ChordBoxOptions {
  theme: Theme;
  /** Chord name drawn above the box. Omit for a bare diagram. */
  title?: string;
  /** Draw fretting-hand finger numbers inside the dots. */
  showFingers?: boolean;
  /** Minimum frets shown; grows automatically for a wide shape. */
  fretCount?: number;
}

/**
 * A single chord diagram: strings running vertically, frets horizontally, the
 * way every chord book since the 1920s has drawn it.
 *
 * `voicing.frets` is ordered lowest-pitched string first, so string 0 is drawn
 * on the left — matching how a right-handed player sees the neck.
 */
export function renderChordBox(voicing: Voicing, options: ChordBoxOptions): Drawing {
  const { theme, showFingers = true } = options;
  const strings = voicing.frets.length;

  // chords-db keeps fret numbers relative to baseFret, so the window only ever
  // needs to be as tall as the widest stretch in the shape.
  const highest = Math.max(0, ...voicing.frets);
  const fretCount = Math.max(options.fretCount ?? 4, highest);

  const boxWidth = (strings - 1) * STRING_GAP;
  const boxHeight = fretCount * FRET_GAP;
  const isOpenPosition = voicing.baseFret === 1;

  const titleBaseline = options.title ? 15 : 0;
  const markerY = (options.title ? TITLE_HEIGHT : 0) + MARKER_HEIGHT / 2;
  const top = (options.title ? TITLE_HEIGHT : 0) + MARKER_HEIGHT + 4;
  const bottom = top + boxHeight;

  const stringX = (index: number): number => LEFT_MARGIN + index * STRING_GAP;
  const fretY = (fret: number): number => top + (fret - 0.5) * FRET_GAP;

  const parts: string[] = [];

  if (options.title) {
    parts.push(
      text(options.title, LEFT_MARGIN + boxWidth / 2, titleBaseline, {
        size: 15,
        weight: "bold",
        anchor: "middle",
        fill: theme.ink,
      }),
    );
  }

  // Open and muted string markers, above the nut.
  voicing.frets.forEach((fret, index) => {
    if (fret > 0) return;
    const x = stringX(index);
    if (fret === 0) {
      parts.push(circle(x, markerY, 3.5, { stroke: theme.inkMuted, strokeWidth: 1.2 }));
    } else {
      const arm = 3.2;
      parts.push(
        line(x - arm, markerY - arm, x + arm, markerY + arm, theme.inkMuted, 1.2, "round"),
        line(x - arm, markerY + arm, x + arm, markerY - arm, theme.inkMuted, 1.2, "round"),
      );
    }
  });

  // Fret wires. The nut is drawn heavy, but only in open position — higher up
  // the neck the top of the box is just another fret.
  for (let fret = 0; fret <= fretCount; fret++) {
    const y = top + fret * FRET_GAP;
    const isNut = fret === 0 && isOpenPosition;
    parts.push(
      line(
        LEFT_MARGIN,
        y,
        LEFT_MARGIN + boxWidth,
        y,
        isNut ? theme.ink : theme.rule,
        isNut ? 4 : 1,
      ),
    );
  }

  for (let index = 0; index < strings; index++) {
    const x = stringX(index);
    parts.push(line(x, top, x, bottom, theme.rule, 1));
  }

  if (!isOpenPosition) {
    parts.push(
      text(`${voicing.baseFret}fr`, LEFT_MARGIN - DOT_RADIUS - 4, fretY(1), {
        size: 10,
        anchor: "end",
        baseline: "middle",
        fill: theme.inkMuted,
      }),
    );
  }

  // Barres are drawn as a single bar and suppress the individual dots beneath
  // them, so one finger reads as one mark.
  const barredFrets = new Set(voicing.barres);
  for (const barreFret of voicing.barres) {
    const covered = voicing.frets
      .map((fret, index) => (fret === barreFret ? index : -1))
      .filter((index) => index >= 0);
    if (covered.length < 2) continue;

    const from = stringX(covered[0]);
    const to = stringX(covered[covered.length - 1]);
    const y = fretY(barreFret);
    parts.push(
      rect(from - DOT_RADIUS, y - DOT_RADIUS, to - from + DOT_RADIUS * 2, DOT_RADIUS * 2, {
        fill: theme.dot,
        rx: DOT_RADIUS,
      }),
    );

    if (showFingers) {
      const finger = voicing.fingers[covered[0]];
      if (finger) {
        parts.push(
          text(String(finger), from, y, {
            size: 9,
            weight: "bold",
            anchor: "middle",
            baseline: "middle",
            fill: theme.onDot,
          }),
        );
      }
    }
  }

  voicing.frets.forEach((fret, index) => {
    if (fret <= 0 || barredFrets.has(fret)) return;
    const x = stringX(index);
    const y = fretY(fret);
    parts.push(circle(x, y, DOT_RADIUS, { fill: theme.dot }));

    const finger = voicing.fingers[index];
    if (showFingers && finger) {
      parts.push(
        text(String(finger), x, y, {
          size: 9,
          weight: "bold",
          anchor: "middle",
          baseline: "middle",
          fill: theme.onDot,
        }),
      );
    }
  });

  return {
    content: parts.join(""),
    width: LEFT_MARGIN + boxWidth + RIGHT_MARGIN,
    height: bottom + 4,
  };
}

/**
 * The tab-style shorthand for a shape, e.g. `x02010`. Frets above 9 are
 * bracketed so `10` cannot be misread as `1` then `0`.
 */
export function shapeToText(voicing: Voicing): string {
  return voicing.frets
    .map((fret) => {
      if (fret < 0) return "x";
      const absolute = fret === 0 ? 0 : fret + voicing.baseFret - 1;
      return absolute > 9 ? `(${absolute})` : String(absolute);
    })
    .join("");
}

export interface FretboardOptions {
  theme: Theme;
  tuning: string[];
  frets: number;
  positions: Array<{ string: number; fret: number; note: string; isTonic: boolean }>;
  title?: string;
}

/**
 * A horizontal neck diagram for scales — strings run left to right with the
 * lowest at the bottom, which is how tab and every fretboard chart is laid out.
 */
export function renderFretboard(options: FretboardOptions): Drawing {
  const { theme, tuning, frets, positions } = options;
  const stringCount = tuning.length;
  const fretWidth = 42;
  const stringGap = 20;
  const left = 26;
  const top = options.title ? 22 : 4;
  const openWidth = 24;

  const neckWidth = frets * fretWidth;
  const neckHeight = (stringCount - 1) * stringGap;
  const originX = left + openWidth;

  // Lowest-pitched string at the bottom.
  const stringY = (index: number): number => top + (stringCount - 1 - index) * stringGap;
  const fretX = (fret: number): number => originX + (fret - 0.5) * fretWidth;

  const parts: string[] = [];

  if (options.title) {
    parts.push(text(options.title, left, 14, { size: 14, weight: "bold", fill: theme.ink }));
  }

  // Inlay markers, drawn first so they sit behind the strings.
  for (const fret of [3, 5, 7, 9, 15, 17, 19, 21]) {
    if (fret > frets) continue;
    parts.push(circle(fretX(fret), top + neckHeight / 2, 4, { fill: theme.rule }));
  }
  if (frets >= 12) {
    for (const offset of [-1, 1]) {
      parts.push(
        circle(fretX(12), top + neckHeight / 2 + offset * stringGap, 4, { fill: theme.rule }),
      );
    }
  }

  for (let fret = 0; fret <= frets; fret++) {
    const x = originX + fret * fretWidth;
    const isNut = fret === 0;
    parts.push(
      line(x, top, x, top + neckHeight, isNut ? theme.ink : theme.rule, isNut ? 4 : 1),
    );
    if (fret > 0) {
      parts.push(
        text(String(fret), fretX(fret), top + neckHeight + 16, {
          size: 10,
          anchor: "middle",
          fill: theme.inkMuted,
        }),
      );
    }
  }

  tuning.forEach((open, index) => {
    const y = stringY(index);
    parts.push(line(originX, y, originX + neckWidth, y, theme.rule, 1));
    parts.push(
      text(open.replace(/\d/g, ""), left - 4, y, {
        size: 11,
        anchor: "end",
        baseline: "middle",
        fill: theme.inkMuted,
      }),
    );
  });

  for (const position of positions) {
    const y = stringY(position.string);
    // Open strings sit in the margin to the left of the nut.
    const x = position.fret === 0 ? originX - openWidth / 2 : fretX(position.fret);
    const fill = position.isTonic ? theme.accent : theme.dot;
    parts.push(circle(x, y, 8, { fill }));
    parts.push(
      text(position.note, x, y, {
        size: 8.5,
        weight: "bold",
        anchor: "middle",
        baseline: "middle",
        fill: position.isTonic ? theme.onAccent : theme.onDot,
      }),
    );
  }

  return {
    content: parts.join(""),
    width: originX + neckWidth + 8,
    height: top + neckHeight + 24,
  };
}
