# Chord Chart Generator MCP

Chord Chart Generator MCP turns chord, progression and scale requests into diagrams that an assistant can return in a conversation. It also engraves supplied ABC notation into a score. The TypeScript implementation separates music resolution, drawing and MCP delivery so each part can be tested independently.

**TypeScript · Node.js · MCP · SVG/PNG**

## What it does

| Tool | Result |
| --- | --- |
| `render_chord` | Spelled notes and intervals, a keyboard diagram, and stored guitar or ukulele shapes |
| `render_chord_progression` | Diagrams in playing order, with Roman labels when a key is supplied |
| `render_scale` | A keyboard or fretboard scale map and diatonic triads for seven-note scales |
| `render_notation` | Staff notation from ABC, with optional guitar tablature |

## Engineering challenges and how they are handled

### Turning a chord name into consistent notes and fingerings

A request such as Am7 needs to become a specific musical representation before it becomes a picture. The theory layer resolves note spelling and intervals, while a stored fingering database provides fretted-instrument shapes. The renderer receives concrete notes, frets, fingers and barres rather than asking a model to draw or guess them.

Some valid chord symbols have no stored fingering. The implementation reports that absence and still provides the pitch information instead of inventing a shape. Tests check that stored shapes produce pitches belonging to the chord.

### Keeping diagrams consistent across image and widget output

A chat client may display an image while another supports an embedded interface. Maintaining two separate drawing implementations would make them easy to change inconsistently. Shared SVG renderers produce the diagrams for both the server and browser widget. The server rasterizes the SVG to PNG; the widget can redraw the resolved musical data for light or dark themes.

The large fingering database stays on the server, so displaying a chart does not require shipping it into the widget.

### Returning a useful result without depending on widget support

Each tool returns a text summary, PNG content and structured data. An MCP Apps HTML resource provides an additional display path for clients that support it. The PNG path is independently checked by the stdio smoke test, while the resource can be fetched through the same protocol connection.

A successful SDK connection does not establish behavior in every assistant client. Real ChatGPT and Claude demonstrations are still pending.

### Handling malformed or oversized requests before rendering

The tools validate chord names, instrument choices, array sizes and notation length before drawing. Labels are escaped when written into SVG. The browser widget also restricts the SVG elements and attributes it accepts, rather than inserting arbitrary HTML from a result.

Invalid musical input returns an error. It does not fall back to an unrelated chord or a plausible-looking diagram.

### Engraving notation separately from chord diagrams

Staff notation needs a notation-layout engine rather than the keyboard and fretboard drawing code. The server uses ABC engraving in a headless document, sanitizes the generated SVG and passes it through the PNG output path. Guitar tablature is an optional engraving setting.

Headless text measurement is approximate, so more complex scores need visual layout checks. Notation is displayed as a score; playback and interactive score editing are not implemented.

## Testing and current status

The current implementation passes TypeScript checking and fourteen tests covering harmony, fingering pitches, input bounds, SVG output, PNG headers, themes, notation/tab and local HTTP behavior. A separate stdio smoke test discovers and calls all four tools, checks their text/image/structured responses, reads the widget resource and exercises invalid input.

Local stdio and Streamable HTTP connections are implemented. The browser widget builds successfully, but end-user host integration and a public HTTPS service have not been verified. Full application source remains private.
