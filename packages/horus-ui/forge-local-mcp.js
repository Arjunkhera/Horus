/**
 * forge-local-mcp.js — In-process Forge MCP router for horus-ui.
 *
 * Embeds the Forge MCP server directly inside the horus-ui Express process,
 * eliminating the need for a separate forge container. The MCP endpoint is
 * mounted at POST /forge/mcp (by server.js: app.use('/forge', forgeMcpRouter)).
 *
 * Architecture mirrors packages/forge/packages/mcp-server/src/index.ts
 * (startMcpServerHttp) but adapted for Express router mounting:
 *   - Sessions are managed in a module-level Map.
 *   - buildServer() creates a new ForgeCore-backed MCP Server per session.
 *   - runStartupMigrations() is called once on module load.
 *
 * Env variables consumed:
 *   FORGE_CONFIG_PATH         — path to forge.yaml config directory
 *   FORGE_WORKSPACE_PATH      — workspace root passed to buildServer
 *   FORGE_SESSIONS_ROOT       — overrides workspace.sessions_root in global config
 *   FORGE_MANAGED_REPOS_PATH  — overrides workspace.managed_repos_path
 *   FORGE_WORKSPACES_PATH     — overrides /data/workspaces in forge_add/install
 *   FORGE_REGISTRY_GATEWAY_URL / HORUS_CONTROL_PLANE_URL — registry URL override
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';

// Dynamic imports to defer loading until the module is first used, and to
// handle the case where @forge/mcp-server dist is not yet available at startup.
let _buildServer = null;
let _runStartupMigrations = null;
let _StreamableHTTPServerTransport = null;
let _booted = false;
let _bootError = null;

async function ensureBooted() {
  if (_booted) return;
  if (_bootError) throw _bootError;
  try {
    const mcpServerMod = await import('@forge/mcp-server');
    const sdkMod = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    _buildServer = mcpServerMod.buildServer;
    _runStartupMigrations = mcpServerMod.startMcpServer
      // runStartupMigrations is exported from @forge/core, re-exported through @forge/mcp-server
      ? null
      : null;
    // Import runStartupMigrations from @forge/core directly
    const coreMod = await import('@forge/core');
    _runStartupMigrations = coreMod.runStartupMigrations;
    _StreamableHTTPServerTransport = sdkMod.StreamableHTTPServerTransport;

    // Run startup migrations (creates forge.yaml on first boot)
    await _runStartupMigrations();

    _booted = true;
    console.log('[forge-local-mcp] Forge MCP engine initialized');
  } catch (err) {
    _bootError = err;
    console.error('[forge-local-mcp] Failed to initialize Forge MCP engine:', err.message);
    throw err;
  }
}

// Session registry: maps sessionId -> { transport, lastSeen }
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const sessions = new Map();

// Periodic TTL sweeper
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [sid, e] of sessions) {
    if (now - e.lastSeen > SESSION_TTL_MS) {
      sessions.delete(sid);
      console.log(`[forge-local-mcp] Session evicted (TTL): ${sid}`);
    }
  }
}, 60_000);
sweeper.unref();

// Boot eagerly so first request is not slow
ensureBooted().catch(() => {
  // Error is stored in _bootError; requests will get a 503.
});

/**
 * Express router. Mounts at /forge via app.use('/forge', forgeMcpRouter).
 * The full MCP endpoint URL becomes: POST /forge/mcp
 */
export const forgeMcpRouter = Router();

// GET /health — Forge engine liveness (used by system-status)
forgeMcpRouter.get('/health', (_req, res) => {
  if (_bootError) {
    return res.status(503).json({
      status: 'error',
      service: 'forge-local',
      error: _bootError.message,
    });
  }
  res.json({
    status: _booted ? 'ok' : 'initializing',
    service: 'forge-local',
    embedded: true,
  });
});

// ALL /mcp — Forge MCP StreamableHTTP endpoint
forgeMcpRouter.all('/mcp', async (req, res) => {
  try {
    await ensureBooted();
  } catch (err) {
    return res.status(503).json({ error: 'Forge MCP engine failed to initialize', detail: err.message });
  }

  const workspaceRoot = process.env.FORGE_WORKSPACE_PATH ?? process.cwd();

  try {
    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    let transport;

    if (sessionId && !entry) {
      // Session ID provided but unknown (server restarted or session expired).
      // Recover transparently: create a stateless transport (no sessionIdGenerator)
      // which bypasses the SDK's session validation and init enforcement.
      const server = _buildServer(workspaceRoot);
      transport = new _StreamableHTTPServerTransport({ enableJsonResponse: true });
      transport.onclose = () => {
        sessions.delete(sessionId);
      };
      await server.connect(transport);
      entry = { transport, lastSeen: Date.now() };
      sessions.set(sessionId, entry);
    } else if (!entry) {
      // No session ID = new session request (initialize handshake).
      const server = _buildServer(workspaceRoot);
      transport = new _StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, lastSeen: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };
      await server.connect(transport);
    } else {
      // Known session — refresh last-seen timestamp.
      entry.lastSeen = Date.now();
      transport = entry.transport;
    }

    // Adapt Express req/res to Node http.IncomingMessage / http.ServerResponse
    // The SDK's handleRequest accepts both directly.
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[forge-local-mcp] Request handling failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  }
});
