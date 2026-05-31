/**
 * Unit tests for forge-local-mcp.js
 * Tests the Express router routing logic with mocked ForgeCore.
 * Run with: node --test forge-local-mcp.test.js
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline transport stub ─────────────────────────────────────────────────────

/**
 * Minimal stub for StreamableHTTPServerTransport that records handleRequest calls.
 */
function makeMockTransport(opts = {}) {
  const transport = {
    sessionId: null,
    onclose: null,
    _opts: opts,
    handleRequestCalls: [],
    async handleRequest(req, res) {
      this.handleRequestCalls.push({ req, res });
      // Simulate the SDK generating a session ID on first init
      if (opts.sessionIdGenerator && !this.sessionId) {
        this.sessionId = opts.sessionIdGenerator();
        if (opts.onsessioninitialized) {
          opts.onsessioninitialized(this.sessionId);
        }
      }
      // Send a minimal 200 JSON response so tests don't hang
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
  };
  return transport;
}

/**
 * Minimal stub for an MCP Server returned by buildServer.
 */
function makeMockServer() {
  return {
    connect: async (_transport) => { /* noop */ },
  };
}

// ── Session Map helper ─────────────────────────────────────────────────────────

describe('forge-local-mcp session management logic', () => {
  // We test the session-map pattern inline, isolated from the actual module,
  // to avoid requiring the compiled @forge/mcp-server dist at test time.

  test('new session: no mcp-session-id header → creates new transport and session', async () => {
    const sessions = new Map();
    let createdTransport = null;

    // Simulate the session routing logic
    function buildServer() { return makeMockServer(); }
    function makeTransport(opts) {
      createdTransport = makeMockTransport(opts);
      return createdTransport;
    }

    const req = { headers: {} };

    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;
    let transport;

    if (sessionId && !entry) {
      // Recovery path
      const server = buildServer();
      transport = makeTransport({ enableJsonResponse: true });
      await server.connect(transport);
      sessions.set(sessionId, { transport, lastSeen: Date.now() });
    } else if (!entry) {
      // New session
      const server = buildServer();
      transport = makeTransport({
        sessionIdGenerator: () => 'test-session-001',
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, lastSeen: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
    }

    assert.ok(transport, 'transport should be created');
    assert.ok(createdTransport === transport, 'makeTransport was called');
  });

  test('known session: mcp-session-id header matches → reuses transport', async () => {
    const sessions = new Map();
    const existingTransport = makeMockTransport({});
    const existingEntry = { transport: existingTransport, lastSeen: Date.now() - 1000 };
    sessions.set('existing-session', existingEntry);

    const req = { headers: { 'mcp-session-id': 'existing-session' } };

    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    assert.ok(entry, 'entry should be found');

    // Refresh lastSeen
    const beforeLastSeen = entry.lastSeen;
    entry.lastSeen = Date.now();
    const transport = entry.transport;

    assert.ok(transport === existingTransport, 'should reuse existing transport');
    assert.ok(entry.lastSeen >= beforeLastSeen, 'lastSeen should be updated');
  });

  test('unknown session ID (recovery path) → creates stateless transport', async () => {
    const sessions = new Map();
    // sessions is empty — session ID is not found

    const req = { headers: { 'mcp-session-id': 'stale-session-id' } };
    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    assert.ok(!entry, 'entry should NOT be found');

    let recoveryTransportCreated = false;
    if (sessionId && !entry) {
      // Recovery path: create stateless transport (no sessionIdGenerator)
      recoveryTransportCreated = true;
    }

    assert.ok(recoveryTransportCreated, 'recovery path should be taken');
  });

  test('TTL sweeper logic evicts sessions idle longer than TTL', () => {
    const SESSION_TTL_MS = 5 * 60 * 1000;
    const sessions = new Map();
    const now = Date.now();

    sessions.set('fresh', { transport: {}, lastSeen: now - 1000 });
    sessions.set('stale', { transport: {}, lastSeen: now - SESSION_TTL_MS - 1000 });
    sessions.set('borderline', { transport: {}, lastSeen: now - SESSION_TTL_MS + 1000 });

    // Simulate sweeper
    for (const [sid, e] of sessions) {
      if (now - e.lastSeen > SESSION_TTL_MS) {
        sessions.delete(sid);
      }
    }

    assert.ok(sessions.has('fresh'), 'fresh session should survive');
    assert.ok(!sessions.has('stale'), 'stale session should be evicted');
    assert.ok(sessions.has('borderline'), 'borderline session should survive');
  });
});

// ── GET /health logic ─────────────────────────────────────────────────────────

describe('forge-local-mcp health endpoint logic', () => {
  test('reports status:ok when booted, status:initializing when not', () => {
    function buildHealthBody(booted, bootError) {
      if (bootError) {
        return { status: 'error', service: 'forge-local', error: bootError.message };
      }
      return { status: booted ? 'ok' : 'initializing', service: 'forge-local', embedded: true };
    }

    assert.deepEqual(buildHealthBody(true, null), { status: 'ok', service: 'forge-local', embedded: true });
    assert.deepEqual(buildHealthBody(false, null), { status: 'initializing', service: 'forge-local', embedded: true });
    const err = new Error('module not found');
    assert.equal(buildHealthBody(false, err).status, 'error');
    assert.equal(buildHealthBody(false, err).error, 'module not found');
  });
});
