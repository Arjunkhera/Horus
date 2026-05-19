/**
 * AC-3 — Schema-bootstrap ownership relocated off Anvil to a neutral owner,
 * and documented.
 *
 * RED until @horus/tenancy is implemented.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SCHEMA_BOOTSTRAP_OWNER,
  perUserAnvilProvisioningPlan,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));

describe('AC-3 schema-bootstrap ownership relocation', () => {
  it('declares a neutral schema-bootstrap owner that is not anvil', () => {
    expect(typeof SCHEMA_BOOTSTRAP_OWNER).toBe('string');
    expect(SCHEMA_BOOTSTRAP_OWNER.length).toBeGreaterThan(0);
    expect(SCHEMA_BOOTSTRAP_OWNER).not.toBe('anvil');
  });

  it('the provisioning plan attributes schema bootstrap to that neutral owner', () => {
    const owners = new Set(perUserAnvilProvisioningPlan.map((s) => s.owner));
    expect(owners.has(SCHEMA_BOOTSTRAP_OWNER)).toBe(true);
    // Anvil must not own the bootstrap step.
    const anvilOwned = perUserAnvilProvisioningPlan.filter((s) => s.owner === 'anvil');
    for (const s of anvilOwned) {
      expect(/schema|bootstrap/i.test(s.id + s.describe)).toBe(false);
    }
  });

  it('the contract doc documents the relocation', () => {
    const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
    expect(readme).toMatch(/schema[- ]bootstrap/i);
    expect(readme).toMatch(/anvil/i);
    expect(readme).toMatch(/owner|ownership|relocat/i);
  });
});
