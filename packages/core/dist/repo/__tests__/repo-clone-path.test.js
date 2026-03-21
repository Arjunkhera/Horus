"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const path_1 = __importDefault(require("path"));
/**
 * Unit tests for the clone-path selection logic extracted from ForgeCore.repoClone().
 *
 * The bug: when Forge runs as a shared HTTP MCP server (e.g. in Docker with
 * WORKDIR /app), this.workspaceRoot is '/app', which is never inside mountPath
 * ('/data/workspaces'). So insideWorkspace is always false and clones land in
 * the global mount path instead of the caller's workspace folder.
 *
 * The fix: accept an optional workspacePath that overrides this.workspaceRoot.
 */
function resolveClonePath(opts) {
    const effectiveRoot = opts.workspacePath
        ? path_1.default.resolve(opts.workspacePath)
        : path_1.default.resolve(opts.workspaceRoot);
    const resolvedMount = path_1.default.resolve(opts.mountPath);
    const insideWorkspace = effectiveRoot.startsWith(resolvedMount + path_1.default.sep) &&
        effectiveRoot !== resolvedMount;
    const basePath = insideWorkspace ? effectiveRoot : resolvedMount;
    return opts.destPath ?? path_1.default.join(basePath, opts.repoName);
}
(0, vitest_1.describe)('repoClone path selection', () => {
    const mountPath = '/data/workspaces';
    const repoName = 'my-repo';
    (0, vitest_1.it)('falls back to mountPath when workspaceRoot is outside mount (the bug scenario)', () => {
        // Server cwd = /app — never inside /data/workspaces
        const result = resolveClonePath({
            repoName,
            workspaceRoot: '/app',
            mountPath,
        });
        (0, vitest_1.expect)(result).toBe('/data/workspaces/my-repo');
    });
    (0, vitest_1.it)('clones into workspace when workspacePath is provided (the fix)', () => {
        const result = resolveClonePath({
            repoName,
            workspacePath: '/data/workspaces/sdlc-default-ws-abc123',
            workspaceRoot: '/app', // server cwd — should be ignored
            mountPath,
        });
        (0, vitest_1.expect)(result).toBe('/data/workspaces/sdlc-default-ws-abc123/my-repo');
    });
    (0, vitest_1.it)('clones into workspace when workspaceRoot itself is inside mount', () => {
        // Native (non-Docker) case where ForgeCore was created with the workspace path
        const result = resolveClonePath({
            repoName,
            workspaceRoot: '/data/workspaces/my-ws',
            mountPath,
        });
        (0, vitest_1.expect)(result).toBe('/data/workspaces/my-ws/my-repo');
    });
    (0, vitest_1.it)('uses destPath when explicitly provided, ignoring workspace detection', () => {
        const result = resolveClonePath({
            repoName,
            destPath: '/custom/path/my-repo',
            workspacePath: '/data/workspaces/ws-xyz',
            workspaceRoot: '/app',
            mountPath,
        });
        (0, vitest_1.expect)(result).toBe('/custom/path/my-repo');
    });
    (0, vitest_1.it)('falls back to mountPath when workspacePath is outside mount', () => {
        // workspacePath provided but doesn't live under mountPath — fallback
        const result = resolveClonePath({
            repoName,
            workspacePath: '/some/other/path',
            workspaceRoot: '/app',
            mountPath,
        });
        (0, vitest_1.expect)(result).toBe('/data/workspaces/my-repo');
    });
    (0, vitest_1.it)('falls back to mountPath when workspacePath equals mountPath exactly', () => {
        // Edge case: workspacePath IS the mount root, not a subdirectory
        const result = resolveClonePath({
            repoName,
            workspacePath: '/data/workspaces',
            workspaceRoot: '/app',
            mountPath,
        });
        (0, vitest_1.expect)(result).toBe('/data/workspaces/my-repo');
    });
    (0, vitest_1.it)('handles macOS-style paths (native install)', () => {
        const result = resolveClonePath({
            repoName,
            workspacePath: '/Users/arkhera/Horus/horus-data/workspaces/sdlc-default-ws-ed71cd7b',
            workspaceRoot: '/Users/arkhera',
            mountPath: '/Users/arkhera/Horus/horus-data/workspaces',
        });
        (0, vitest_1.expect)(result).toBe('/Users/arkhera/Horus/horus-data/workspaces/sdlc-default-ws-ed71cd7b/my-repo');
    });
});
//# sourceMappingURL=repo-clone-path.test.js.map