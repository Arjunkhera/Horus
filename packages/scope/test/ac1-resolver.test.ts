/**
 * AC-1 — Scope-chain resolver: given a Principal + subsystem, returns the
 * correct namespace coordinate; enterprise and SaaS BOTH pass via config only
 * (same resolveScope call path, no special-casing, no throw for valid input).
 *
 * RED until @horus/scope is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveScope,
  enterpriseAlphaProfile,
  saasProfile,
  type Principal,
  type ScopeCoordinate,
} from '../src/index';

const ent: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };
const saas: Principal = { tenant: 'bob', user: 'bob', role: 'admin' };

describe('AC-1 resolver returns correct coordinate; config-only enterprise/SaaS', () => {
  it('resolves an anvil coordinate for the enterprise profile', () => {
    const c: ScopeCoordinate = resolveScope(ent, 'anvil', enterpriseAlphaProfile);
    expect(c.tenant).toBe('acme');
    expect(c.user).toBe('alice');
    expect(typeof c.key).toBe('string');
    expect(c.key.length).toBeGreaterThan(0);
  });

  it('resolves the SAME subsystem under the SaaS profile via the same call (no branch/throw)', () => {
    const c = resolveScope(saas, 'anvil', saasProfile);
    expect(c.tenant).toBeDefined();
    expect(c.user).toBe('bob');
    // Coordinates differ only by profile/principal-derived values, not code path.
    const entC = resolveScope(ent, 'anvil', enterpriseAlphaProfile);
    expect(c.key).not.toBe(entC.key);
  });

  it('does not throw for any valid subsystem under either profile', () => {
    const subs = ['anvil', 'vault', 'forge-registry', 'forge-artifactory'] as const;
    for (const s of subs) {
      expect(() => resolveScope(ent, s, enterpriseAlphaProfile)).not.toThrow();
      expect(() => resolveScope(saas, s, saasProfile)).not.toThrow();
    }
  });
});
