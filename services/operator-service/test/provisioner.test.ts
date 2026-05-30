import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.js';
import { Provisioner, type HandlerMap } from '../src/provisioner.js';
import type { ProvisioningRequest } from '../src/model.js';

function approvedRequest(): ProvisioningRequest {
  const now = new Date().toISOString();
  return {
    id: 'req-1',
    kind: 'vault_create',
    payload: { namespace: 'acme/v1' },
    requester: 'admin',
    tenant: 'acme',
    status: 'approved',
    decision: 'approved',
    decidedBy: 'admin',
    error: null,
    steps: {},
    createdAt: now,
    updatedAt: now,
  };
}

describe('Provisioner idempotent + resumable reconcile', () => {
  it('runs steps in order and reaches provisioned', async () => {
    const store = new Store(':memory:');
    store.insertRequest(approvedRequest());
    const calls: string[] = [];
    const handlers: HandlerMap = {
      vault_create: {
        steps: () => [
          { name: 'a', ensure: async () => void calls.push('a') },
          { name: 'b', ensure: async () => void calls.push('b') },
        ],
      },
    };
    const out = await new Provisioner(store, handlers).reconcile('req-1');
    expect(out.status).toBe('provisioned');
    expect(calls).toEqual(['a', 'b']);
    store.close();
  });

  it('on failure preserves completed steps and marks failed; retry skips them', async () => {
    const store = new Store(':memory:');
    store.insertRequest(approvedRequest());
    const calls: string[] = [];
    let failB = true;
    const handlers: HandlerMap = {
      vault_create: {
        steps: () => [
          { name: 'a', ensure: async () => void calls.push('a') },
          {
            name: 'b',
            ensure: async () => {
              calls.push('b');
              if (failB) throw new Error('boom');
            },
          },
          { name: 'c', ensure: async () => void calls.push('c') },
        ],
      },
    };
    const provisioner = new Provisioner(store, handlers);

    const first = await provisioner.reconcile('req-1');
    expect(first.status).toBe('failed');
    expect(first.error).toBe('boom');
    expect(first.steps).toEqual({ a: true }); // 'a' committed, 'b' failed, 'c' never ran
    expect(calls).toEqual(['a', 'b']);

    // Fix the transient failure and retry — 'a' must NOT run again.
    failB = false;
    const second = await provisioner.reconcile('req-1');
    expect(second.status).toBe('provisioned');
    expect(second.steps).toEqual({ a: true, b: true, c: true });
    expect(calls).toEqual(['a', 'b', 'b', 'c']); // 'a' skipped on retry
    store.close();
  });

  it('teardown kinds terminate at torn_down', async () => {
    const store = new Store(':memory:');
    const req = approvedRequest();
    req.kind = 'vault_delete';
    store.insertRequest(req);
    const handlers: HandlerMap = {
      vault_delete: { steps: () => [{ name: 'drop', ensure: async () => {} }] },
    };
    const out = await new Provisioner(store, handlers).reconcile('req-1');
    expect(out.status).toBe('torn_down');
    store.close();
  });
});
