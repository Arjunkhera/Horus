/**
 * Router deployment profile — single-tenant fallback (TA-8).
 *
 * Reads `ANVIL_DEPLOYMENT_PROFILE` at boot to determine routing mode.
 *
 * Profiles:
 *   single-tenant — bypass the SQLite registry; always proxy to the fixed
 *                   URL in ANVIL_UPSTREAM_URL.  Used for backward-compat with
 *                   pre-alpha single-tenant installs and for test environments.
 *   alpha (default, anything else or unset) — per-user routing via SQLite
 *                   registry (existing behaviour from TA-3/5/6/7).
 *
 * Locked decisions applied:
 *   Q7: Single-tenant kept as a DeploymentProfile variant — no migration script.
 *   TA-8 story: profile selection happens ONCE at boot, not per-request.
 */

import type { RegistryEntry } from '@horus/router-core'
import { RegistryReader, createRegistryReader, type SqliteDb } from '../registry/index.js'

// ---------------------------------------------------------------------------
// Profile types
// ---------------------------------------------------------------------------

export type RouterProfileName = 'alpha' | 'single-tenant'

export interface RouterProfile {
  /** Human-readable mode name surfaced on /health. */
  name: RouterProfileName
  /** The registry implementation selected for this profile. */
  registry: RegistryReader
}

// ---------------------------------------------------------------------------
// SharedRegistry — a static RegistryReader that always returns one fixed URL.
//
// Used in single-tenant mode: no SQLite, no per-user lookup.  Implements the
// same interface as RegistryReader so the proxy handlers remain unchanged.
// ---------------------------------------------------------------------------

export class SharedRegistry implements Pick<RegistryReader, 'lookup' | 'invalidate' | 'clearCache'> {
  private readonly entry: RegistryEntry

  constructor(upstreamUrl: string) {
    // The shared registry presents a synthetic RegistryEntry.
    // tenant/user are set to sentinel values — the proxy handlers never inspect
    // them directly; they only consume entry.url.
    this.entry = {
      tenant: '__shared__',
      user: '__shared__',
      url: upstreamUrl,
      schema_version: 1,
      status: 'active',
    }
  }

  /** Always returns the configured shared upstream URL. */
  lookup(_tenant: string, _user: string): RegistryEntry {
    return this.entry
  }

  /** No-op — no cache to invalidate. */
  invalidate(_tenant: string, _user: string): void {
    // nothing to do
  }

  /** No-op — no cache to clear. */
  clearCache(): void {
    // nothing to do
  }
}

// ---------------------------------------------------------------------------
// LazyRegistryReader — defers createRegistryReader() to the first lookup.
//
// Used in alpha mode when no registryDb is injected (i.e. production path).
// Preserves the original behaviour: ANVIL_REGISTRY_PATH is only required
// when the first request arrives, not at server startup. Routes such as
// /health that don't invoke the registry are unaffected.
// ---------------------------------------------------------------------------

class LazyRegistryReader implements Pick<RegistryReader, 'lookup' | 'invalidate' | 'clearCache'> {
  private _inner: RegistryReader | null = null
  private readonly ttlMs: number

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  private get inner(): RegistryReader {
    if (this._inner === null) {
      this._inner = createRegistryReader(this.ttlMs)
    }
    return this._inner
  }

  lookup(tenant: string, user: string): RegistryEntry {
    return this.inner.lookup(tenant, user)
  }

  invalidate(tenant: string, user: string): void {
    this.inner.invalidate(tenant, user)
  }

  clearCache(): void {
    this.inner.clearCache()
  }
}

// ---------------------------------------------------------------------------
// loadProfile — reads env vars at boot and returns a RouterProfile.
//
// Called ONCE from buildServer() before any routes are registered.
// Throws on misconfiguration so the process fails fast with a clear message.
// ---------------------------------------------------------------------------

/**
 * Options for profile loading. `registryDb` is the same injection seam used
 * by `BuildServerOptions.registryDb` — when provided it bypasses the SQLite
 * factory for alpha mode (used in tests).
 *
 * @internal
 */
export interface LoadProfileOptions {
  /** Pre-opened SQLite DB for alpha mode (test injection only). */
  registryDb?: SqliteDb
  /** Registry TTL override for alpha mode (ms). */
  registryTtlMs?: number
}

export async function loadProfile(opts: LoadProfileOptions = {}): Promise<RouterProfile> {
  const profileEnv = process.env['ANVIL_DEPLOYMENT_PROFILE'] ?? 'alpha'

  if (profileEnv === 'single-tenant') {
    // ── single-tenant mode ──────────────────────────────────────────────────
    const upstreamUrl = process.env['ANVIL_UPSTREAM_URL']
    if (!upstreamUrl) {
      throw new Error(
        'ANVIL_UPSTREAM_URL env var is required when ANVIL_DEPLOYMENT_PROFILE=single-tenant',
      )
    }
    return {
      name: 'single-tenant',
      registry: new SharedRegistry(upstreamUrl) as unknown as RegistryReader,
    }
  }

  // ── alpha (default) mode ────────────────────────────────────────────────
  // When registryDb is injected (test seam), create eagerly.
  // When not injected (production path), wrap in LazyRegistryReader so that
  // ANVIL_REGISTRY_PATH is not required at startup — only on first request.
  const registry: RegistryReader = opts.registryDb !== undefined
    ? new RegistryReader(opts.registryDb, opts.registryTtlMs ?? 60_000)
    : new LazyRegistryReader(opts.registryTtlMs ?? 60_000) as unknown as RegistryReader

  return {
    name: 'alpha',
    registry,
  }
}
