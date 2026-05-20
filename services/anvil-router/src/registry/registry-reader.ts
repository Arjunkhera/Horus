/**
 * RegistryReader — reads the Operator-written SQLite service registry.
 *
 * The registry table schema (written by the Operator):
 *
 *   CREATE TABLE service_registry (
 *     tenant              TEXT NOT NULL,
 *     user                TEXT NOT NULL,
 *     url                 TEXT NOT NULL,
 *     schema_version      INTEGER NOT NULL DEFAULT 1,
 *     status              TEXT NOT NULL DEFAULT 'active',
 *     last_provisioned_at TEXT,
 *     PRIMARY KEY (tenant, user)
 *   );
 *
 * On lookup:
 *   - Cache hit  → return cached RegistryEntry (no DB read)
 *   - Cache miss → query DB, validate, cache (if found), return
 *   - Not found  → throw RouteResolutionError({ code: 'REGISTRY_MISS', retryAfter: 30 })
 *
 * schema_version handling:
 *   - version 1 → accepted normally
 *   - unknown   → log a warning and continue (fail-open, per alpha spec)
 *
 * Uses node-sqlite3-wasm (same WASM SQLite build as packages/anvil) — no native binaries.
 */

import { createRequire } from 'node:module';
import { type RegistryEntry, RouteResolutionError } from '@horus/router-core';
import { TtlCache } from './cache.js';

const _require = createRequire(import.meta.url);

// node-sqlite3-wasm exposes a synchronous API identical in shape to better-sqlite3.
const { Database } = _require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
export type SqliteDb = InstanceType<typeof Database>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_SCHEMA_VERSIONS = new Set([1]);
const DEFAULT_TTL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Row shape returned from SQLite
// ---------------------------------------------------------------------------

interface RegistryRow {
  tenant: string;
  user: string;
  url: string;
  schema_version: number;
  status: string;
  last_provisioned_at: string | null;
}

// ---------------------------------------------------------------------------
// RegistryReader
// ---------------------------------------------------------------------------

export class RegistryReader {
  private readonly db: SqliteDb;
  private readonly cache: TtlCache<RegistryEntry>;

  /**
   * @param db     An open node-sqlite3-wasm Database instance. In production
   *               this is opened from ANVIL_REGISTRY_PATH; in tests it is an
   *               in-memory DB pre-seeded with fixture rows.
   * @param ttlMs  Cache TTL in milliseconds (default: 60 000).
   */
  constructor(db: SqliteDb, ttlMs: number = DEFAULT_TTL_MS) {
    this.db = db;
    this.cache = new TtlCache<RegistryEntry>(ttlMs);
  }

  /**
   * Resolve a (tenant, user) pair to a RegistryEntry.
   *
   * @throws {RouteResolutionError} code=REGISTRY_MISS if no row found.
   * @throws {Error} for DB or validation failures.
   */
  lookup(tenant: string, user: string): RegistryEntry {
    const cacheKey = `${tenant}\0${user}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Query DB
    const row = this.db.get(
      `SELECT tenant, user, url, schema_version, status, last_provisioned_at
         FROM service_registry
        WHERE tenant = ? AND user = ?`,
      [tenant, user],
    ) as unknown as RegistryRow | null | undefined;

    if (row === undefined || row === null) {
      throw new RouteResolutionError(
        'REGISTRY_MISS',
        `No registry entry for tenant="${tenant}" user="${user}" — provisioning may still be in progress`,
        { retryAfter: 30 },
      );
    }

    // schema_version guard (fail-open for alpha)
    if (!KNOWN_SCHEMA_VERSIONS.has(row.schema_version)) {
      console.warn(
        `[registry-reader] Unknown schema_version=${row.schema_version} for tenant="${tenant}" user="${user}" — proceeding anyway (fail-open)`,
        { tenant, user, schema_version: row.schema_version },
      );
    }

    // Validate required fields are present before casting
    if (typeof row.url !== 'string') {
      throw new Error(
        `[registry-reader] Row for tenant="${tenant}" user="${user}" is missing the "url" column — registry schema mismatch`,
      );
    }

    const entry: RegistryEntry = {
      tenant: row.tenant,
      user: row.user,
      url: row.url,
      schema_version: row.schema_version,
      status: (row.status as RegistryEntry['status']) ?? 'active',
      ...(row.last_provisioned_at != null
        ? { last_provisioned_at: row.last_provisioned_at }
        : {}),
    };

    this.cache.set(cacheKey, entry);
    return entry;
  }

  /**
   * Manually invalidate the cache entry for a principal.
   * Useful for testing and for future forced-refresh scenarios.
   */
  invalidate(tenant: string, user: string): void {
    this.cache.delete(`${tenant}\0${user}`);
  }

  /**
   * Flush the entire cache (e.g. after a registry wipe in tests).
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory — open a RegistryReader from ANVIL_REGISTRY_PATH env var
// ---------------------------------------------------------------------------

export function createRegistryReader(ttlMs: number = DEFAULT_TTL_MS): RegistryReader {
  const registryPath = process.env['ANVIL_REGISTRY_PATH'];
  if (!registryPath) {
    throw new Error(
      'ANVIL_REGISTRY_PATH env var is not set — cannot open SQLite registry',
    );
  }
  const db = new Database(registryPath);
  return new RegistryReader(db, ttlMs);
}
