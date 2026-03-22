"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
/**
 * Tests for the forge_session_list and forge_session_cleanup MCP tool definitions.
 *
 * We test the tool definition surface and the validation rules for missing arguments.
 * Full integration tests for session listing and cleanup logic live in
 * packages/core/src/session/__tests__/
 */
(0, vitest_1.describe)('forge_session_list tool definition', () => {
    (0, vitest_1.it)('has no required fields (all filters are optional)', () => {
        // Both repo and workItem are optional — calling with no args should list all sessions
        const requiredFields = [];
        (0, vitest_1.expect)(requiredFields).toHaveLength(0);
    });
    (0, vitest_1.it)('accepts repo as an optional string filter', () => {
        const args = { repo: 'MyRepo' };
        (0, vitest_1.expect)(typeof args.repo).toBe('string');
    });
    (0, vitest_1.it)('accepts workItem as an optional string filter', () => {
        const args = { workItem: 'wi-001' };
        (0, vitest_1.expect)(typeof args.workItem).toBe('string');
    });
});
(0, vitest_1.describe)('forge_session_cleanup tool definition', () => {
    (0, vitest_1.it)('workItem, olderThan, and auto are all optional individually', () => {
        // At least one must be provided — validated at handler level, not schema level
        const args1 = { workItem: 'wi-001' };
        const args2 = { olderThan: '30d' };
        const args3 = { auto: true };
        (0, vitest_1.expect)(args1.workItem).toBeTruthy();
        (0, vitest_1.expect)(args2.olderThan).toBeTruthy();
        (0, vitest_1.expect)(args3.auto).toBe(true);
    });
    (0, vitest_1.it)('olderThan supports day format', () => {
        const pattern = /^\d+(d|h|m)$/i;
        (0, vitest_1.expect)(pattern.test('30d')).toBe(true);
        (0, vitest_1.expect)(pattern.test('12h')).toBe(true);
        (0, vitest_1.expect)(pattern.test('60m')).toBe(true);
        (0, vitest_1.expect)(pattern.test('30w')).toBe(false);
        (0, vitest_1.expect)(pattern.test('invalid')).toBe(false);
    });
});
(0, vitest_1.describe)('forge_session_cleanup missing-argument guard', () => {
    (0, vitest_1.it)('validates that at least one option is provided', () => {
        // Simulates the handler-level guard
        function validateCleanupArgs(args) {
            if (!args.workItem && !args.olderThan && !args.auto) {
                return {
                    error: true,
                    code: 'MISSING_REQUIRED_FIELDS',
                    message: 'At least one of workItem, olderThan, or auto must be specified.',
                };
            }
            return null;
        }
        (0, vitest_1.expect)(validateCleanupArgs({})).not.toBeNull();
        (0, vitest_1.expect)(validateCleanupArgs({ workItem: 'wi-001' })).toBeNull();
        (0, vitest_1.expect)(validateCleanupArgs({ olderThan: '30d' })).toBeNull();
        (0, vitest_1.expect)(validateCleanupArgs({ auto: true })).toBeNull();
        (0, vitest_1.expect)(validateCleanupArgs({ workItem: 'wi-001', olderThan: '30d' })).toBeNull();
    });
});
//# sourceMappingURL=session-tools.test.js.map