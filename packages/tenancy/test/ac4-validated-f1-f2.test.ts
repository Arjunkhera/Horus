/**
 * AC-4 — Validated against F1 (Principal) and F2 (scope resolver): the contract
 * is driven by real @horus/auth Principal + @horus/scope DeploymentProfiles.
 *
 * RED until @horus/tenancy is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  derivePerUserAnvilResource,
  createScopingEnforcement,
  type Principal,
} from '../src/index';
import { enterpriseAlphaProfile, saasProfile } from '@horus/scope';

describe('AC-4 validated against F1 + F2', () => {
  it('uses the F2 resolver: enterprise multi-tenant gives tenant+user-scoped names', () => {
    const alice: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };
    const bob: Principal = { tenant: 'acme', user: 'bob', role: 'admin' };
    const ra = derivePerUserAnvilResource(alice, enterpriseAlphaProfile);
    const rb = derivePerUserAnvilResource(bob, enterpriseAlphaProfile);
    // Same tenant, different users → distinct per-user resources.
    expect(ra.typesenseCollection).not.toBe(rb.typesenseCollection);
    expect(ra.neo4jDatabase).not.toBe(rb.neo4jDatabase);
    expect(ra.typesenseCollection).toContain('acme');
  });

  it('honours the F2 SaaS tenant==user collapse', () => {
    const dave: Principal = { tenant: 'dave', user: 'dave', role: 'admin' };
    const r = derivePerUserAnvilResource(dave, saasProfile);
    expect(r.typesenseCollection).toContain('dave');
    expect(r.neo4jDatabase).toContain('dave');
  });

  it('enforcement permits same-scope access and rejects cross-user access', () => {
    const enf = createScopingEnforcement(enterpriseAlphaProfile);
    const alice: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };
    const bob: Principal = { tenant: 'acme', user: 'bob', role: 'admin' };
    expect(() => enf.assertAccess(alice, { principal: alice })).not.toThrow();
    expect(() => enf.assertAccess(alice, { principal: bob })).toThrow();
  });
});
