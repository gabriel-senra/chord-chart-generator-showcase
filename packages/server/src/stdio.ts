#!/usr/bin/env node
/**
 * Stdio entrypoint — how Claude Code and Claude Desktop run this server locally.
 *
 * Nothing may be written to stdout except protocol traffic, so diagnostics go
 * to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.ts";

const server = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio`);
