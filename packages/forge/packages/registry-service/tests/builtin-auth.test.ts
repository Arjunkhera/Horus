/**
 * Tests for BuiltinAuthStrategy.
 *
 * Uses per-test temporary sqlite files in $TMPDIR to avoid cross-test
 * state leakage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BuiltinAuthStrategy } from '../src/auth/builtin.js';
import type { ServiceUser } from '../src/types.js';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function makeDbPath(): string {
  return join(tmpdir(), `builtin-auth-test-${randomUUID()}.db`);
}

function makeRequest(token?: string): { headers: Record<string, string | undefined> } {
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : undefined,
    },
  };
}

const ADMINS = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BuiltinAuthStrategy', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeDbPath();
  });

  it('generates keys for all configured admins on first start', async () => {
    const logger = makeLogger();
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, logger);
    await strat.ready();

    const infoSpy = vi.mocked(logger.info);
    const generationCalls = infoSpy.mock.calls.filter((args) =>
      String(args[1]).includes('save this'),
    );
    expect(generationCalls).toHaveLength(2); // one per admin
  });

  it('does NOT regenerate keys on subsequent starts (idempotent)', async () => {
    const logger1 = makeLogger();
    const strat1 = new BuiltinAuthStrategy(dbPath, ADMINS, logger1);
    await strat1.ready();

    const logger2 = makeLogger();
    const strat2 = new BuiltinAuthStrategy(dbPath, ADMINS, logger2);
    await strat2.ready();

    const info2 = vi.mocked(logger2.info);
    const generationCalls = info2.mock.calls.filter((args) =>
      String(args[1]).includes('save this'),
    );
    expect(generationCalls).toHaveLength(0);
  });

  it('identify() returns ServiceUser for a valid admin key', async () => {
    const capturedKeys: Record<string, string> = {};
    const capturingLogger = {
      ...makeLogger(),
      info: vi.fn((...args: unknown[]) => {
        const msg = String(args[1]);
        const match = /Admin API key for '.*?' \((\w+)\): ([a-f0-9]{64})/.exec(msg);
        if (match) capturedKeys[match[1]] = match[2];
      }),
    } as unknown as FastifyBaseLogger;

    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, capturingLogger);
    // Must await ready() so the async bcrypt hashing completes before we query
    await strat.ready();

    const aliceKey = capturedKeys['alice'];
    expect(aliceKey).toBeTruthy();

    const user = await strat.identify(makeRequest(aliceKey) as never);
    expect(user).not.toBeNull();
    expect((user as ServiceUser).userId).toBe('alice');
    expect((user as ServiceUser).role).toBe('admin');
  });

  it('identify() returns null for missing Authorization header', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const user = await strat.identify(makeRequest() as never);
    expect(user).toBeNull();
  });

  it('identify() returns null for wrong token', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const user = await strat.identify(
      makeRequest('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef') as never,
    );
    expect(user).toBeNull();
  });

  it('identify() returns null when Authorization is not Bearer scheme', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });

  // ── authorize ─────────────────────────────────────────────────────────────

  it('authorize() permits read for anonymous', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    expect(strat.authorize(null, 'read', resource)).toBe('permit');
  });

  it('authorize() permits read for admin', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    const admin: ServiceUser = { userId: 'alice', name: 'Alice', role: 'admin' };
    expect(strat.authorize(admin, 'read', resource)).toBe('permit');
  });

  it('authorize() denies publish for anonymous', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    expect(strat.authorize(null, 'publish', resource)).toBe('deny');
  });

  it('authorize() permits publish for admin', async () => {
    const strat = new BuiltinAuthStrategy(dbPath, ADMINS, makeLogger());
    await strat.ready();
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    const admin: ServiceUser = { userId: 'alice', name: 'Alice', role: 'admin' };
    expect(strat.authorize(admin, 'publish', resource)).toBe('permit');
  });
});
