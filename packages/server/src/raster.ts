import { Resvg } from "@resvg/resvg-js";
import { frame, type Drawing, type Theme } from "@music-ai/render";

/**
 * Turns a drawing into a PNG content block.
 *
 * This is the universal path: every MCP host renders an image block, whereas
 * interactive widgets are still gated on a per-host basis. Whatever else a tool
 * returns, it always returns one of these.
 */
export interface RenderedImage {
  base64: string;
  width: number;
  height: number;
}

const MAX_WIDTH = 1600;

export function rasterise(drawing: Drawing, theme: Theme, padding = 18): RenderedImage {
  const svg = frame(drawing, theme, { padding, paintBackground: true });
  const naturalWidth = drawing.width + padding * 2;

  // 2× for legibility on high-density displays, backed off for a wide sheet so
  // hosts are not handed a needlessly enormous image.
  const zoom = Math.min(2, MAX_WIDTH / naturalWidth);

  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: zoom },
    background: theme.background,
    font: { loadSystemFonts: true },
  });
  const rendered = resvg.render();

  return {
    base64: rendered.asPng().toString("base64"),
    width: rendered.width,
    height: rendered.height,
  };
}

/** The SVG source, for hosts and callers that would rather scale it themselves. */
export function toSvg(drawing: Drawing, theme: Theme, padding = 18): string {
  return frame(drawing, theme, { padding, paintBackground: true });
}

/**
 * Rasterises SVG this project did not author — currently abcjs scores, which
 * arrive as a complete document with their own viewBox.
 */
export function rasteriseSvg(svg: string, background: string): RenderedImage {
  const declaredWidth = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)?.[1] ?? 0);
  const zoom = declaredWidth > 0 ? Math.min(2, MAX_WIDTH / declaredWidth) : 2;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: zoom },
    background,
    font: { loadSystemFonts: true },
  });
  const rendered = resvg.render();

  return {
    base64: rendered.asPng().toString("base64"),
    width: rendered.width,
    height: rendered.height,
  };
}
