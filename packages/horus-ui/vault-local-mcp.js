/**
 * vault-local-mcp.js — In-process Vault (knowledge_*) MCP router for horus-ui.
 *
 * Connected mode only. The control plane serves the vault as a REST API
 * (`/api/v1/vault/{get-page,search,list-by-scope,...}`) but exposes NO MCP
 * JSON-RPC endpoint. Forwarding `/vault/mcp` straight to the CP therefore 404s.
 *
 * This router closes that gap the same way Forge does (see forge-local-mcp.js):
 * it embeds an MCP server inside the horus-ui process. The server is the
 * `@vault/knowledge-mcp` adapter — the single source of truth for the 17
 * knowledge_* tool definitions and their REST mapping — pointed at the CP REST
 * base and authenticated with the client's bearer token from the configured
 * token provider. MCP endpoint: POST /vault/mcp. Health: GET /vault/health.
 *
 * Mounted by server.js only when HORUS_CONTROL_PLANE_URL is set:
 *   app.use('/vault', vaultMcpRouter)
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from '@vault/knowledge-mcp';
import { getToken } from './token-provider.js';

const CONTROL_PLANE_URL = (process.env.HORUS_CONTROL_PLANE_URL || '').trim().replace(/\/$/, '');
// The vault adapter's tool handlers POST to `${endpoint}/search`, `/get-page`,
// etc. The CP mounts those under /api/v1/vault.
const VAULT_REST_BASE = `${CONTROL_PLANE_URL}/api/v1/vault`;

// Session registry: maps sessionId -> { transport, lastSeen }
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const sessions = new Map();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [sid, e] of sessions) {
    if (now - e.lastSeen > SESSION_TTL_MS) {
      sessions.delete(sid);
      console.log(`[vault-local-mcp] Session evicted (TTL): ${sid}`);
    }
  }
}, 60_000);
sweeper.unref();

function newServer() {
  // Re-read the token per request so a refreshed token is picked up.
  return buildServer({ endpoint: VAULT_REST_BASE, getToken });
}

export const vaultMcpRouter = Router();

// GET /health — vault bridge liveness (used by system-status)
vaultMcpRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'vault-local',
    embedded: true,
    control_plane: VAULT_REST_BASE,
  });
});

// ALL /mcp — Vault knowledge MCP StreamableHTTP endpoint
vaultMcpRouter.all('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    let transport;

    if (sessionId && !entry) {
      // Session ID provided but unknown (server restarted or session expired).
      // Recover transparently with a stateless transport.
      const server = newServer();
      transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      transport.onclose = () => {
        sessions.delete(sessionId);
      };
      await server.connect(transport);
      entry = { transport, lastSeen: Date.now() };
      sessions.set(sessionId, entry);
    } else if (!entry) {
      // No session ID = new session request (initialize handshake).
      const server = newServer();
      transport = new StreamableHTTPServerTransport({
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
      entry.lastSeen = Date.now();
      transport = entry.transport;
    }

    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[vault-local-mcp] Request handling failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  }
});
