/**
 * RED spec — TA-3: SQLite registry reader + 60s TTL cache
 *
 * AC covered:
 *   (a) Cache hit returns entry without re-querying DB
 *   (b) Cache miss queries DB and returns entry
 *   (c) Missing registry entry throws RouteResolutionError with REGISTRY_MISS code
 *   (d) 425 response shape is correct (via Fastify app injection)
 *   (e) TTL expiry causes re-query on next call
 *   (f) schema_version read & validation — unknown versions log warning but succeed
 *   (g) Missing column (schema mismatch) produces a meaningful error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Helpers — create an in-memory SQLite DB pre-seeded for tests
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);
const { Database } = _require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');

const REGISTRY_DDL = `
  CREATE TABLE IF NOT EXISTS service_registry (
    tenant       TEXT NOT NULL,
    user         TEXT NOT NULL,
    url          TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    status       TEXT NOT NULL DEFAULT 'active',
    last_provisioned_at TEXT,
    PRIMARY KEY (tenant, user)
  );
`;

function createMemoryDb() {
  const db = new Database();
  db.exec(REGISTRY_DDL);
  return db;
}

function seedEntry(
  db: InstanceType<typeof Database>,
  tenant: string,
  user: string,
  url: string,
  schema_version = 1,
  status = 'active',
) {
  db.run(
    `INSERT INTO service_registry (tenant, user, url, schema_version, status)
     VALUES (?, ?, ?, ?, ?)`,
    [tenant, user, url, schema_version, status],
  );
}

// ---------------------------------------------------------------------------
// SUT imports (will fail RED until implementation is in place)
// ---------------------------------------------------------------------------

import { RegistryReader } from '../src/registry/registry-reader.js';
import { TtlCache } from '../src/registry/cache.js';
import { RouteResolutionError } from '@horus/router-core';

// ---------------------------------------------------------------------------
// TtlCache unit tests
// ---------------------------------------------------------------------------

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a value', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
  });

  it('returns undefined for unknown key', () => {
    const cache = new TtlCache<string>(60_000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns value within TTL window', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('k', 'hello');
    vi.advanceTimersByTime(59_999);
    expect(cache.get('k')).toBe('hello');
  });

  it('evicts entry after TTL expires', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('k', 'hello');
    vi.advanceTimersByTime(60_001);
    expect(cache.get('k')).toBeUndefined();
  });

  it('deletes an entry', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('k', 'v');
    cache.delete('k');
    expect(cache.get('k')).toBeUndefined();
  });

  it('clears all entries', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RegistryReader unit tests
// ---------------------------------------------------------------------------

describe('RegistryReader — cache hit / miss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns entry from DB on first lookup (cache miss)', () => {
    const db = createMemoryDb();
    seedEntry(db, 'acme', 'alice', 'http://anvil-alice.internal');
    const reader = new RegistryReader(db, 60_000);
    const result = reader.lookup('acme', 'alice');
    expect(result).toMatchObject({ url: 'http://anvil-alice.internal', tenant: 'acme', user: 'alice' });
  });

  it('returns cached entry on second lookup without hitting DB', () => {
    const db = createMemoryDb();
    seedEntry(db, 'acme', 'alice', 'http://anvil-alice.internal');
    const querySpy = vi.spyOn(db, 'get');
    const reader = new RegistryReader(db, 60_000);

    reader.lookup('acme', 'alice'); // populates cache
    reader.lookup('acme', 'alice'); // should come from cache

    // DB's get should only be called once (first lookup)
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('re-queries DB after TTL expires', () => {
    const db = createMemoryDb();
    seedEntry(db, 'acme', 'alice', 'http://anvil-alice.internal');
    const querySpy = vi.spyOn(db, 'get');
    const reader = new RegistryReader(db, 60_000);

    reader.lookup('acme', 'alice');
    vi.advanceTimersByTime(60_001); // TTL expired
    reader.lookup('acme', 'alice');

    expect(querySpy).toHaveBeenCalledTimes(2);
  });

  it('throws RouteResolutionError with REGISTRY_MISS when principal not found', () => {
    const db = createMemoryDb();
    const reader = new RegistryReader(db, 60_000);

    expect(() => reader.lookup('acme', 'ghost')).toThrow(RouteResolutionError);
    try {
      reader.lookup('acme', 'ghost');
    } catch (err) {
      expect(err).toBeInstanceOf(RouteResolutionError);
      expect((err as RouteResolutionError).code).toBe('REGISTRY_MISS');
      expect((err as RouteResolutionError).retryAfter).toBe(30);
    }
  });

  it('does not cache a REGISTRY_MISS (each miss queries DB)', () => {
    const db = createMemoryDb();
    const querySpy = vi.spyOn(db, 'get');
    const reader = new RegistryReader(db, 60_000);

    expect(() => reader.lookup('acme', 'ghost')).toThrow();
    expect(() => reader.lookup('acme', 'ghost')).toThrow();

    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// schema_version validation
// ---------------------------------------------------------------------------

describe('RegistryReader — schema_version', () => {
  it('succeeds and returns entry for known schema_version (1)', () => {
    const db = createMemoryDb();
    seedEntry(db, 'acme', 'bob', 'http://anvil-bob.internal', 1);
    const reader = new RegistryReader(db, 60_000);
    const result = reader.lookup('acme', 'bob');
    expect(result.url).toBe('http://anvil-bob.internal');
  });

  it('emits a warning for unknown schema_version but still returns the entry (fail-open)', () => {
    const db = createMemoryDb();
    seedEntry(db, 'acme', 'carol', 'http://anvil-carol.internal', 99);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reader = new RegistryReader(db, 60_000);
    const result = reader.lookup('acme', 'carol');
    expect(result.url).toBe('http://anvil-carol.internal');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema_version'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Schema mismatch (missing column)
// ---------------------------------------------------------------------------

describe('RegistryReader — schema mismatch', () => {
  it('throws a meaningful error when the url column is missing from the table', () => {
    const db = new Database();
    // Table without the required url column
    db.exec(`
      CREATE TABLE service_registry (
        tenant TEXT NOT NULL,
        user   TEXT NOT NULL,
        PRIMARY KEY (tenant, user)
      );
      INSERT INTO service_registry (tenant, user) VALUES ('acme', 'dave');
    `);
    const reader = new RegistryReader(db, 60_000);
    expect(() => reader.lookup('acme', 'dave')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fastify route — 425 response shape
// ---------------------------------------------------------------------------

describe('anvil-router — 425 Too Early response shape', () => {
  it('returns 425 with Retry-After header and JSON body when registry miss occurs', async () => {
    const { buildServer } = await import('../src/app.js');
    const db = createMemoryDb(); // empty — all lookups will miss
    const app = await buildServer({ registryDb: db });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/lookup?tenant=acme&user=nobody',
    });

    expect(res.statusCode).toBe(425);
    expect(res.headers['retry-after']).toBe('30');
    const body = JSON.parse(res.payload);
    expect(body).toMatchObject({
      error: {
        code: 'REGISTRY_MISS',
        message: expect.any(String),
        retryAfter: 30,
      },
    });

    await app.close();
  });
});
