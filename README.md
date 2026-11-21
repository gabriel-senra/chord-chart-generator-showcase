# music-ai

Ask ChatGPT or Claude to teach you a chord and get a **chord sheet**, not a paragraph.

One MCP server that draws guitar and ukulele chord boxes, piano keyboard diagrams, fretboard maps
and engraved staff notation — inline, in the chat, laid out like a printed sheet.

```
you   › teach me Am7
chat  › [diagram: Am7 — three fretboard shapes with finger numbers, and a keyboard
         with A, C, E and G marked]
        That open shape is the one to learn first — one finger on the second fret …
```

## What it renders

| Tool | Draws |
|---|---|
| `render_chord` | One chord in depth: several fretted shapes with finger numbers and barres, a keyboard diagram, spelling and intervals |
| `render_chord_progression` | A titled chord sheet — a grid of diagrams in playing order with roman numerals |
| `render_scale` | A scale or mode across the whole neck, tonic highlighted, with its diatonic chords |
| `render_notation` | Real engraved notation from ABC: clefs, key and time signatures, chord symbols, optional guitar tab |

Guitar, ukulele and piano. Light and dark themes.

## Quick start

```bash
npm install
npm run build     # bundles the widget
npm run smoke     # end-to-end check over a real MCP connection
npm run preview   # renders a contact sheet to preview/index.html
```

Needs Node 22.18+ (it runs the TypeScript sources directly, no build step for the server).

## Installing it

### Claude Code

A project-scoped [`.mcp.json`](.mcp.json) is already checked in. Open this directory in Claude Code
and approve the server when prompted, then ask it about a chord.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "music-ai": {
      "command": "node",
      "args": ["/absolute/path/to/music-ai-1/packages/server/src/stdio.ts"]
    }
  }
}
```

### ChatGPT, and Claude as a remote connector

Both need a public HTTPS URL, so run the HTTP transport and expose it. Two terminals:

```bash
npm run serve:http          # listens on http://localhost:8787/mcp
npm run tunnel              # ngrok, on a reserved domain
```

Then add `https://<your-domain>/mcp` as a connector — ChatGPT under developer mode, Claude under
Settings → Connectors.

**Use a reserved domain, not an ephemeral one.** A host stores the URL you gave it *and* the
`ui://` URI of the widget it fetched, so a URL that changes between runs means re-pasting it into
every client each time, and a tunnel that dies silently surfaces as `Error refreshing actions` with
nothing obviously wrong locally. ngrok's free tier reserves one domain, which is enough; set
`MUSIC_AI_NGROK_DOMAIN` to override the default in `npm run tunnel`.

For a URL that outlives the laptop, deploy to any Node host (Fly.io, Render, Railway).
**Not Cloudflare Workers**: the PNG rasteriser is a native binary.

## How it renders in three places at once

Every tool answers three ways in a single response, and each host takes what it supports:

1. **Text** — a summary the model reads and talks around.
2. **A PNG** — renders in *every* MCP client today, including Claude Code and Claude Desktop.
3. **`structuredContent` + a `ui://` widget** — an interactive, resolution-independent, theme-aware
   version for hosts that implement [MCP Apps (SEP-1865)](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp).

The PNG is what makes this work everywhere on day one. Interactive widget support in Claude Web for
*custom* connectors is unreliable — see
[claude-ai-mcp#471](https://github.com/anthropics/claude-ai-mcp/issues/471), closed as not planned —
so the widget is treated as an upgrade, never a dependency.

Tools carry both the standard `_meta.ui.resourceUri` and the older `openai/outputTemplate`, which is
what lets one server drive ChatGPT and MCP Apps hosts without branching.

## Layout

```
packages/
  theory/    chord + scale resolution over tonal, fretted shapes from chords-db
  render/    DOM-free SVG emitters — the same code draws in the browser and on the server
  server/    MCP server, four tools, PNG rasteriser, abcjs engraving
  widgets/   the ui:// widget, bundled to one self-contained 16 KB HTML file
tools/
  preview/   renders every diagram to preview/index.html for eyeballing
  smoke/     drives the server over real MCP and checks what comes back
```

The load-bearing idea is **one renderer, two consumers**. `packages/render` emits SVG *strings* with
no DOM and no runtime dependencies, so the widget calls it in the browser and the server calls it
headlessly before rasterising. The two can't drift, and the widget stays small enough to inline
under the `default-src 'none'` policy that MCP Apps hosts apply by default.

Nothing is drawn in a box. The widget asks the host not to draw a border (`prefersBorder: false`),
because a host border is one container around the whole iframe and turns a row of chords into a
single widget-shaped blob no matter what is inside it. The diagrams then don't reintroduce the
problem at a smaller scale: a keyboard has no card, no backing and no outline, its keys butt together
with no gaps, and its edge is simply where the key fill stops. Each chord is a keyboard sitting
directly in the host's own space.

What makes that read as native rather than unstyled is the `Theme`: every colour, hairline and font
comes off it, and in the widget it is repopulated from the host's own CSS custom properties before
anything is drawn — its text colour, its hairline, its accent as the lit key. The server draws with
the same code and the default palette, so the PNG matches.

Chord shapes are resolved **server-side**: `chords-db` is several megabytes, far too big to ship into
an iframe. The widget receives concrete frets, fingers and barres — which also means the model can
read and discuss the fingering rather than just display it.

## Deliberate limits

- **No audio.** Playback, transpose and capo controls are the natural next step; the widget bridge
  already supports calling back into the server for them.
- **No song database.** Chords and progressions are generated from theory, or come from what you and
  the model supply. Full transcriptions and lyrics of published songs are copyrighted; adding a
  scraped tab database would be a licensing problem, not a technical one.
- **Theme is a guess.** Tool calls carry no theme information, so PNGs default to light unless the
  model passes `theme: "dark"`. The widget gets the real theme from the host and is always correct.
- **Notation is engraved, not interactive.** `render_notation` produces a proper score and tab, but
  the widget scales the server's SVG rather than re-engraving. Bundling abcjs into the widget (~500 KB)
  only pays for itself once there's playback to go with it.
