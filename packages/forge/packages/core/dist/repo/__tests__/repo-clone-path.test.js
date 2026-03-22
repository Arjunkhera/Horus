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
 * Bug history:
 * - v1: when Forge runs in Docker (WORKDIR /app), this.workspaceRoot is '/app',
 *   never inside mountPath ('/data/workspaces'). insideWorkspace always false →
 *   clones land in the global mount root.
 *   Fix: accept optional workspacePath that overrides this.workspaceRoot.
 *
 * - v2 (regression): MCP callers pass workspacePath as the HOST-side absolute
 *   path (e.g. /Users/arkhera/.horus/data/workspaces/<id>) from $FORGE_WORKSPACE_PATH
 *   in workspace.env. This host path doesn't start with the container mountPath
 *   (/data/workspaces) so insideWorkspace is still false → clones land at root.
 *   Fix: translate workspacePath from host path → container path using the
 *   host_workspaces_path → mount_path mapping already in global config.
 */
function resolveClonePath(opts) {
    const hostMount = opts.hostMountPath ?? opts.mountPath;
    let effectiveRoot = path_1.default.resolve(opts.workspacePath ?? opts.workspaceRoot);
    // Translate host workspacePath → container path when running in Docker
    if (hostMount !== opts.mountPath && effectiveRoot.startsWith(hostMount + path_1.default.sep)) {
        effectiveRoot = opts.mountPath + effectiveRoot.slice(hostMount.length);
    }
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
            workspacePath: '/Users/arkhera/Horus/data/workspaces/sdlc-default-ws-ed71cd7b',
            workspaceRoot: '/Users/arkhera',
            mountPath: '/Users/arkhera/Horus/data/workspaces',
        });
        (0, vitest_1.expect)(result).toBe('/Users/arkhera/Horus/data/workspaces/sdlc-default-ws-ed71cd7b/my-repo');
    });
    // Regression tests for v2 bug: host path passed as workspacePath in Docker
    (0, vitest_1.describe)('host-path translation (Docker regression)', () => {
        const dockerMountPath = '/data/workspaces';
        const dockerHostMount = '/Users/arkhera/.horus/data/workspaces';
        (0, vitest_1.it)('translates host workspacePath to container path (the regression)', () => {
            // This is the exact scenario from story 2624cd11:
            // forge_repo_clone({ workspacePath: "/Users/arkhera/.horus/data/workspaces/sdlc-default-cb06024d-..." })
            const result = resolveClonePath({
                repoName,
                workspacePath: `${dockerHostMount}/sdlc-default-cb06024d-e31e-4004-9a2a-e94381121e0a`,
                workspaceRoot: '/app',
                mountPath: dockerMountPath,
                hostMountPath: dockerHostMount,
            });
            (0, vitest_1.expect)(result).toBe('/data/workspaces/sdlc-default-cb06024d-e31e-4004-9a2a-e94381121e0a/my-repo');
        });
        (0, vitest_1.it)('still falls back to mount root when workspacePath is outside both mount and hostMount', () => {
            const result = resolveClonePath({
                repoName,
                workspacePath: '/some/other/path',
                workspaceRoot: '/app',
                mountPath: dockerMountPath,
                hostMountPath: dockerHostMount,
            });
            (0, vitest_1.expect)(result).toBe('/data/workspaces/my-repo');
        });
        (0, vitest_1.it)('accepts container path directly without translation', () => {
            const result = resolveClonePath({
                repoName,
                workspacePath: '/data/workspaces/sdlc-default-ws-xyz',
                workspaceRoot: '/app',
                mountPath: dockerMountPath,
                hostMountPath: dockerHostMount,
            });
            (0, vitest_1.expect)(result).toBe('/data/workspaces/sdlc-default-ws-xyz/my-repo');
        });
        (0, vitest_1.it)('does not translate when hostMountPath equals mountPath (no-op for non-Docker)', () => {
            const result = resolveClonePath({
                repoName,
                workspacePath: '/data/workspaces/sdlc-default-ws-abc',
                workspaceRoot: '/app',
                mountPath: dockerMountPath,
                // hostMountPath omitted → defaults to mountPath → no translation
            });
            (0, vitest_1.expect)(result).toBe('/data/workspaces/sdlc-default-ws-abc/my-repo');
        });
    });
});
//# sourceMappingURL=repo-clone-path.test.js.map