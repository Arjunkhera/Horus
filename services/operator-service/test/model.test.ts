import { describe, it, expect } from 'vitest';
import { canTransition, terminalSuccess } from '../src/model.js';

describe('request state machine', () => {
  it('allows the governed transitions', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('approved', 'provisioning')).toBe(true);
    expect(canTransition('provisioning', 'provisioned')).toBe(true);
    expect(canTransition('provisioning', 'torn_down')).toBe(true);
    expect(canTransition('provisioning', 'failed')).toBe(true);
    expect(canTransition('failed', 'provisioning')).toBe(true); // resumable retry
  });

  it('forbids illegal transitions', () => {
    expect(canTransition('pending', 'provisioned')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('torn_down', 'provisioning')).toBe(false);
  });

  it('picks the terminal success status per kind', () => {
    expect(terminalSuccess('vault_create')).toBe('provisioned');
    expect(terminalSuccess('onboard')).toBe('provisioned');
    expect(terminalSuccess('vault_delete')).toBe('torn_down');
    expect(terminalSuccess('teardown')).toBe('torn_down');
  });
});
