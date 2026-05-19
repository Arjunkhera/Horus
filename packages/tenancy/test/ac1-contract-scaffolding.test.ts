/**
 * AC-1 — Written contract + interface scaffolding that Tracks A & E can
 * implement against; per-user Anvil resource derived from the F2 scope coord.
 *
 * RED until @horus/tenancy is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  derivePerUserAnvilResource,
  perUserAnvilProvisioningPlan,
  createScopingEnforcement,
  type PerUserAnvilResource,
  type ProvisioningStep,
  type ScopingEnforcement,
  type Principal,
} from '../src/index';
import { enterpriseAlphaProfile } from '@horus/scope';

describe('AC-1 contract scaffolding', () => {
  it('derives a per-user Anvil resource (Typesense collection + Neo4j db) from the scope coordinate', () => {
    const p: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };
    const r: PerUserAnvilResource = derivePerUserAnvilResource(p, enterpriseAlphaProfile);
    expect(typeof r.typesenseCollection).toBe('string');
    expect(r.typesenseCollection.length).toBeGreaterThan(0);
    expect(typeof r.neo4jDatabase).toBe('string');
    expect(r.neo4jDatabase.length).toBeGreaterThan(0);
    // Names encode the scope (tenant/user) so each user gets its own resources.
    expect(r.typesenseCollection).toContain('alice');
    expect(r.neo4jDatabase).toContain('alice');
  });

  it('exposes the provisioning plan and enforcement contract as scaffolding', () => {
    expect(Array.isArray(perUserAnvilProvisioningPlan)).toBe(true);
    const step: ProvisioningStep = perUserAnvilProvisioningPlan[0];
    expect(step).toHaveProperty('id');
    expect(step).toHaveProperty('ensure');
    const enf: ScopingEnforcement = createScopingEnforcement(enterpriseAlphaProfile);
    expect(typeof enf.assertAccess).toBe('function');
  });
});
