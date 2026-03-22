"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_js_1 = require("../index.js");
/**
 * Regression tests for the forge_repo_clone workspace-path guard.
 *
 * This bug has regressed three times (stories 35c358c9, 5da6a95a, dd355cf0).
 * Each time, callers omitted workspacePath and clones silently landed at the
 * global mount root (/workspaces/<repo>) instead of inside the workspace
 * (/workspaces/<workspace-id>/<repo>).
 *
 * The fix: validateRepoCloneArgs() is called in the MCP handler BEFORE
 * forge.repoClone() and returns an error when neither workspacePath nor
 * destPath is provided.
 *
 * These tests cover validateRepoCloneArgs() directly so that any future
 * refactor of the handler that drops the validation call will fail here.
 */
(0, vitest_1.describe)('validateRepoCloneArgs — forge_repo_clone workspace-path guard', () => {
    (0, vitest_1.describe)('regression: missing workspacePath and destPath', () => {
        (0, vitest_1.it)('returns WORKSPACE_PATH_REQUIRED error when neither workspacePath nor destPath is provided', () => {
            const result = (0, index_js_1.validateRepoCloneArgs)({ repoName: 'Forge' });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.error).toBe(true);
            (0, vitest_1.expect)(result.code).toBe('WORKSPACE_PATH_REQUIRED');
        });
        (0, vitest_1.it)('error message instructs caller to pass FORGE_WORKSPACE_PATH', () => {
            const result = (0, index_js_1.validateRepoCloneArgs)({ repoName: 'Forge' });
            (0, vitest_1.expect)(result.suggestion).toMatch(/FORGE_WORKSPACE_PATH/);
        });
    });
    (0, vitest_1.describe)('valid calls that must NOT be blocked', () => {
        (0, vitest_1.it)('returns null when workspacePath is provided', () => {
            const result = (0, index_js_1.validateRepoCloneArgs)({
                repoName: 'Forge',
                workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('returns null when destPath is provided (explicit override)', () => {
            const result = (0, index_js_1.validateRepoCloneArgs)({
                repoName: 'Forge',
                destPath: '/custom/explicit/path/Forge',
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('returns null when both workspacePath and destPath are provided', () => {
            const result = (0, index_js_1.validateRepoCloneArgs)({
                repoName: 'Forge',
                workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
                destPath: '/data/workspaces/sdlc-default-ws-abc123/Forge',
            });
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('missing repoName', () => {
        (0, vitest_1.it)('returns REPO_NAME_REQUIRED error when repoName is absent', () => {
            const result = (0, index_js_1.validateRepoCloneArgs)({
                workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
            });
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.code).toBe('REPO_NAME_REQUIRED');
        });
    });
});
//# sourceMappingURL=repo-clone-validation.test.js.map