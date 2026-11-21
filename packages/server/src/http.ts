#!/usr/bin/env node
/**
 * Streamable HTTP entrypoint — how ChatGPT and Claude Web reach this server.
 *
 * Runs stateless: a fresh server and transport per request, nothing kept
 * between calls. Rendering is pure, so there is no session worth holding onto,
 * and statelessness means it scales across instances without sticky routing.
 */

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.ts";

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
});

app.post("/mcp", async (request, response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  // Both ends are per-request, so tear them down together when the client hangs up.
  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless servers have no stream to resume and no session to delete.
const rejectStateful = (_request: express.Request, response: express.Response): void => {
  response.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
};
app.get("/mcp", rejectStateful);
app.delete("/mcp", rejectStateful);

app.listen(PORT, () => {
  console.log(`${SERVER_NAME} ${SERVER_VERSION} listening on http://localhost:${PORT}/mcp`);
});
