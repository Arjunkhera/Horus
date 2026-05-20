/**
 * TA-2 — RED spec: @horus/router-core contract types
 *
 * Validates:
 * - RegistryEntry shape (tenant, user, url, schema_version, status, last_provisioned_at)
 * - RouteResolutionError with code + message + optional retryAfter
 * - RouterConfig shape
 * - Principal / ScopeCoordinate re-exports
 * - validateRegistryEntry runtime guard (valid + malformed inputs)
 * - @ts-expect-error compile-time guard for missing required fields
 *
 * RED until @horus/router-core/src is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  validateRegistryEntry,
  RouteResolutionError,
  type RegistryEntry,
  type RouterConfig,
  type Principal,
  type ScopeCoordinate,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Type-level shape assertions (compile-time — @ts-expect-error)
// ---------------------------------------------------------------------------

describe('RegistryEntry type shape', () => {
  it('accepts a fully valid RegistryEntry', () => {
    const entry = {
      tenant: 'acme',
      user: 'alice',
      url: 'https://anvil.acme.internal',
      schema_version: 1,
      status: 'active',
      last_provisioned_at: '2026-05-20T00:00:00.000Z',
    } satisfies RegistryEntry;

    expect(entry.tenant).toBe('acme');
    expect(entry.user).toBe('alice');
    expect(entry.url).toBe('https://anvil.acme.internal');
    expect(entry.schema_version).toBe(1);
    expect(entry.status).toBe('active');
    expect(typeof entry.last_provisioned_at).toBe('string');
  });

  it('detects missing required tenant field at runtime via validateRegistryEntry', () => {
    // @ts-expect-error — deliberate malformed: missing tenant
    const bad: RegistryEntry = {
      user: 'alice',
      url: 'https://anvil.acme.internal',
      schema_version: 1,
      status: 'active',
      last_provisioned_at: '2026-05-20T00:00:00.000Z',
    };

    const result = validateRegistryEntry(bad as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RouteResolutionError);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('detects missing required url field at runtime via validateRegistryEntry', () => {
    const bad = {
      tenant: 'acme',
      user: 'alice',
      schema_version: 1,
      status: 'active',
      last_provisioned_at: '2026-05-20T00:00:00.000Z',
    };
    const result = validateRegistryEntry(bad as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RouteResolutionError);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('detects non-string url field at runtime', () => {
    const bad = {
      tenant: 'acme',
      user: 'alice',
      url: 42,
      schema_version: 1,
      status: 'active',
      last_provisioned_at: '2026-05-20T00:00:00.000Z',
    };
    const result = validateRegistryEntry(bad as unknown);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RouteResolutionError
// ---------------------------------------------------------------------------

describe('RouteResolutionError', () => {
  it('constructs with code and message', () => {
    const err = new RouteResolutionError('REGISTRY_MISS', 'tenant not provisioned');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RouteResolutionError);
    expect(err.code).toBe('REGISTRY_MISS');
    expect(err.message).toBe('tenant not provisioned');
    expect(err.retryAfter).toBeUndefined();
  });

  it('constructs with optional retryAfter (425 use-case)', () => {
    const err = new RouteResolutionError('REGISTRY_MISS', 'not ready', { retryAfter: 5 });
    expect(err.retryAfter).toBe(5);
  });

  it('constructs INSTANCE_UNAVAILABLE (503 use-case)', () => {
    const err = new RouteResolutionError('INSTANCE_UNAVAILABLE', 'instance is down');
    expect(err.code).toBe('INSTANCE_UNAVAILABLE');
    expect(err.retryAfter).toBeUndefined();
  });

  it('constructs VALIDATION_ERROR', () => {
    const err = new RouteResolutionError('VALIDATION_ERROR', 'bad input');
    expect(err.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// RouterConfig shape
// ---------------------------------------------------------------------------

describe('RouterConfig type shape', () => {
  it('accepts a valid RouterConfig', () => {
    const config = {
      registryDbPath: '/data/registry.db',
      ttlSeconds: 60,
      upstreamTimeoutMs: 5000,
    } satisfies RouterConfig;

    expect(config.registryDbPath).toBe('/data/registry.db');
    expect(config.ttlSeconds).toBe(60);
    expect(config.upstreamTimeoutMs).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Re-exports (Principal + ScopeCoordinate from @horus/auth / @horus/scope)
// ---------------------------------------------------------------------------

describe('re-exports from @horus/auth and @horus/scope', () => {
  it('re-exports Principal type (compile-time check via satisfies)', () => {
    const p = { tenant: 't1', user: 'u1', role: 'admin' } satisfies Principal;
    expect(p.tenant).toBe('t1');
  });

  it('re-exports ScopeCoordinate type', () => {
    const sc = { key: 't:acme/u:alice/s:anvil', tenant: 'acme', user: 'alice' } satisfies ScopeCoordinate;
    expect(sc.key).toContain('acme');
  });
});

// ---------------------------------------------------------------------------
// validateRegistryEntry — happy path
// ---------------------------------------------------------------------------

describe('validateRegistryEntry happy path', () => {
  it('returns ok:true for a fully valid entry', () => {
    const good = {
      tenant: 'acme',
      user: 'alice',
      url: 'https://anvil.acme.internal',
      schema_version: 1,
      status: 'active',
      last_provisioned_at: '2026-05-20T00:00:00.000Z',
    };
    const result = validateRegistryEntry(good);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tenant).toBe('acme');
    }
  });

  it('returns ok:true when optional last_provisioned_at is absent', () => {
    const entry = {
      tenant: 'acme',
      user: 'alice',
      url: 'https://anvil.acme.internal',
      schema_version: 1,
      status: 'provisioning',
    };
    const result = validateRegistryEntry(entry);
    expect(result.ok).toBe(true);
  });
});
