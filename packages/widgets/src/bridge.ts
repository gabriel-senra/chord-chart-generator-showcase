/**
 * One widget, two host runtimes.
 *
 * ChatGPT injects a `window.openai` object and pushes updates through an
 * `openai:set_globals` DOM event. MCP Apps hosts inject nothing — the iframe
 * opens an MCP connection back to the host over `postMessage`.
 *
 * Both paths are armed at once rather than picking a host up front. An earlier
 * version chose one at startup and lost every race where `window.openai` was
 * injected after the bundle ran: it took the MCP branch, sent a handshake
 * ChatGPT does not answer, and sat on the placeholder forever. Whichever
 * channel produces data first now wins, and a short poll covers hosts that set
 * their globals without firing an event.
 */

export type ThemeName = "light" | "dark";

export interface HostState {
  theme: ThemeName;
  /** The tool's `structuredContent`. */
  data: unknown;
  /** The tool result's `_meta`, where oversized payloads like engraved SVG ride. */
  meta: Record<string, unknown>;
  /** Width the host has given us, when it says. */
  width?: number;
  /** Which channel supplied the data. Surfaced in the diagnostic panel. */
  source: "openai" | "openai-meta" | "mcp-apps" | "preview" | "none";
}

export interface Host {
  subscribe(listener: (state: HostState) => void): void;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Everything known about the environment, for on-screen diagnostics. */
  describe(): string;
}

const asTheme = (value: unknown): ThemeName => (value === "dark" ? "dark" : "light");

/**
 * ChatGPT announces global changes with this event, carrying the new values in
 * `detail.globals`. Reading them from the event rather than re-reading
 * `window.openai` matters: the event is the authoritative delivery, and an
 * earlier version of this bridge dropped the payload and re-read the object,
 * which was still empty.
 */
const SET_GLOBALS_EVENT = "openai:set_globals";

/** Where the server mirrors the payload, because `toolOutput` cannot be relied on. */
const PAYLOAD_META_KEY = "music-ai/payload";

/**
 * Matches the reference widgets: 40 tries at 250ms, so a full ten seconds.
 * The previous 3.6s gave up before ChatGPT had delivered anything.
 */
const POLL_INTERVAL_MS = 250;
const POLL_ATTEMPTS = 40;

/**
 * ChatGPT has shipped `toolOutput` both as the structured content itself and
 * wrapped in a result envelope. Unwrap defensively so either shape works.
 */
function unwrapToolOutput(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, any>;
  if (typeof record.kind === "string") return record;
  if (record.result?.structuredContent) return record.result.structuredContent;
  if (record.structuredContent) return record.structuredContent;
  return record;
}

export function connect(): Host {
  const listeners: Array<(state: HostState) => void> = [];
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  /** Counts host announcements, so a silent host is distinguishable from a slow one. */
  let eventCount = 0;

  const state: HostState = { theme: "light", data: undefined, meta: {}, source: "none" };
  let signature = "";

  const emit = (): void => {
    // Re-rendering costs a full SVG rebuild, so only publish real changes.
    const next = `${state.source}|${state.theme}|${state.width ?? ""}|${
      state.data === undefined ? "" : JSON.stringify(state.data).length
    }`;
    if (next === signature) return;
    signature = next;
    for (const listener of listeners) listener({ ...state });
  };

  const openai = (): Record<string, any> | undefined => {
    const api = (window as unknown as Record<string, any>).openai;
    return api && typeof api === "object" ? api : undefined;
  };

  /**
   * Accepts globals from either source — the `set_globals` event payload or
   * the `window.openai` object — and reports whether a payload has landed.
   */
  const acceptGlobals = (globals: Record<string, any> | undefined): boolean => {
    if (!globals) return false;
    if (globals.theme) state.theme = asTheme(globals.theme);
    if (typeof globals.maxWidth === "number") state.width = globals.maxWidth;
    if (globals.toolResponseMetadata) state.meta = globals.toolResponseMetadata;

    let output = unwrapToolOutput(globals.toolOutput);

    // ChatGPT often hands the widget `toolOutput: null` while forwarding the
    // tool result's `_meta` intact, so the server ships a copy of the payload
    // there. This is the path that actually works today.
    if (!output || typeof output !== "object") {
      output = state.meta?.[PAYLOAD_META_KEY];
      if (output && typeof output === "object") {
        state.data = output;
        state.source = "openai-meta";
        return true;
      }
      return false;
    }

    state.data = output;
    state.source = "openai";
    return true;
  };

  const readOpenAi = (): boolean => acceptGlobals(openai());

  // --- ChatGPT ---------------------------------------------------------
  window.addEventListener(
    SET_GLOBALS_EVENT,
    (event: Event) => {
      // The new values live on the event, not necessarily on window.openai yet.
      eventCount++;
      const detail = (event as CustomEvent<{ globals?: Record<string, any> }>).detail;
      acceptGlobals(detail?.globals);
      // Re-read the object too, in case only part of it came through.
      readOpenAi();
      emit();
    },
    { passive: true },
  );

  // --- MCP Apps --------------------------------------------------------
  const send = (message: Record<string, unknown>): void => {
    // The frame is sandboxed to an opaque origin and the host origin is not
    // known ahead of time, so "*" is the only workable target.
    window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  };

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  };

  const applyHostContext = (context: Record<string, any> | undefined): void => {
    if (!context) return;
    state.theme = asTheme(context.theme);
    const width = context.containerDimensions?.width ?? context.containerDimensions?.maxWidth;
    if (typeof width === "number") state.width = width;
  };

  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;

    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? "Host call failed"));
      else entry.resolve(message.result);
      return;
    }

    switch (message.method) {
      case "ui/notifications/tool-result":
        state.data = message.params?.structuredContent;
        state.meta = message.params?._meta ?? {};
        state.source = "mcp-apps";
        emit();
        break;
      case "ui/notifications/host-context-changed":
        applyHostContext(message.params?.hostContext ?? message.params);
        emit();
        break;
      default:
        break;
    }
  });

  if (window.parent && window.parent !== window) {
    void request("ui/initialize", {
      capabilities: {},
      clientInfo: { name: "music-ai-sheet", version: "0.1.0" },
    })
      .then((result) => {
        applyHostContext((result as Record<string, any>)?.hostContext);
        send({ method: "ui/notifications/initialized", params: {} });
        emit();
      })
      .catch(() => {
        /* Not an MCP Apps host; the other channels cover it. */
      });
  }

  // --- Opened directly in a browser ------------------------------------
  const seed = (window as unknown as Record<string, any>).__MUSIC_AI_PREVIEW__;
  if (seed?.data) {
    state.data = seed.data;
    state.meta = seed.meta ?? {};
    state.theme = asTheme(seed.theme);
    state.source = "preview";
  }

  // --- Catch late injection --------------------------------------------
  readOpenAi();
  let attempts = 0;
  const timer = window.setInterval(() => {
    const gotData = readOpenAi();
    emit();
    if (gotData || ++attempts >= POLL_ATTEMPTS) window.clearInterval(timer);
  }, POLL_INTERVAL_MS);

  return {
    subscribe(listener) {
      listeners.push(listener);
      listener({ ...state });
    },
    async callTool(name, args) {
      const api = openai();
      if (api?.callTool) return api.callTool(name, args);
      return request("tools/call", { name, arguments: args });
    },
    describe() {
      const api = openai();
      const output = api?.toolOutput;
      // `typeof null` is "object", which made the previous diagnostic ambiguous
      // at exactly the moment it mattered. Say precisely what is there.
      const shape =
        output === undefined
          ? "undefined"
          : output === null
            ? "null"
            : typeof output === "object"
              ? `object { ${Object.keys(output).slice(0, 12).join(", ")} }`
              : typeof output;
      return [
        `source: ${state.source}`,
        `window.openai: ${api ? "present" : "absent"}`,
        `toolOutput: ${shape}`,
        `toolResponseMetadata: ${api?.toolResponseMetadata ? "present" : "absent"}`,
        `${PAYLOAD_META_KEY}: ${api?.toolResponseMetadata?.[PAYLOAD_META_KEY] ? "present" : "absent"}`,
        `setGlobals events seen: ${eventCount}`,
        `framed: ${window.parent !== window}`,
      ].join("\n");
    },
  };
}
