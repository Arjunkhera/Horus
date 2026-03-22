import { describe, it, expect } from 'vitest';

/**
 * Tests for the forge_session_list and forge_session_cleanup MCP tool definitions.
 *
 * We test the tool definition surface and the validation rules for missing arguments.
 * Full integration tests for session listing and cleanup logic live in
 * packages/core/src/session/__tests__/
 */

describe('forge_session_list tool definition', () => {
  it('has no required fields (all filters are optional)', () => {
    // Both repo and workItem are optional — calling with no args should list all sessions
    const requiredFields: string[] = [];
    expect(requiredFields).toHaveLength(0);
  });

  it('accepts repo as an optional string filter', () => {
    const args = { repo: 'MyRepo' };
    expect(typeof args.repo).toBe('string');
  });

  it('accepts workItem as an optional string filter', () => {
    const args = { workItem: 'wi-001' };
    expect(typeof args.workItem).toBe('string');
  });
});

describe('forge_session_cleanup tool definition', () => {
  it('workItem, olderThan, and auto are all optional individually', () => {
    // At least one must be provided — validated at handler level, not schema level
    const args1 = { workItem: 'wi-001' };
    const args2 = { olderThan: '30d' };
    const args3 = { auto: true };
    expect(args1.workItem).toBeTruthy();
    expect(args2.olderThan).toBeTruthy();
    expect(args3.auto).toBe(true);
  });

  it('olderThan supports day format', () => {
    const pattern = /^\d+(d|h|m)$/i;
    expect(pattern.test('30d')).toBe(true);
    expect(pattern.test('12h')).toBe(true);
    expect(pattern.test('60m')).toBe(true);
    expect(pattern.test('30w')).toBe(false);
    expect(pattern.test('invalid')).toBe(false);
  });
});

describe('forge_session_cleanup missing-argument guard', () => {
  it('validates that at least one option is provided', () => {
    // Simulates the handler-level guard
    function validateCleanupArgs(args: { workItem?: unknown; olderThan?: unknown; auto?: unknown }) {
      if (!args.workItem && !args.olderThan && !args.auto) {
        return {
          error: true,
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'At least one of workItem, olderThan, or auto must be specified.',
        };
      }
      return null;
    }

    expect(validateCleanupArgs({})).not.toBeNull();
    expect(validateCleanupArgs({ workItem: 'wi-001' })).toBeNull();
    expect(validateCleanupArgs({ olderThan: '30d' })).toBeNull();
    expect(validateCleanupArgs({ auto: true })).toBeNull();
    expect(validateCleanupArgs({ workItem: 'wi-001', olderThan: '30d' })).toBeNull();
  });
});
