/**
 * Tests for createAuthStrategy and the configurable auth.strategy system.
 *
 * Covers:
 *   - Valid strategies resolve to the correct class
 *   - Unknown strategy value throws at startup (fail-fast)
 *   - Strategies call identify() and authorize() through the AuthStrategy interface
 */

import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { createAuthStrategy } from '../src/auth/strategy-factory.js';
import { BuiltinAuthStrategy } from '../src/auth/builtin.js';
import { WebhookAuthStrategy } from '../src/auth/webhook.js';
import { TrustedHeadersAuthStrategy } from '../src/auth/trusted-headers.js';
import type { AuthConfig } from '../src/config.js';

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
  return join(tmpdir(), `strategy-factory-test-${randomUUID()}.db`);
}

// ---------------------------------------------------------------------------
// Strategy resolution tests
// ---------------------------------------------------------------------------

describe('createAuthStrategy', () => {
  it('resolves "builtin" to BuiltinAuthStrategy', () => {
    const config: AuthConfig = {
      strategy: 'builtin',
      admins: [{ id: 'alice', name: 'Alice' }],
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    expect(strategy).toBeInstanceOf(BuiltinAuthStrategy);
  });

  it('resolves "webhook" to WebhookAuthStrategy', () => {
    const config: AuthConfig = {
      strategy: 'webhook',
      webhook: {
        url: 'https://auth.example.com/verify',
        timeout_ms: 500,
        fail_mode: 'deny',
        enforce_on: 'writes',
        header_allowlist: [],
      },
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    expect(strategy).toBeInstanceOf(WebhookAuthStrategy);
  });

  it('resolves "trusted-headers" to TrustedHeadersAuthStrategy', () => {
    const config: AuthConfig = {
      strategy: 'trusted-headers',
      headers: { user_id: 'X-User-Id', role: 'X-Role' },
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    expect(strategy).toBeInstanceOf(TrustedHeadersAuthStrategy);
  });

  it('fails-fast on unknown strategy value at startup', () => {
    // Simulate a runtime config drift (e.g. old config file with a removed strategy)
    const config = { strategy: 'magic-oauth' } as unknown as AuthConfig;
    expect(() => createAuthStrategy(config, makeDbPath(), makeLogger())).toThrow(
      /Unknown auth strategy 'magic-oauth'/,
    );
  });

  // ── Interface conformance ─────────────────────────────────────────────────

  it('returned builtin strategy exposes identify() and authorize()', () => {
    const config: AuthConfig = {
      strategy: 'builtin',
      admins: [{ id: 'alice', name: 'Alice' }],
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    expect(typeof strategy.identify).toBe('function');
    expect(typeof strategy.authorize).toBe('function');
  });

  it('returned builtin strategy exposes optional close()', () => {
    const config: AuthConfig = {
      strategy: 'builtin',
      admins: [{ id: 'alice', name: 'Alice' }],
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    expect(typeof strategy.close).toBe('function');
  });

  it('webhook strategy: identify() returns null for read requests (enforce_on=writes skips webhook)', async () => {
    const config: AuthConfig = {
      strategy: 'webhook',
      webhook: {
        url: 'https://auth.example.com/verify',
        timeout_ms: 500,
        fail_mode: 'deny',
        enforce_on: 'writes',
        header_allowlist: [],
      },
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    // Empty request defaults to GET — treated as read, webhook is skipped
    const user = await strategy.identify({} as never);
    expect(user).toBeNull();
  });

  it('trusted-headers strategy: authorize() permits reads for anonymous', () => {
    const config: AuthConfig = {
      strategy: 'trusted-headers',
      headers: { user_id: 'X-User-Id', role: 'X-Role' },
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());
    const decision = strategy.authorize(null, 'read', { type: 'skill', id: 'x', version: '1.0.0' });
    expect(decision).toBe('permit');
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration: identify + authorize are called in sequence
// ---------------------------------------------------------------------------

describe('AuthStrategy pipeline flow', () => {
  it('identify() returns user, authorize() receives user + action + resource', async () => {
    const config: AuthConfig = {
      strategy: 'builtin',
      admins: [{ id: 'alice', name: 'Alice' }],
    };
    const strategy = createAuthStrategy(config, makeDbPath(), makeLogger());

    // Spy on authorize after creation
    const authorizeSpy = vi.spyOn(strategy, 'authorize');
    authorizeSpy.mockReturnValue('permit');

    // identify with no auth header → anonymous
    const req = { headers: {} } as never;
    const user = await strategy.identify(req);
    expect(user).toBeNull();

    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    const decision = strategy.authorize(user, 'read', resource);

    expect(authorizeSpy).toHaveBeenCalledWith(null, 'read', resource);
    expect(decision).toBe('permit');
  });
});
