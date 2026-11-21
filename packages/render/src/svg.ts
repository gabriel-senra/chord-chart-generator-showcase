/**
 * SVG plumbing shared by every renderer.
 *
 * Everything here emits plain strings — no DOM, no SVG.js, nothing that needs a
 * browser. That is deliberate: the exact same code runs in the widget iframe and
 * inside the server when it rasterises a PNG fallback, so the two can never
 * drift apart.
 */

/** A block of SVG markup drawn from its own (0,0) origin, plus its extent. */
export interface Drawing {
  content: string;
  width: number;
  height: number;
}

export interface Theme {
  name: "light" | "dark";
  /** Page background. */
  background: string;
  /**
   * The family every piece of text inherits. Set once on the `<svg>` root by
   * `frame`, so a host that knows its own UI font can swap the whole diagram
   * over by replacing this one string.
   */
  font: string;
  /** Staff lines, fret wires, note heads — the primary mark colour. */
  ink: string;
  /** Labels that should recede: string names, fret numbers, intervals. */
  inkMuted: string;
  /** Hairlines and grids. */
  rule: string;
  /** Highlight colour: lit keys, the tonic, roman numerals. */
  accent: string;
  /** Text drawn on top of `accent`. */
  onAccent: string;
  /** Fretted-note dots. */
  dot: string;
  /** Text drawn on top of `dot`. */
  onDot: string;
  /**
   * The hairline between one white key and the next. Purely internal: nothing
   * is stroked around the outside of a keyboard, so this divides keys without
   * ever drawing a box around the chord.
   */
  keyOutline: string;
  /**
   * Unpressed white keys. A shade off the page rather than pure white, because
   * with no outline the only thing marking the keyboard's edge is where this
   * fill stops.
   */
  keyWhite: string;
  /** Unpressed black keys. */
  keyBlack: string;
  /**
   * A key that is sounding, filled edge to edge. Deliberately *not* derived
   * from `ink`: it has to read against both the white and the black keys it
   * replaces, in both themes, which is a different job from contrasting the
   * page.
   */
  keyLit: string;
}

/**
 * Concrete family names rather than `system-ui`, because the PNG path renders
 * through resvg, which resolves against installed fonts and does not understand
 * the CSS generic keywords. The widget overrides this with a UI stack.
 */
export const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";

export const lightTheme: Theme = {
  name: "light",
  background: "#ffffff",
  font: SANS,
  ink: "#0d0d0d",
  inkMuted: "#8f8f8f",
  rule: "#e3e3e3",
  accent: "#0285ff",
  onAccent: "#ffffff",
  dot: "#0d0d0d",
  onDot: "#ffffff",
  keyOutline: "#d9d9d9",
  keyWhite: "#f1f1f2",
  keyBlack: "#2e2e2e",
  keyLit: "#0285ff",
};

export const darkTheme: Theme = {
  name: "dark",
  background: "#212121",
  font: SANS,
  ink: "#ececec",
  inkMuted: "#9b9b9b",
  rule: "#3a3a3a",
  accent: "#4da3ff",
  onAccent: "#0b1a2b",
  dot: "#ececec",
  onDot: "#212121",
  keyOutline: "#a6a6a6",
  keyWhite: "#dcdcdc",
  keyBlack: "#333333",
  keyLit: "#4da3ff",
};

export const themeFor = (name: "light" | "dark"): Theme =>
  name === "dark" ? darkTheme : lightTheme;

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Trims float noise so the output diffs cleanly and stays small. */
const n = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");

interface TextOptions {
  size?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  weight?: number | "bold" | "normal";
  family?: string;
  italic?: boolean;
  /** Shifts the baseline; `"middle"` centres text on `y`. */
  baseline?: "middle" | "auto";
  opacity?: number;
}

export function text(value: string, x: number, y: number, options: TextOptions = {}): string {
  // No `font-family` unless one is asked for: text inherits the family `frame`
  // sets on the root, which is the single knob a host swaps to get its own UI
  // font across every diagram at once.
  const attrs = [`x="${n(x)}"`, `y="${n(y)}"`];
  if (options.family) attrs.push(`font-family="${options.family}"`);
  attrs.push(`font-size="${options.size ?? 12}"`, `fill="${options.fill ?? "currentColor"}"`);
  if (options.anchor) attrs.push(`text-anchor="${options.anchor}"`);
  if (options.weight) attrs.push(`font-weight="${options.weight}"`);
  if (options.italic) attrs.push(`font-style="italic"`);
  if (options.baseline === "middle") attrs.push(`dominant-baseline="central"`);
  if (options.opacity !== undefined) attrs.push(`opacity="${n(options.opacity)}"`);
  return `<text ${attrs.join(" ")}>${esc(value)}</text>`;
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 1,
  cap: "butt" | "round" = "butt",
): string {
  const capAttr = cap === "round" ? ` stroke-linecap="round"` : "";
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${n(width)}"${capAttr}/>`;
}

interface RectOptions {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  options: RectOptions = {},
): string {
  const attrs = [`x="${n(x)}"`, `y="${n(y)}"`, `width="${n(width)}"`, `height="${n(height)}"`];
  attrs.push(`fill="${options.fill ?? "none"}"`);
  if (options.stroke) attrs.push(`stroke="${options.stroke}"`);
  if (options.strokeWidth !== undefined) attrs.push(`stroke-width="${n(options.strokeWidth)}"`);
  if (options.rx !== undefined) attrs.push(`rx="${n(options.rx)}"`);
  return `<rect ${attrs.join(" ")}/>`;
}

export function circle(
  cx: number,
  cy: number,
  r: number,
  options: { fill?: string; stroke?: string; strokeWidth?: number } = {},
): string {
  const attrs = [`cx="${n(cx)}"`, `cy="${n(cy)}"`, `r="${n(r)}"`];
  attrs.push(`fill="${options.fill ?? "none"}"`);
  if (options.stroke) attrs.push(`stroke="${options.stroke}"`);
  if (options.strokeWidth !== undefined) attrs.push(`stroke-width="${n(options.strokeWidth)}"`);
  return `<circle ${attrs.join(" ")}/>`;
}

export interface KeyShapeOptions {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Bottom-left corner radius. */
  left?: number;
  /** Bottom-right corner radius. */
  right?: number;
}

/**
 * A piano key: square at the top, rounded only where asked at the bottom.
 *
 * The two radii are independent because keys butt against each other. Only the
 * keyboard's outermost key rounds off on its outer side; every interior corner
 * stays square so neighbouring keys meet along a straight shared edge instead
 * of each closing off into its own pill.
 */
export function keyShape(
  x: number,
  y: number,
  width: number,
  height: number,
  options: KeyShapeOptions = {},
): string {
  const cap = (radius: number): number => Math.min(radius, width / 2, height);
  const left = cap(options.left ?? 0);
  const right = cap(options.right ?? 0);

  const arc = (r: number, dx: number, dy: number): string =>
    r > 0 ? `a${n(r)},${n(r)} 0 0 1 ${n(dx)},${n(dy)}` : "";

  const d =
    `M${n(x)},${n(y)}H${n(x + width)}V${n(y + height - right)}` +
    arc(right, -right, right) +
    `H${n(x + left)}` +
    arc(left, -left, -left) +
    `Z`;

  const attrs = [`d="${d}"`, `fill="${options.fill ?? "none"}"`];
  if (options.stroke) attrs.push(`stroke="${options.stroke}"`);
  if (options.strokeWidth !== undefined) attrs.push(`stroke-width="${n(options.strokeWidth)}"`);
  return `<path ${attrs.join(" ")}/>`;
}

/** Positions a drawing's markup at (x, y) within a parent. */
export function place(drawing: Drawing, x: number, y: number): string {
  if (x === 0 && y === 0) return drawing.content;
  return `<g transform="translate(${n(x)},${n(y)})">${drawing.content}</g>`;
}

export interface FrameOptions {
  /** Padding around the drawing, in user units. */
  padding?: number;
  /** Paints the background rect. Leave off for a transparent PNG. */
  paintBackground?: boolean;
  /**
   * Fixes the rendered pixel size. Omit so the SVG scales to its container —
   * which is what the widget wants, while the rasteriser sets it explicitly.
   */
  scale?: number;
  /**
   * Caps the element at one user unit per CSS pixel. Without it a narrow sheet
   * stretched to a wide pane blows the card radii, hairlines and type up with
   * it, and cards that were sized to match the host's stop matching.
   */
  capToNaturalWidth?: boolean;
}

/** Wraps a drawing into a standalone, self-describing `<svg>` document. */
export function frame(drawing: Drawing, theme: Theme, options: FrameOptions = {}): string {
  const pad = options.padding ?? 12;
  const width = drawing.width + pad * 2;
  const height = drawing.height + pad * 2;
  const size = options.scale
    ? ` width="${n(width * options.scale)}" height="${n(height * options.scale)}"`
    : "";
  const background = options.paintBackground
    ? rect(0, 0, width, height, { fill: theme.background })
    : "";
  const cap = options.capToNaturalWidth ? ` style="max-width:${n(width)}px"` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}"${size}${cap}` +
    ` font-family="${theme.font}" role="img">` +
    background +
    place(drawing, pad, pad) +
    `</svg>`
  );
}

/** Stacks drawings vertically, centred on the widest one. */
export function stack(drawings: Drawing[], gap: number): Drawing {
  const width = Math.max(0, ...drawings.map((d) => d.width));
  let y = 0;
  const parts: string[] = [];
  for (const drawing of drawings) {
    parts.push(place(drawing, (width - drawing.width) / 2, y));
    y += drawing.height + gap;
  }
  return { content: parts.join(""), width, height: Math.max(0, y - gap) };
}

/** Lays drawings out left to right, aligned to their tops. */
export function row(drawings: Drawing[], gap: number): Drawing {
  const height = Math.max(0, ...drawings.map((d) => d.height));
  let x = 0;
  const parts: string[] = [];
  for (const drawing of drawings) {
    parts.push(place(drawing, x, 0));
    x += drawing.width + gap;
  }
  return { content: parts.join(""), width: Math.max(0, x - gap), height };
}
