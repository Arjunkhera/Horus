// Standard I/O transport for MCP server
// Implements the stdio transport which reads/writes to stdin/stdout

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Start the MCP server using stdio transport.
 * The server communicates via stdin/stdout with the client.
 * Runs until the process exits.
 */
export async function startStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs indefinitely, processing requests from stdin
  // Connection remains open until process is terminated
}
