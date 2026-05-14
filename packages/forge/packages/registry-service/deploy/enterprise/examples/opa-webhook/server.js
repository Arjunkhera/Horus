/**
 * opa-webhook — tiny Node.js HTTP server that wraps OPA's REST API.
 *
 * The Forge Registry calls:
 *   POST /v1/authz/decide
 *
 * This server forwards the request body to OPA's data API, evaluates the
 * forge.registry.authz package, and returns { allow: true|false }.
 *
 * OPA is run as a sidecar container (see docker-compose.snippet.yaml).
 *
 * Environment variables:
 *   PORT            — port to listen on (default: 3100)
 *   OPA_URL         — base URL of the OPA REST API (default: http://localhost:8181)
 *   WEBHOOK_SECRET  — optional shared secret. If set, validates the
 *                     Authorization: Bearer <secret> header on incoming calls.
 *
 * Usage (standalone, without Docker):
 *   node server.js
 *
 * Usage in Docker (see docker-compose.snippet.yaml):
 *   Runs automatically as part of the opa-webhook service.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const OPA_URL = process.env.OPA_URL ?? 'http://localhost:8181';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

// OPA data API path for the forge.registry.authz package
const OPA_POLICY_PATH = '/v1/data/forge/registry/authz';

// ─── Utility: read full request body as JSON ──────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Utility: POST JSON to OPA ────────────────────────────────────────────────
function queryOpa(input) {
  return new Promise((resolve, reject) => {
    const url = new URL(OPA_POLICY_PATH, OPA_URL);
    const body = JSON.stringify({ input });
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`OPA returned HTTP ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`OPA returned invalid JSON: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Health probe (used by Docker compose healthcheck)
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/v1/authz/decide') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Validate shared secret if configured
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== WEBHOOK_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  let input;
  try {
    input = await readBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message) }));
    return;
  }

  let opaResult;
  try {
    opaResult = await queryOpa(input);
  } catch (err) {
    console.error('[opa-webhook] OPA query failed — denying (fail-closed):', err.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ allow: false }));
    return;
  }

  // OPA wraps the result: { result: { allow: true|false } }
  const allow = Boolean(opaResult?.result?.allow);
  console.log(`[opa-webhook] ${input.action} ${input.resource?.type}/${input.resource?.id} → ${allow ? 'ALLOW' : 'DENY'}`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ allow }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[opa-webhook] Listening on :${PORT} — forwarding to OPA at ${OPA_URL}`);
  if (!WEBHOOK_SECRET) {
    console.warn('[opa-webhook] WARNING: WEBHOOK_SECRET is not set — requests are unauthenticated');
  }
});

server.on('error', (err) => {
  console.error('[opa-webhook] Server error:', err);
  process.exit(1);
});
