/**
 * AC-2 — A reference "provision one per-user Anvil" step list that is
 * idempotent / status-checkpointed (consumable by C2 handlers).
 *
 * RED until @horus/tenancy is implemented.
 */
import { describe, it, expect } from 'vitest';
import {
  perUserAnvilProvisioningPlan,
  SCHEMA_BOOTSTRAP_OWNER,
} from '../src/index';

describe('AC-2 provisioning step list', () => {
  it('is an ordered list of at least 3 steps with stable ids', () => {
    expect(perUserAnvilProvisioningPlan.length).toBeGreaterThanOrEqual(3);
    const ids = perUserAnvilProvisioningPlan.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
  });

  it('each step is idempotent and status-checkpointed (double ensure is stable)', async () => {
    const ctx = { completed: new Set<string>() };
    for (const step of perUserAnvilProvisioningPlan) {
      const first = await step.ensure(ctx);
      const second = await step.ensure(ctx);
      expect(first).toBe('done');
      expect(second).toBe('done'); // re-running a completed step is safe
      expect(ctx.completed.has(step.id)).toBe(true);
    }
  });

  it('schema-bootstrap is a discrete step owned by a neutral owner, not anvil', () => {
    const bootstrap = perUserAnvilProvisioningPlan.find((s) =>
      /schema|bootstrap/i.test(s.id) || /schema|bootstrap/i.test(s.describe),
    );
    expect(bootstrap).toBeDefined();
    expect(bootstrap!.owner).toBe(SCHEMA_BOOTSTRAP_OWNER);
    expect(bootstrap!.owner).not.toBe('anvil');
  });
});
