/**
 * mock-anvil.mjs — Lightweight mock Anvil HTTP server for remoting tests.
 *
 * Used as the per-user Anvil instances in the opt-in remoting compose profile.
 * Responds to all HTTP methods on all paths; echoes which "tenant/user" was
 * reached so integration tests can assert routing correctness.
 *
 * Configuration via env vars:
 *   MOCK_ANVIL_USER_LABEL  — identifier baked into every response ("user-a" / "user-b")
 *   MOCK_ANVIL_PORT        — port to listen on (default: 8201)
 *
 * Special routes:
 *   GET /health    → { status: "ok", servedBy: <label> }
 *   GET /api/events → SSE stream emitting events tagged with <label>
 *   * (any other)  → { ok: true, servedBy: <label>, path: <path>, method: <method> }
 */

import { createServer } from 'node:http';

const userLabel = process.env['MOCK_ANVIL_USER_LABEL'] ?? 'unknown';
const port = parseInt(process.env['MOCK_ANVIL_PORT'] ?? '8201', 10);

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  // ── Health endpoint ────────────────────────────────────────────────────────
  if (url === '/health' && method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', servedBy: userLabel }));
    return;
  }

  // ── SSE endpoint ──────────────────────────────────────────────────────────
  if (url === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();

    let i = 0;
    const emit = () => {
      if (i >= 5) {
        res.end();
        return;
      }
      res.write(`data: ${userLabel}-event-${i}\n\n`);
      i++;
      setTimeout(emit, 100);
    };
    emit();
    return;
  }

  // ── All other endpoints ────────────────────────────────────────────────────
  // Drain request body (important for POST/PUT)
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let requestBody = null;
    if (chunks.length > 0) {
      try {
        requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      } catch {
        requestBody = Buffer.concat(chunks).toString('utf-8');
      }
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      servedBy: userLabel,
      path: url,
      method,
      ...(requestBody !== null ? { requestBody } : {}),
    }));
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`mock-anvil (${userLabel}) listening on 0.0.0.0:${port}`);
});

server.on('error', (err) => {
  console.error(`mock-anvil (${userLabel}) error:`, err);
  process.exit(1);
});
