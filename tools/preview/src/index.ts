/**
 * Local rendering harness — no MCP, no network, no host.
 *
 * Writes an HTML contact sheet plus PNGs of every diagram in both themes, so
 * the visuals can be judged on their own before any protocol work. Run it with
 * `npm run preview`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import {
  frame,
  renderChordCard,
  renderFretboard,
  renderProgressionSheet,
  themeFor,
  type Drawing,
  type Theme,
} from "@music-ai/render";
import {
  getChord,
  getScale,
  getShapes,
  instrumentSpec,
  romanNumerals,
  scaleFretboard,
} from "@music-ai/theory";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../preview");

interface Sample {
  slug: string;
  caption: string;
  build: (theme: Theme) => Drawing;
}

function chordCard(symbol: string): Sample {
  return {
    slug: `chord-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`,
    caption: `render_chord — ${symbol}`,
    build: (theme) =>
      renderChordCard(getChord(symbol), getShapes(symbol, { instrument: "guitar", limit: 3 }), {
        theme,
      }),
  };
}

/** The `render_chord` view with the fretted half switched off. */
function pianoChord(symbol: string): Sample {
  return {
    slug: `piano-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`,
    caption: `render_chord — ${symbol} (piano only)`,
    build: (theme) =>
      renderChordCard(getChord(symbol), [], { theme, instruments: ["piano"] }),
  };
}

function progression(
  slug: string,
  chords: string[],
  key: string | null,
  title: string,
  instrument: "guitar" | "ukulele" | "piano",
): Sample {
  return {
    slug,
    caption: `render_chord_progression — ${title} (${instrument})`,
    build: (theme) => {
      const numerals = romanNumerals(chords, key);
      return renderProgressionSheet(
        chords.map((symbol, index) => ({
          chord: getChord(symbol),
          shapes: instrument === "piano" ? [] : getShapes(symbol, { instrument, limit: 1 }),
          numeral: numerals?.[index] ?? null,
        })),
        { theme, title, key, instrument },
      );
    },
  };
}

const SAMPLES: Sample[] = [
  chordCard("Am7"),
  chordCard("Cmaj7"),
  chordCard("F#m"),
  chordCard("Bb13"),
  // Parses cleanly but has no entry in the shape library — exercises the
  // "no stock shape" path, which must still render notes and a keyboard.
  chordCard("Cmaj13#11"),
  progression("prog-pop", ["C", "G", "Am", "F"], "C", "The Four Chords", "guitar"),
  progression("prog-jazz", ["Dm7", "G7", "Cmaj7", "A7"], "C", "ii–V–I with a turnaround", "guitar"),
  progression("prog-wide", ["E", "A", "B7", "E", "C#m", "A", "B7", "E"], "E", "Twelve-bar-ish in E", "guitar"),
  progression("prog-uke", ["C", "Am", "F", "G7"], "C", "Ukulele turnaround", "ukulele"),
  pianoChord("Am7"),
  pianoChord("C/E"),
  progression("prog-piano", ["Cmaj7", "Am7", "Dm7", "G7"], "C", "Rhodes voicings", "piano"),
  progression("prog-piano-pop", ["C", "G", "Am", "F"], "C", "The Four Chords", "piano"),
  {
    slug: "scale-eminor-pentatonic",
    caption: "render_scale — E minor pentatonic, 12 frets",
    build: (theme) => {
      const scale = getScale("E minor pentatonic");
      const spec = instrumentSpec("guitar");
      return renderFretboard({
        theme,
        tuning: spec.tuning,
        frets: 12,
        positions: scaleFretboard(scale.notes, spec.tuning, 12),
        title: `${scale.name} — ${scale.notes.join(" ")}`,
      });
    },
  },
];

function rasterise(svg: string, background: string): Buffer {
  const resvg = new Resvg(svg, {
    // 2× for a crisp contact sheet; the server picks its own scale per host.
    fitTo: { mode: "zoom", value: 2 },
    background,
    font: { loadSystemFonts: true },
  });
  return Buffer.from(resvg.render().asPng());
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const sections: string[] = [];

  for (const sample of SAMPLES) {
    const cards: string[] = [];
    for (const themeName of ["light", "dark"] as const) {
      const theme = themeFor(themeName);
      const svg = frame(sample.build(theme), theme, { padding: 18, paintBackground: true });
      const file = `${sample.slug}-${themeName}`;

      writeFileSync(join(OUT_DIR, `${file}.svg`), svg);
      writeFileSync(join(OUT_DIR, `${file}.png`), rasterise(svg, theme.background));

      cards.push(
        `<figure class="card ${themeName}"><img src="${file}.png" alt="${sample.caption}"><figcaption>${themeName}</figcaption></figure>`,
      );
    }
    sections.push(
      `<section><h2>${sample.caption}</h2><div class="pair">${cards.join("")}</div></section>`,
    );
  }

  const html = `<!doctype html>
<meta charset="utf-8">
<title>music-ai render preview</title>
<style>
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 32px; background: #f5f5f4; color: #1c1917; }
  h1 { font-size: 20px; }
  h2 { font-size: 13px; font-weight: 600; color: #78716c; margin: 32px 0 8px; font-family: ui-monospace, monospace; }
  .pair { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  .card { margin: 0; border: 1px solid #d6d3d1; border-radius: 8px; overflow: hidden; background: #fff; }
  .card img { display: block; max-width: 100%; }
  figcaption { font-size: 11px; color: #78716c; padding: 4px 8px; border-top: 1px solid #e7e5e4; }
</style>
<h1>music-ai render preview</h1>
<p>Generated by <code>npm run preview</code>. Every diagram below is the same SVG the MCP server ships.</p>
${sections.join("\n")}
`;

  writeFileSync(join(OUT_DIR, "index.html"), html);
  console.log(`Wrote ${SAMPLES.length * 2} diagrams to ${OUT_DIR}`);
  console.log(`Open: ${join(OUT_DIR, "index.html")}`);
}

main();
