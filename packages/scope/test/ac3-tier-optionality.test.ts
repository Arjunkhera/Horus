/**
 * AC-3 — Tests covering tier-optionality (tiers optional per subsystem) and the
 * SaaS tenant==user collapse.
 *
 * Tier policy: anvil = Tenant→User; vault & forge-registry = Tenant;
 * forge-artifactory = Global→Tenant.
 *
 * RED until @horus/scope is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveScope,
  enterpriseAlphaProfile,
  saasProfile,
  type Principal,
} from '../src/index';

const ent: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };

describe('AC-3 tier-optionality + SaaS collapse', () => {
  it('anvil yields a Tenant→User coordinate', () => {
    const c = resolveScope(ent, 'anvil', enterpriseAlphaProfile);
    expect(c.tenant).toBe('acme');
    expect(c.user).toBe('alice');
    expect(c.global).toBeUndefined();
  });

  it('vault yields a Tenant-only coordinate (no user tier)', () => {
    const c = resolveScope(ent, 'vault', enterpriseAlphaProfile);
    expect(c.tenant).toBe('acme');
    expect(c.user).toBeUndefined();
  });

  it('forge-artifactory yields a Global→Tenant coordinate (no user tier)', () => {
    const c = resolveScope(ent, 'forge-artifactory', enterpriseAlphaProfile);
    expect(c.global).toBeDefined();
    expect(c.tenant).toBe('acme');
    expect(c.user).toBeUndefined();
  });

  it('SaaS collapses tenant == user with no special-casing', () => {
    const saasP: Principal = { tenant: 'carol', user: 'carol', role: 'admin' };
    const c = resolveScope(saasP, 'anvil', saasProfile);
    expect(c.tenant).toBe(c.user);
    expect(c.user).toBe('carol');
  });
});
