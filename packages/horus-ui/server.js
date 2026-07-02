import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { sseHeaders, sseEvent } from './sse.js';
import {
  chatEnabled,
  getAnthropicClient,
  agentModel,
  describeToolCall,
  runAgentTurn,
  SYSTEM,
} from './agent-service.js';
import { listAnvilTools, callAnvilTool } from './mcp-config.js';
import { getCachedHistory, setCachedHistory } from './agent-cache.js';
import { buildSystemStatus } from './system-status.js';
import { parseCitations } from './citation-parser.js';
import { forgeMcpRouter } from './forge-local-mcp.js';
import { vaultMcpRouter } from './vault-local-mcp.js';
import { getToken } from './token-provider.js';

// The agent chat surface is gated, not fatal: without an Anthropic key the
// server still serves the UI and proxies Anvil — only /api/ai/ask is disabled.
if (!chatEnabled()) {
  console.warn('HORUS_ANTHROPIC_API_KEY is not set — agent chat is disabled (UI and Anvil proxy still run).');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8400;
const ANVIL_HOST = process.env.ANVIL_HOST || 'anvil';
const ANVIL_PORT = process.env.ANVIL_PORT || '8100';
const READER_STATIC = process.env.READER_STATIC || path.join(__dirname, '../horus-ui-client');

const app = express();
// Body parsing is applied PER-ROUTE, never globally. The /forge MCP router and
// the /vault + /api proxies must receive the raw request stream: the MCP
// StreamableHTTP transport reads the POST body itself, and the proxies stream
// it through untouched. A global parser would drain the stream and silently
// break every MCP tool call. Only horus-ui's own JSON routes use jsonParser.
const jsonParser = express.json();

// Health check
app.get('/health', (_req, res) => res.send('ok'));

// ── Forge MCP (in-process) ──────────────────────────────────────────────────
// Mount the embedded Forge MCP engine. MCP endpoint: POST /forge/mcp
// Health endpoint: GET /forge/health
app.use('/forge', forgeMcpRouter);

// ── Vault MCP (connected mode only) ─────────────────────────────────────────
// The control plane serves the vault as a REST API but has NO MCP endpoint, so
// /vault/mcp is handled IN-PROCESS by vaultMcpRouter — it embeds the
// @vault/knowledge-mcp adapter pointed at the CP REST base, authenticated with
// the configured token provider (mirrors how Forge runs in-process). Remaining
// /vault/* paths are proxied straight through to the CP REST endpoints, with
// the same bearer token injected. Forge stays in-process in both modes.
const CONTROL_PLANE_URL = (process.env.HORUS_CONTROL_PLANE_URL || '').trim();
if (CONTROL_PLANE_URL) {
  console.log(`[horus-ui] Connected mode: vault MCP in-process at /vault/mcp → ${CONTROL_PLANE_URL}/api/v1/vault`);
  // Handles /vault/mcp and /vault/health; falls through for other /vault/* paths.
  app.use('/vault', vaultMcpRouter);
  // REST passthrough for non-MCP /vault/* paths (e.g. direct get-page/search).
  app.use(
    '/vault',
    createProxyMiddleware({
      target: CONTROL_PLANE_URL,
      changeOrigin: true,
      pathRewrite: { '^/vault': '/api/v1/vault' },
      // http-proxy-middleware v2 (the installed major) takes top-level
      // onProxyReq/onError callbacks. The v3-style `on: { proxyReq }` nesting is
      // silently ignored under v2, which dropped the Authorization header and
      // made every REST-passthrough /vault/* request hit the CP unauthenticated
      // (401 "Missing Authorization header"). Keep these top-level until the dep
      // is bumped to v3.
      onProxyReq: (proxyReq) => {
        const token = getToken();
        if (token) {
          proxyReq.setHeader('Authorization', `Bearer ${token}`);
        }
      },
      onError: (err, _req, res) => {
        console.error('[horus-ui] Vault proxy error:', err.message);
        if (res.headersSent) return;
        // Distinguish "can't reach the control plane at all" (off-VPN / DNS
        // flap) from the control plane answering with an error. The client keys
        // off `controlPlaneUnreachable` to show a "check your VPN" banner
        // instead of a raw proxy error.
        const code = err?.code || err?.cause?.code;
        if (code && CONNECTIVITY_ERROR_CODES.has(code)) {
          res.status(503).json({
            error: 'control_plane_unreachable',
            controlPlaneUnreachable: true,
            code,
            detail:
              'Cannot reach the Horus control plane. Check your VPN / network connection — the app is running, but remote data is temporarily unavailable.',
          });
        } else {
          res.status(502).json({ error: 'Vault proxy error', detail: err.message });
        }
      },
    }),
  );
} else {
  // Local-only mode: /vault/* returns 503 with a helpful message
  app.use('/vault', (_req, res) => {
    res.status(503).json({
      error: 'Vault is not available in local-only mode.',
      hint: 'Set HORUS_CONTROL_PLANE_URL to enable connected mode.',
    });
  });
}

// DELETE /api/notes/:id — must be registered before the proxy
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[delete] DELETE /api/notes/${id}`);
  try {
    const anvilRes = await fetch(
      `http://${ANVIL_HOST}:${ANVIL_PORT}/api/notes/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    if (anvilRes.status === 404) {
      console.log(`[delete] NOT FOUND: ${id}`);
      return res.status(404).json({ error: 'Note not found' });
    }
    if (!anvilRes.ok) {
      const body = await anvilRes.text();
      console.error(`[delete] Anvil error ${anvilRes.status}: ${body}`);
      return res.status(500).json({ error: 'Delete failed' });
    }
    console.log(`[delete] OK: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[delete] Error: ${err.message}`);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// PATCH /api/notes/:id — update note body; must be registered before the proxy
app.patch('/api/notes/:id', jsonParser, async (req, res) => {
  const { id } = req.params;
  const body = req.body?.body;
  if (typeof body !== 'string') {
    return res.status(400).json({ error: 'body field is required' });
  }
  if (Buffer.byteLength(body, 'utf8') > 1_048_576) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.log(`[patch] PATCH /api/notes/${id} body_length=${body.length}`);
  try {
    const anvilRes = await fetch(
      `http://${ANVIL_HOST}:${ANVIL_PORT}/api/notes/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }
    );
    if (anvilRes.status === 404) {
      console.log(`[patch] NOT FOUND: ${id}`);
      return res.status(404).json({ error: 'Note not found' });
    }
    if (!anvilRes.ok) {
      const text = await anvilRes.text();
      console.error(`[patch] Anvil error ${anvilRes.status}: ${text}`);
      return res.status(500).json({ error: 'Update failed' });
    }
    console.log(`[patch] OK: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[patch] Error: ${err.message}`);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Proxy /api/* → Anvil (except the routes horus-ui handles itself)
const LOCAL_API_PATHS = new Set(['/ai/ask', '/ai/enabled', '/system/status']);
app.use('/api', (req, res, next) => {
  if (LOCAL_API_PATHS.has(req.path)) return next();
  createProxyMiddleware({
    target: `http://${ANVIL_HOST}:${ANVIL_PORT}`,
    changeOrigin: true,
  })(req, res, next);
});

// GET /api/ai/enabled — UI gate. The client disables the Ask surface when false.
app.get('/api/ai/enabled', (_req, res) => {
  res.json({ enabled: chatEnabled() });
});

// Connectivity-class error codes: the host couldn't be resolved or reached at
// all (off-VPN / DNS flap / connection refused / timed out) — as opposed to the
// host answering with an HTTP error. Used to tell the user "check your VPN"
// rather than showing a generic failure.
const CONNECTIVITY_ERROR_CODES = new Set([
  'EAI_AGAIN',   // transient DNS failure (the reported off-VPN symptom)
  'ENOTFOUND',   // DNS name does not resolve
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_CANCELED', // AbortSignal.timeout fired
]);

// Classify a thrown fetch error into a coarse reason. AbortSignal.timeout
// rejects with an AbortError (name), not a code, so check both.
function classifyProbeError(err) {
  const code = err?.code || err?.cause?.code;
  if (code && CONNECTIVITY_ERROR_CODES.has(code)) return { reason: 'network', code };
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return { reason: 'network', code: code || 'ETIMEDOUT' };
  }
  return { reason: 'error', code: code || null };
}

// Probe a /health endpoint, capturing reachability, status, and JSON body.
// On failure, classify WHY so the UI can distinguish a connectivity/VPN problem
// from the remote answering with an error.
async function probeHealth(baseUrl, timeoutMs = 5000) {
  try {
    const resp = await fetch(baseUrl.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await resp.json(); } catch { /* non-JSON health body is fine */ }
    return { reachable: true, httpStatus: resp.status, body };
  } catch (err) {
    const { reason, code } = classifyProbeError(err);
    return { reachable: false, reason, code };
  }
}

// GET /api/system/status — backing-service health for the UI. horus-ui boots
// independently (no depends_on), so this surfaces per-service state.
app.get('/api/system/status', async (_req, res) => {
  const controlPlaneUrl = (process.env.HORUS_CONTROL_PLANE_URL || '').trim();
  const controlPlaneConfigured = !!controlPlaneUrl;

  const [anvilProbe, controlPlaneProbe] = await Promise.all([
    probeHealth(`http://${ANVIL_HOST}:${ANVIL_PORT}`),
    controlPlaneConfigured ? probeHealth(controlPlaneUrl) : Promise.resolve(null),
  ]);

  res.json(
    buildSystemStatus({
      anvilProbe,
      controlPlaneConfigured,
      controlPlaneProbe,
      agentEnabled: chatEnabled(),
    }),
  );
});

// POST /api/ai/ask — NLP agent search with SSE streaming (Anthropic + Anvil MCP)
app.post('/api/ai/ask', jsonParser, async (req, res) => {
  const { question, agentId: reqAgentId } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (!chatEnabled()) {
    return res.status(503).json({ error: 'Agent chat is disabled. Set HORUS_ANTHROPIC_API_KEY to enable it.' });
  }

  res.writeHead(200, sseHeaders());

  const agentId = reqAgentId || randomUUID();
  const toolCallLog = [];
  const TIMEOUT_MS = 90000;
  let timedOut = false;
  let accumulatedText = '';

  const timeout = setTimeout(() => {
    timedOut = true;
    res.write(sseEvent({ type: 'error', text: 'Search took too long. Please try again.' }));
    res.end();
  }, TIMEOUT_MS);

  try {
    const client = await getAnthropicClient();
    const tools = await listAnvilTools();

    // Resume prior history if the client supplied a known agentId.
    const messages = getCachedHistory(agentId) || [];
    messages.push({ role: 'user', content: question });

    res.write(sseEvent({ type: 'status', text: 'thinking…' }));

    for await (const event of runAgentTurn({
      client,
      model: agentModel(),
      system: SYSTEM,
      messages,
      tools,
      callTool: callAnvilTool,
    })) {
      if (timedOut) break;
      if (event.type === 'token') {
        accumulatedText += event.text;
        res.write(sseEvent({ type: 'token', text: event.text }));
      } else if (event.type === 'tool_call') {
        res.write(sseEvent({ type: 'status', text: describeToolCall(event.name) }));
      } else if (event.type === 'tool_result') {
        // Logged for the citation fallback (extractNoteMetadata reads .result).
        toolCallLog.push({ name: event.name, result: event.text });
      }
    }

    clearTimeout(timeout);

    if (!timedOut) {
      setCachedHistory(agentId, messages);
      const parsed = parseCitations(accumulatedText, toolCallLog);
      res.write(sseEvent({ type: 'references', items: parsed.references }));
      res.write(sseEvent({ type: 'followups', items: parsed.followups }));
      res.write(sseEvent({ type: 'done', agentId, answerText: parsed.answerText }));
    }
  } catch (err) {
    clearTimeout(timeout);
    const msg = err?.message || 'Agent temporarily unavailable.';
    if (!timedOut) res.write(sseEvent({ type: 'error', text: msg }));
  }

  if (!timedOut) res.end();
});

// Serve static reader files
app.use(express.static(READER_STATIC, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.jsx')) res.setHeader('Content-Type', 'application/javascript');
  },
}));

// SPA fallback — all non-API, non-static routes serve index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(READER_STATIC, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Horus horus-ui listening on port ${PORT}`);
});
