# Chord Chart Generator MCP

Chord Chart Generator MCP is a TypeScript / Node.js project for displaying music diagrams and notation inside assistant conversations. Its documented interface includes four tools for chords, progressions, scales and ABC notation, with output for guitar, ukulele and piano.

## Project structure

The supplied project configuration defines separate theory, rendering, server and widget packages, plus preview and smoke-test tools. The lockfile records the MCP SDK, Zod, Tonal, a fretted-chord database, resvg and abcjs as dependencies of those workspaces.

The project README describes shared SVG renderers used by both the server and widget, PNG output, and local and HTTP connections. The implementation folders were not included in the current portfolio audit, so those behaviors have not yet been independently run or verified here. A recorded demonstration will be added when available.

| Documented tool | Purpose |
| --- | --- |
| `render_chord` | Chord shapes, keyboard diagram, spelling and intervals |
| `render_chord_progression` | A grid of diagrams in playing order |
| `render_scale` | A scale or mode and its diatonic chords |
| `render_notation` | Engraved notation from ABC |

## Code example

A separately prepared [TypeScript rendering example](https://github.com/gabriel-senra/engineering-examples) accepts explicit MIDI notes, validates input and escapes text before generating SVG. Its tests run independently of the private application. This example demonstrates a narrow rendering contract; it is not the MCP server or its chord-generation engine.

The full application source remains private. Original server execution, transport interoperability and PNG output are still pending verification.
