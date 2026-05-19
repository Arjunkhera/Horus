/**
 * AC-2 — DeploymentProfile schema defined + validated; an enterprise/single-
 * tenant alpha profile and a SaaS profile both parse; invalid input rejected.
 *
 * RED until @horus/scope is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDeploymentProfile,
  enterpriseAlphaProfile,
  saasProfile,
} from '../src/index';

describe('AC-2 DeploymentProfile schema', () => {
  it('parses the enterprise-alpha reference profile', () => {
    const p = parseDeploymentProfile(enterpriseAlphaProfile);
    expect(p.mode).toBe('enterprise');
    expect(p.tenancy).toBe('multi-tenant');
    expect(p.placement).toBeDefined();
  });

  it('parses the SaaS reference profile', () => {
    const p = parseDeploymentProfile(saasProfile);
    expect(p.mode).toBe('saas');
    expect(p.tenancy).toBe('single-user');
  });

  it('exposes the full documented field set on both profiles', () => {
    for (const prof of [enterpriseAlphaProfile, saasProfile]) {
      const p = parseDeploymentProfile(prof);
      for (const f of [
        'mode', 'tenancy', 'placement', 'scale',
        'credentialPair', 'identitySource', 'globalForgeLink', 'governancePolicy',
      ]) {
        expect(p).toHaveProperty(f);
      }
    }
  });

  it('rejects an invalid profile', () => {
    expect(() => parseDeploymentProfile({ mode: 'not-a-mode' })).toThrow();
    expect(() => parseDeploymentProfile({})).toThrow();
  });
});
