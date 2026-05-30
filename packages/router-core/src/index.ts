/**
 * @horus/router-core — shared contract types.
 *
 * Pure types/interfaces package — no runtime side effects.
 * Consumed by services/anvil-router (TA-3+) and the future Operator service.
 *
 * Locked decisions applied:
 *   Q1: new @horus/router-core workspace package (avoids circular deps)
 *   Q2: RegistryEntry schema (with schema_version) lives here
 *   Q4: 425 error shape (RouteResolutionError + REGISTRY_MISS code) lives here
 */

// ---------------------------------------------------------------------------
// Re-exports from Phase-1 packages
// ---------------------------------------------------------------------------

export type { Principal } from '@horus/auth';
export type { ScopeCoordinate } from '@horus/scope';

// ---------------------------------------------------------------------------
// Registry schema
// ---------------------------------------------------------------------------

export { RegistryEntrySchema, type RegistryEntry } from './registry.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export {
  RouteResolutionError,
  type RouteResolutionCode,
  type RouteResolutionErrorOptions,
} from './errors.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type { RouterConfig } from './config.js';

// ---------------------------------------------------------------------------
// Runtime validator
// ---------------------------------------------------------------------------

import { RegistryEntrySchema, type RegistryEntry } from './registry.js';
import { RouteResolutionError } from './errors.js';

export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RouteResolutionError };

/**
 * Runtime guard: parses `input` against the RegistryEntry schema.
 * Returns `{ ok: true, value }` on success or `{ ok: false, error }` on failure.
 * The error always has code `VALIDATION_ERROR`.
 */
export function validateRegistryEntry(input: unknown): ValidateResult<RegistryEntry> {
  const result = RegistryEntrySchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const firstIssue = result.error.issues[0];
  const message = firstIssue
    ? `RegistryEntry validation failed: ${firstIssue.path.join('.') || 'root'} — ${firstIssue.message}`
    : 'RegistryEntry validation failed';
  return {
    ok: false,
    error: new RouteResolutionError('VALIDATION_ERROR', message),
  };
}
