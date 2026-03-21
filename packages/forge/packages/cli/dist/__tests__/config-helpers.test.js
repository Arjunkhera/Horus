"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const config_helpers_js_1 = require("../config-helpers.js");
(0, vitest_1.describe)('Config Helpers', () => {
    (0, vitest_1.describe)('setNestedValue()', () => {
        (0, vitest_1.it)('sets a simple value', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'workspace.mount_path', '~/my-workspaces');
            (0, vitest_1.expect)(obj.workspace.mount_path).toBe('~/my-workspaces');
        });
        (0, vitest_1.it)('sets a numeric value', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'workspace.retention_days', '60');
            (0, vitest_1.expect)(obj.workspace.retention_days).toBe(60);
        });
        (0, vitest_1.it)('sets a boolean true value', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'some.flag', 'true');
            (0, vitest_1.expect)(obj.some.flag).toBe(true);
        });
        (0, vitest_1.it)('sets a boolean false value', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'some.flag', 'false');
            (0, vitest_1.expect)(obj.some.flag).toBe(false);
        });
        (0, vitest_1.it)('sets an array from comma-separated string', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'repos.scan_paths', '~/Repos,~/Projects');
            (0, vitest_1.expect)(obj.repos.scan_paths).toEqual(['~/Repos', '~/Projects']);
        });
        (0, vitest_1.it)('trims whitespace in arrays', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'repos.scan_paths', '~/Repos, ~/Projects, /absolute');
            (0, vitest_1.expect)(obj.repos.scan_paths).toEqual(['~/Repos', '~/Projects', '/absolute']);
        });
        (0, vitest_1.it)('creates nested objects as needed', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'mcp_endpoints.anvil.url', 'http://localhost:3002');
            (0, vitest_1.expect)(obj.mcp_endpoints.anvil.url).toBe('http://localhost:3002');
        });
        (0, vitest_1.it)('overwrites existing values', () => {
            const obj = { workspace: { mount_path: '/old/path' } };
            (0, config_helpers_js_1.setNestedValue)(obj, 'workspace.mount_path', '~/new-path');
            (0, vitest_1.expect)(obj.workspace.mount_path).toBe('~/new-path');
        });
        (0, vitest_1.it)('handles single-part paths', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'simple', 'value');
            (0, vitest_1.expect)(obj.simple).toBe('value');
        });
        (0, vitest_1.it)('preserves sibling properties', () => {
            const obj = { other: 'data' };
            (0, config_helpers_js_1.setNestedValue)(obj, 'workspace.mount_path', '~/path');
            (0, vitest_1.expect)(obj.other).toBe('data');
            (0, vitest_1.expect)(obj.workspace.mount_path).toBe('~/path');
        });
        (0, vitest_1.it)('handles zero as a number', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'count', '0');
            (0, vitest_1.expect)(obj.count).toBe(0);
            (0, vitest_1.expect)(typeof obj.count).toBe('number');
        });
        (0, vitest_1.it)('handles empty string as string value', () => {
            const obj = {};
            (0, config_helpers_js_1.setNestedValue)(obj, 'value', '');
            (0, vitest_1.expect)(obj.value).toBe('');
        });
    });
    (0, vitest_1.describe)('getNestedValue()', () => {
        (0, vitest_1.it)('gets a simple value', () => {
            const obj = { workspace: { mount_path: '~/path' } };
            (0, vitest_1.expect)((0, config_helpers_js_1.getNestedValue)(obj, 'workspace.mount_path')).toBe('~/path');
        });
        (0, vitest_1.it)('gets a nested value', () => {
            const obj = { a: { b: { c: 'value' } } };
            (0, vitest_1.expect)((0, config_helpers_js_1.getNestedValue)(obj, 'a.b.c')).toBe('value');
        });
        (0, vitest_1.it)('returns undefined for missing path', () => {
            const obj = { workspace: {} };
            (0, vitest_1.expect)((0, config_helpers_js_1.getNestedValue)(obj, 'workspace.missing')).toBeUndefined();
        });
        (0, vitest_1.it)('returns undefined for deeply missing path', () => {
            const obj = { workspace: { mount_path: '~/path' } };
            (0, vitest_1.expect)((0, config_helpers_js_1.getNestedValue)(obj, 'workspace.mount_path.nested')).toBeUndefined();
        });
        (0, vitest_1.it)('handles single-part paths', () => {
            const obj = { simple: 'value' };
            (0, vitest_1.expect)((0, config_helpers_js_1.getNestedValue)(obj, 'simple')).toBe('value');
        });
        (0, vitest_1.it)('returns undefined for null intermediate values', () => {
            const obj = { workspace: null };
            (0, vitest_1.expect)((0, config_helpers_js_1.getNestedValue)(obj, 'workspace.mount_path')).toBeUndefined();
        });
    });
});
//# sourceMappingURL=config-helpers.test.js.map