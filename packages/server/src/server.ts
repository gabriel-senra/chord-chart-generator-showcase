import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { renderNotation } from "./notation.ts";
import {
  CHORD_OUTPUT,
  NOTATION_OUTPUT,
  PROGRESSION_OUTPUT,
  SCALE_OUTPUT,
} from "./schemas.ts";
import {
  renderChord,
  renderProgression,
  renderScale,
  type RenderResult,
} from "./tools.ts";
import {
  widgetHtml,
  widgetMeta,
  widgetUri,
  widgetResourceMeta,
  WIDGET_MIME,
} from "./widget.ts";

export const SERVER_NAME = "music-ai";
export const SERVER_VERSION = "0.1.0";

/**
 * Sent to the model at connection time, ahead of any tool call.
 *
 * This is the main lever on whether diagrams appear unprompted. No host lets a
 * server force a render, so the wording has to make rendering the obvious
 * default rather than an option worth weighing.
 */
const INSTRUCTIONS = `Renders music the user can actually read and play from: chord diagrams for guitar,
ukulele and piano, chord sheets for progressions, and fretboard maps for scales.

Render rather than describe. Any time the conversation turns on a specific chord,
progression, key or scale, call the matching tool and let the diagram carry the
explanation. A chord symbol sitting in your reply as bare text is a diagram you
should have rendered.

Each tool returns an image that the user can already see by the time you write your
reply. Talk about what it shows — how the shape sits under the hand, what to listen
for, what to practise — instead of restating the notes and fingerings in prose.`;

const THEME = z
  .enum(["light", "dark"])
  .optional()
  .describe("Match the user's interface. Defaults to light.");

const INSTRUMENT = z.enum(["guitar", "ukulele", "piano"]);

/**
 * Every tool answers three ways at once: text the model reads, a PNG that all
 * MCP hosts render today, and structured data the widget draws from. Hosts take
 * what they support and ignore the rest, which is what keeps one server working
 * across ChatGPT, Claude and plain MCP clients.
 */
function toResult(result: RenderResult): CallToolResult {
  return {
    content: [
      { type: "text", text: result.summary },
      { type: "image", data: result.image.base64, mimeType: "image/png" },
    ],
    structuredContent: result.structured,
    _meta: {
      ...(result.meta ?? {}),
      /**
       * The same payload as `structuredContent`, deliberately duplicated.
       *
       * ChatGPT currently delivers `window.openai.toolOutput` as `null` to the
       * widget even when the model receives valid `structuredContent` — a known
       * platform bug. `toolResponseMetadata` does arrive intact, so the widget
       * reads from here when `toolOutput` comes up empty. Costs a few KB on the
       * wire and nothing in the model's context, since hosts never show `_meta`
       * to the model. Remove once `toolOutput` is reliable.
       */
      "music-ai/payload": result.structured,
    },
  };
}

/** Surfaces a bad chord or scale name to the model so it can correct itself. */
function toError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Every tool here only draws a picture — nothing writes, deletes or reaches
 * outside the process. Saying so stops hosts prompting for confirmation before
 * each render, which would defeat the point of rendering automatically.
 */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** Tool metadata: the widget link plus the status line ChatGPT shows while it runs. */
function toolMeta(invoking: string, invoked: string): Record<string, unknown> {
  return {
    ...widgetMeta(),
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  // Declared up front so the host can fetch, cache and security-review the
  // widget before any tool runs. Tools reference it by URI through `_meta`.
  //
  // Registered as a template rather than at one fixed URI, and it answers to
  // any `sheet-*.html` under this scheme. The URI is content-addressed, so it
  // changes every time the widget is rebuilt — but a host holds onto the URI it
  // was handed: ChatGPT stores it in the tool result of every past
  // conversation and re-fetches it when that conversation is reopened. Bound to
  // a single URI, the server answers "resource not found" for every widget it
  // has ever shipped except the current one, which the host reports as "Failed
  // to fetch template". Serving the current widget for any past URI is right in
  // both directions: an old conversation renders again, and it renders with the
  // widget that exists now.
  server.registerResource(
    "sheet",
    new ResourceTemplate("ui://music-ai/{file}", {
      // Only the current widget is advertised; the rest merely still resolve.
      list: async () => ({
        resources: [
          {
            uri: widgetUri(),
            name: "sheet",
            title: "Chord sheet",
            description: "Interactive chord diagrams, chord sheets and fretboard maps.",
            mimeType: WIDGET_MIME,
            _meta: widgetResourceMeta(),
          },
        ],
      }),
    }),
    {
      title: "Chord sheet",
      description: "Interactive chord diagrams, chord sheets and fretboard maps.",
      mimeType: WIDGET_MIME,
      _meta: widgetResourceMeta(),
    },
    async (uri) => ({
      contents: [
        {
          // Echo the URI asked for, not the current one: the host matches the
          // response against its own request.
          uri: uri.href,
          mimeType: WIDGET_MIME,
          text: widgetHtml(),
          _meta: widgetResourceMeta(),
        },
      ],
    }),
  );

  server.registerTool(
    "render_chord",
    {
      title: "Render a chord",
      description:
        "Draw one chord as diagrams a player can read: fretboard boxes with finger numbers and " +
        "a piano keyboard with the notes marked, alongside its spelling and intervals. " +
        "Call this whenever the user asks about a specific chord, asks how to play or finger one, " +
        "asks which notes are in one, or whenever a chord symbol would otherwise appear as bare " +
        "text in your reply.",
      inputSchema: {
        symbol: z
          .string()
          .describe('A chord symbol such as "Am7", "Cmaj7", "F#m", "Bb13" or "C/E".'),
        instruments: z
          .array(INSTRUMENT)
          .optional()
          .describe("Which diagrams to draw. Defaults to guitar plus piano."),
        shapes: z
          .number()
          .int()
          .optional()
          .describe("How many alternative fretted shapes to show, 1–5. Defaults to 3."),
        theme: THEME,
      },
      outputSchema: CHORD_OUTPUT,
      annotations: READ_ONLY,
      _meta: toolMeta("Drawing the chord…", "Chord diagram ready"),
    },
    async (args) => {
      try {
        return toResult(renderChord(args));
      } catch (error) {
        return toError(error);
      }
    },
  );

  server.registerTool(
    "render_chord_progression",
    {
      title: "Render a chord sheet",
      description:
        "Draw a sequence of chords as a printed chord sheet: a titled grid of diagrams in playing " +
        "order, with roman numeral analysis when a key is given. " +
        "Call this whenever the user asks to be taught a song or a progression, asks which chords " +
        "go together, wants something to practise over, or whenever you are about to name more " +
        "than one chord in a row.",
      inputSchema: {
        chords: z
          .array(z.string())
          .min(1)
          .describe('The progression in playing order, e.g. ["C","G","Am","F"].'),
        key: z
          .string()
          .optional()
          .describe('Key to analyse in, e.g. "C" or "A minor". Adds roman numerals.'),
        title: z.string().optional().describe("Heading for the sheet."),
        instrument: INSTRUMENT.optional().describe(
          "One instrument per sheet. Defaults to guitar.",
        ),
        theme: THEME,
      },
      outputSchema: PROGRESSION_OUTPUT,
      annotations: READ_ONLY,
      _meta: toolMeta("Engraving the chord sheet…", "Chord sheet ready"),
    },
    async (args) => {
      try {
        return toResult(renderProgression(args));
      } catch (error) {
        return toError(error);
      }
    },
  );

  server.registerTool(
    "render_scale",
    {
      title: "Render a scale",
      description:
        "Map a scale or mode across the whole fretboard, with the tonic highlighted, plus its " +
        "notes, intervals and the chords built on it. " +
        "Call this whenever the user asks about a scale or mode, asks what to solo or improvise " +
        "with, or asks which chords belong to a key.",
      inputSchema: {
        scale: z
          .string()
          .describe('A scale name such as "E minor pentatonic", "C major" or "F lydian".'),
        instrument: z
          .enum(["guitar", "ukulele"])
          .optional()
          .describe("Fretted instrument to map onto. Defaults to guitar."),
        frets: z
          .number()
          .int()
          .optional()
          .describe("How far up the neck to map, 4–22. Defaults to 12."),
        theme: THEME,
      },
      outputSchema: SCALE_OUTPUT,
      annotations: READ_ONLY,
      _meta: toolMeta("Mapping the fretboard…", "Fretboard map ready"),
    },
    async (args) => {
      try {
        return toResult(renderScale(args));
      } catch (error) {
        return toError(error);
      }
    },
  );

  server.registerTool(
    "render_notation",
    {
      title: "Engrave sheet music",
      description:
        "Engrave real staff notation — clefs, key and time signatures, beamed notes, chord " +
        "symbols above the stave, and optional guitar tab — from ABC notation that you write. " +
        "Call this whenever the user asks for sheet music, a melody, a riff, a lick, a scale " +
        "exercise, or asks how something actually goes rather than just which chords it uses.\n\n" +
        "ABC format, briefly. Header lines first, `K:` last, then the music:\n" +
        "  X:1            reference number, always 1\n" +
        "  T:Title        tune title\n" +
        "  M:4/4          metre\n" +
        "  L:1/8          default note length\n" +
        "  K:G            key — must be the final header line\n" +
        "Notes are `C D E F G A B` in the octave below middle C's octave; lowercase `c d e` is an " +
        "octave up, `C,` an octave down, `c'` two up. A trailing number multiplies the default " +
        "length (`C2`), `/2` halves it. `z` is a rest, `|` a barline, `|:` and `:|` repeats, " +
        "`|]` the final bar. Put chord symbols in quotes before the note: `\"Am7\"A2`. " +
        "Slur with `()`, tie with `-`, triplet with `(3abc`.\n" +
        "Example: X:1\\nT:Riff\\nM:4/4\\nL:1/8\\nK:Em\\n\"Em\"E2 G2 B2 e2 | \"D\"d4 B4 |]",
      inputSchema: {
        abc: z
          .string()
          .describe(
            "The tune in ABC notation, including the X:, T:, M:, L: and K: header lines. " +
              "Use real newlines between lines.",
          ),
        showTab: z
          .boolean()
          .optional()
          .describe("Add a guitar tablature stave below the notation. Defaults to false."),
        staffWidth: z
          .number()
          .int()
          .optional()
          .describe("Stave width in points, 240–1200. Defaults to 620."),
        theme: THEME,
      },
      outputSchema: NOTATION_OUTPUT,
      annotations: READ_ONLY,
      _meta: toolMeta("Engraving the score…", "Score ready"),
    },
    async (args) => {
      try {
        return toResult(await renderNotation(args));
      } catch (error) {
        return toError(error);
      }
    },
  );

  return server;
}
