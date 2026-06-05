// HTTP Streamable transport for MCP server
// Story 017: Implements HTTP transport with health endpoint and graceful shutdown

import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { isHealthCritical, isHealthDegraded, type SyncHealthState } from '../../core/sync/health.js';
import { isAnvilError } from '../../types/error.js';
import { handleGetNote } from '../../tools/get-note.js';
import { handleGetEdges } from '../../tools/get-edges.js';
import { handleSearchV2 } from '../../tools/search-v2.js';
import { handleUpdateNote } from '../../tools/update-note.js';
import { handleDeleteNote } from '../../tools/delete-note.js';
import { handleDeleteEntity } from '../../tools/delete-entity.js';
import type { ToolContext } from '../../tools/create-note.js';
import { addSseClient, removeSseClient } from '../../core/events.js';

const startTime = Date.now();

export interface HttpOptions {
  port: number;
  host: string;
  getHealth?: () => SyncHealthState;
  /** When provided, enables REST API routes at /api/* for browser clients */
  ctx?: ToolContext;
}

/** Read the full request body as a UTF-8 string */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Map an AnvilError code to an HTTP status code */
function errorStatus(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'VALIDATION_ERROR') return 400;
  return 500;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Log a message in JSON format to stderr
 */
function log(level: string, message: string, extra?: Record<string, unknown>) {
  const logEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  process.stderr.write(JSON.stringify(logEntry) + '\n');
}

/**
 * Start the MCP server using HTTP transport with StreamableHTTP protocol.
 * Supports multiple concurrent sessions via per-session transport instances.
 * Features:
 * - /health endpoint returning server status and uptime
 * - Per-session transport routing (new session per initialize request)
 * - Graceful shutdown on SIGTERM/SIGINT
 * - JSON logging to stderr
 */
export async function startHttp(serverFactory: () => Server, opts: HttpOptions): Promise<void> {
  const { port, host } = opts;

  // Session registry: maps sessionId -> transport
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // Create HTTP server
  const httpServer = http.createServer(async (req, res) => {
    // Handle health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      const uptime = Math.floor((Date.now() - startTime) / 1000);

      if (opts.getHealth) {
        const syncHealth = opts.getHealth();
        const critical = isHealthCritical(syncHealth);
        const degraded = isHealthDegraded(syncHealth);
        const health = {
          status: critical ? 'critical' : degraded ? 'degraded' : 'ok',
          service: 'anvil',
          version: '2.0.0',
          uptime_seconds: uptime,
          sync: syncHealth,
        };
        res.writeHead(critical ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
        return;
      }

      const health = { status: 'ok', service: 'anvil', version: '2.0.0', uptime_seconds: uptime };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    // REST API routes (browser-friendly, CORS-enabled)
    if (opts.ctx) {
      const reqPath = req.url?.split('?')[0] ?? '/';
      const search = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const params = new URLSearchParams(search);

      // CORS preflight
      if (req.method === 'OPTIONS' && reqPath.startsWith('/api/')) {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      // GET /api/notes/:id
      const noteMatch = reqPath.match(/^\/api\/notes\/([^/]+)$/);
      if (req.method === 'GET' && noteMatch) {
        const noteId = decodeURIComponent(noteMatch[1]);
        const result = await handleGetNote({ noteId }, opts.ctx);
        const status = isAnvilError(result) ? errorStatus(result.code) : 200;
        res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify(result));
        return;
      }

      // PATCH /api/notes/:id — update note body
      if (req.method === 'PATCH' && noteMatch) {
        const noteId = decodeURIComponent(noteMatch[1]);
        const rawBody = await readBody(req);
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(rawBody); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify({ error: true, code: 'VALIDATION_ERROR', message: 'Invalid JSON body' }));
          return;
        }
        if (typeof parsed.body !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify({ error: true, code: 'VALIDATION_ERROR', message: 'body field is required' }));
          return;
        }
        const result = await handleUpdateNote({ noteId, content: parsed.body as string }, opts.ctx);
        const status = isAnvilError(result) ? errorStatus(result.code) : 200;
        res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify(isAnvilError(result) ? result : { ok: true }));
        return;
      }

      // DELETE /api/notes/:id
      if (req.method === 'DELETE' && noteMatch) {
        const noteId = decodeURIComponent(noteMatch[1]);
        let result;
        if (opts.ctx.storageBackend) {
          result = await handleDeleteEntity(
            { noteId },
            {
              storageBackend: opts.ctx.storageBackend,
              edgeStore: opts.ctx.edgeStore,
              fileStore: opts.ctx.fileStore,
            },
          );
        } else {
          result = await handleDeleteNote({ noteId }, opts.ctx);
        }
        const status = isAnvilError(result) ? errorStatus(result.code) : 200;
        res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify(isAnvilError(result) ? result : { ok: true }));
        return;
      }

      // GET /api/notes/:id/edges
      const edgesMatch = reqPath.match(/^\/api\/notes\/([^/]+)\/edges$/);
      if (req.method === 'GET' && edgesMatch) {
        const noteId = decodeURIComponent(edgesMatch[1]);
        const intent = params.get('intent') || undefined;
        if (opts.ctx.edgeStore && opts.ctx.intentRegistry) {
          const result = await handleGetEdges(
            { edgeStore: opts.ctx.edgeStore, intentRegistry: opts.ctx.intentRegistry },
            { noteId, intent },
          );
          const status = isAnvilError(result) ? errorStatus(result.code) : 200;
          res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json', ...CORS_HEADERS });
          res.end(JSON.stringify({ error: true, code: 'SERVER_ERROR', message: 'Edge store not initialized' }));
        }
        return;
      }

      // POST /api/search
      if (req.method === 'POST' && reqPath === '/api/search') {
        const body = await readBody(req);
        let searchParams: Record<string, unknown> = {};
        try { searchParams = JSON.parse(body); } catch { /* empty body = no filters */ }
        const result = await handleSearchV2(opts.ctx, searchParams as Parameters<typeof handleSearchV2>[1]);
        const status = isAnvilError(result) ? errorStatus(result.code) : 200;
        res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify(result));
        return;
      }

      // GET /api/events — SSE stream for real-time note change events
      if (req.method === 'GET' && reqPath === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...CORS_HEADERS,
        });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        addSseClient(res);
        req.on('close', () => removeSseClient(res));
        return;
      }
    }

    // Route all other requests to MCP transport
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport && sessionId) {
        // Session ID provided but not in map — server restarted or session expired.
        // Recover transparently: create a stateless transport (no sessionIdGenerator)
        // which bypasses the SDK's session validation and init enforcement.
        const server = serverFactory();
        transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
        transport.onclose = () => {
          sessions.delete(sessionId);
          log('info', 'MCP session closed (recovered)', { sessionId });
        };
        await server.connect(transport);
        sessions.set(sessionId, transport);
        log('info', 'MCP session recovered (transparent reinit)', { sessionId });
      } else if (!transport) {
        // No session ID = new session request (initialize handshake).
        const server = serverFactory();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport!);
            log('info', 'MCP session initialized', { sessionId: sid });
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) {
            sessions.delete(transport!.sessionId);
            log('info', 'MCP session closed', { sessionId: transport!.sessionId });
          }
        };
        await server.connect(transport);
      }

      await transport.handleRequest(req, res);
    } catch (error) {
      log('error', 'HTTP request handling failed', {
        path: req.url,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    log('info', `Received ${signal}, shutting down gracefully...`);
    httpServer.close(() => {
      log('info', 'HTTP server closed');
      process.exit(0);
    });
    // Force exit after 5 seconds if graceful shutdown doesn't complete
    setTimeout(() => {
      log('warn', 'Forcing shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start listening
  return new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      log('info', 'Anvil MCP HTTP server started', {
        host,
        port,
        url: `http://${host}:${port}`,
      });
      resolve();
    });
    httpServer.on('error', (error) => {
      log('error', 'HTTP server error', {
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error);
    });
  });
}
