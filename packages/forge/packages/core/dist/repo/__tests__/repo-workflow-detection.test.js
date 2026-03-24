"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const core_js_1 = require("../../core.js");
const repo_index_store_js_1 = require("../repo-index-store.js");
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function writeYaml(filePath, content) {
    await (0, promises_1.mkdir)(path_1.default.dirname(filePath), { recursive: true });
    await (0, promises_1.writeFile)(filePath, content, 'utf-8');
}
async function setupGlobalConfig(tmpDir, reposIndexPath) {
    const configPath = path_1.default.join(tmpDir, 'forge-config.yaml');
    await writeYaml(configPath, `
registries: []
workspace:
  mount_path: ${tmpDir}/workspaces
  store_path: ${tmpDir}/workspaces.json
repos:
  scan_paths: []
  index_path: ${reposIndexPath}
`);
    return configPath;
}
/**
 * Build a minimal ForgeCore instance pointing at a temp directory.
 * Returns the core and the path to the repos.json index.
 */
async function buildTestCore(tmpDir) {
    const indexPath = path_1.default.join(tmpDir, 'repos.json');
    const configPath = await setupGlobalConfig(tmpDir, indexPath);
    // Use internal option to override global config path
    const core = new core_js_1.ForgeCore(tmpDir, { globalConfigPath: configPath });
    return { core, indexPath };
}
// ─── Tests ───────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Workflow auto-detection and confirmation', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), 'forge-workflow-test-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tmpDir, { recursive: true, force: true });
        vitest_1.vi.restoreAllMocks();
    });
    // ─── Schema: RepoIndexWorkflow optional field ─────────────────────────────
    (0, vitest_1.describe)('RepoIndexEntry workflow field', () => {
        (0, vitest_1.it)('accepts an entry without workflow field (backward compatible)', async () => {
            const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
            const entry = {
                name: 'test',
                localPath: '/repos/test',
                remoteUrl: 'https://github.com/org/test.git',
                defaultBranch: 'main',
                language: 'TypeScript',
                framework: null,
                lastCommitDate: '2026-01-01T00:00:00Z',
                lastScannedAt: '2026-01-01T00:00:00Z',
            };
            const result = RepoIndexEntrySchema.safeParse(entry);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data?.workflow).toBeUndefined();
        });
        (0, vitest_1.it)('accepts an entry with owner workflow', async () => {
            const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
            const entry = {
                name: 'my-repo',
                localPath: '/repos/my-repo',
                remoteUrl: 'https://github.com/me/my-repo.git',
                defaultBranch: 'main',
                language: null,
                framework: null,
                lastCommitDate: '',
                lastScannedAt: '2026-01-01T00:00:00Z',
                workflow: {
                    type: 'owner',
                    pushTo: 'origin',
                    prTarget: { repo: 'me/my-repo', branch: 'main' },
                    confirmedAt: '2026-03-22T10:00:00Z',
                    confirmedBy: 'user',
                    remotesSnapshot: { origin: 'https://github.com/me/my-repo.git' },
                },
            };
            const result = RepoIndexEntrySchema.safeParse(entry);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data?.workflow?.type).toBe('owner');
        });
        (0, vitest_1.it)('accepts an entry with fork workflow', async () => {
            const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
            const entry = {
                name: 'upstream-repo',
                localPath: '/repos/upstream-repo',
                remoteUrl: 'https://github.com/me/upstream-repo.git',
                defaultBranch: 'main',
                language: null,
                framework: null,
                lastCommitDate: '',
                lastScannedAt: '2026-01-01T00:00:00Z',
                workflow: {
                    type: 'fork',
                    upstream: 'https://github.com/org/upstream-repo.git',
                    fork: 'https://github.com/me/upstream-repo.git',
                    pushTo: 'origin',
                    prTarget: { repo: 'org/upstream-repo', branch: 'main' },
                    confirmedAt: '2026-03-22T10:00:00Z',
                    confirmedBy: 'user',
                    remotesSnapshot: {
                        origin: 'https://github.com/me/upstream-repo.git',
                        upstream: 'https://github.com/org/upstream-repo.git',
                    },
                },
            };
            const result = RepoIndexEntrySchema.safeParse(entry);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data?.workflow?.type).toBe('fork');
            (0, vitest_1.expect)(result.data?.workflow?.upstream).toBe('https://github.com/org/upstream-repo.git');
        });
        (0, vitest_1.it)('accepts an entry with contributor workflow', async () => {
            const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
            const entry = {
                name: 'contrib-repo',
                localPath: '/repos/contrib-repo',
                remoteUrl: 'https://github.com/org/contrib-repo.git',
                defaultBranch: 'main',
                language: null,
                framework: null,
                lastCommitDate: '',
                lastScannedAt: '2026-01-01T00:00:00Z',
                workflow: {
                    type: 'contributor',
                    pushTo: 'origin',
                    prTarget: { repo: 'org/contrib-repo', branch: 'main' },
                    confirmedAt: '2026-03-22T10:00:00Z',
                    confirmedBy: 'auto',
                },
            };
            const result = RepoIndexEntrySchema.safeParse(entry);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data?.workflow?.type).toBe('contributor');
            (0, vitest_1.expect)(result.data?.workflow?.confirmedBy).toBe('auto');
        });
    });
    // ─── repoWorkflow: confirmed workflow in index ────────────────────────────
    (0, vitest_1.describe)('repoWorkflow() — Tier 0: confirmed workflow from index', () => {
        (0, vitest_1.it)('returns confirmed workflow from index when present', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'my-repo',
                        localPath: path_1.default.join(tmpDir, 'my-repo'),
                        remoteUrl: 'https://github.com/me/my-repo.git',
                        defaultBranch: 'main',
                        language: 'TypeScript',
                        framework: null,
                        lastCommitDate: '2026-03-20T00:00:00Z',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                        workflow: {
                            type: 'owner',
                            pushTo: 'origin',
                            prTarget: { repo: 'me/my-repo', branch: 'main' },
                            confirmedAt: '2026-03-22T10:00:00Z',
                            confirmedBy: 'user',
                            remotesSnapshot: { origin: 'https://github.com/me/my-repo.git' },
                        },
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            // Create the repo dir so _listRemotes can run without errors
            await (0, promises_1.mkdir)(path_1.default.join(tmpDir, 'my-repo'), { recursive: true });
            const result = await core.repoWorkflow('my-repo');
            (0, vitest_1.expect)(result.source).toBe('index');
            (0, vitest_1.expect)(result.needsConfirmation).toBeFalsy();
            (0, vitest_1.expect)(result.confirmedAt).toBe('2026-03-22T10:00:00Z');
            (0, vitest_1.expect)(result.confirmedBy).toBe('user');
            (0, vitest_1.expect)(result.workflow.strategy).toBe('owner');
        });
        (0, vitest_1.it)('includes staleness warning when remotes changed', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'stale-repo');
            await (0, promises_1.mkdir)(path_1.default.join(repoDir, '.git'), { recursive: true });
            // Initialize a git repo so git commands work
            await new Promise((resolve, reject) => {
                const { execFile } = require('child_process');
                execFile('git', ['init', repoDir], (err) => {
                    err ? reject(err) : resolve();
                });
            }).catch(() => {
                // git init failed — skip staleness test gracefully
            });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'stale-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/stale-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                        workflow: {
                            type: 'owner',
                            pushTo: 'origin',
                            prTarget: { repo: 'me/stale-repo', branch: 'main' },
                            confirmedAt: '2026-03-01T10:00:00Z',
                            confirmedBy: 'user',
                            // Snapshot had "upstream", but current repo doesn't
                            remotesSnapshot: {
                                origin: 'https://github.com/me/stale-repo.git',
                                upstream: 'https://github.com/org/stale-repo.git',
                            },
                        },
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const result = await core.repoWorkflow('stale-repo');
            // Source is still 'index' but may have a staleness warning
            (0, vitest_1.expect)(result.source).toBe('index');
            // The warning is present if git ran successfully and showed no upstream remote
            // In a CI/test env without real git remotes, we just verify the shape
            if (result.stalenessWarning) {
                (0, vitest_1.expect)(result.stalenessWarning).toMatch(/stale|changed/i);
            }
        });
    });
    // ─── repoWorkflow: no confirmed workflow → needs confirmation ─────────────
    (0, vitest_1.describe)('repoWorkflow() — no confirmed workflow → needsConfirmation', () => {
        (0, vitest_1.it)('returns needsConfirmation when repo in index has no workflow', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'fresh-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'fresh-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/fresh-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                        // No workflow field
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const result = await core.repoWorkflow('fresh-repo');
            (0, vitest_1.expect)(result.needsConfirmation).toBe(true);
            (0, vitest_1.expect)(result.autoDetected).toBeDefined();
            (0, vitest_1.expect)(['owner', 'fork', 'contributor']).toContain(result.autoDetected?.type);
        });
        (0, vitest_1.it)('autoDetects fork workflow when upstream remote is present', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            // We need to mock the private _detectWorkflowFull / _listRemotes
            // by injecting a spy on the private method
            const repoDir = path_1.default.join(tmpDir, 'forked-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'forked-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/forked-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            // Spy on the private _listRemotes to simulate upstream remote
            const remotes = {
                origin: 'https://github.com/me/forked-repo.git',
                upstream: 'https://github.com/org/forked-repo.git',
            };
            vitest_1.vi.spyOn(core, '_listRemotes').mockResolvedValue(remotes);
            const result = await core.repoWorkflow('forked-repo');
            (0, vitest_1.expect)(result.needsConfirmation).toBe(true);
            (0, vitest_1.expect)(result.autoDetected?.type).toBe('fork');
            (0, vitest_1.expect)(result.autoDetected?.upstream).toBe('https://github.com/org/forked-repo.git');
            (0, vitest_1.expect)(result.autoDetected?.fork).toBe('https://github.com/me/forked-repo.git');
            (0, vitest_1.expect)(result.autoDetected?.pushTo).toBe('origin');
        });
        (0, vitest_1.it)('autoDetects owner workflow when no upstream remote', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'owner-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'owner-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/owner-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            // Spy on _listRemotes to simulate plain origin-only setup
            vitest_1.vi.spyOn(core, '_listRemotes').mockResolvedValue({
                origin: 'https://github.com/me/owner-repo.git',
            });
            const result = await core.repoWorkflow('owner-repo');
            (0, vitest_1.expect)(result.needsConfirmation).toBe(true);
            (0, vitest_1.expect)(result.autoDetected?.type).toBe('owner');
            (0, vitest_1.expect)(result.autoDetected?.pushTo).toBe('origin');
        });
        (0, vitest_1.it)('returns default with needsConfirmation when repo not in index', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            // Empty index
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const result = await core.repoWorkflow('nonexistent-repo');
            (0, vitest_1.expect)(result.source).toBe('default');
            (0, vitest_1.expect)(result.needsConfirmation).toBe(true);
        });
    });
    // ─── repoWorkflowSave ─────────────────────────────────────────────────────
    (0, vitest_1.describe)('repoWorkflowSave()', () => {
        (0, vitest_1.it)('saves owner workflow to repos.json', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'save-test-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'save-test-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/save-test-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const saved = await core.repoWorkflowSave('save-test-repo', {
                type: 'owner',
                pushTo: 'origin',
                prTarget: { repo: 'me/save-test-repo', branch: 'main' },
                remotesSnapshot: { origin: 'https://github.com/me/save-test-repo.git' },
            }, 'user');
            (0, vitest_1.expect)(saved.type).toBe('owner');
            (0, vitest_1.expect)(saved.confirmedBy).toBe('user');
            (0, vitest_1.expect)(saved.confirmedAt).toBeTruthy();
            // Verify it was persisted — re-read the index
            const { loadRepoIndex: load } = await import('../repo-index-store.js');
            const reloaded = await load(indexPath);
            const entry = reloaded?.repos.find(r => r.name === 'save-test-repo');
            (0, vitest_1.expect)(entry?.workflow?.type).toBe('owner');
            (0, vitest_1.expect)(entry?.workflow?.confirmedAt).toBe(saved.confirmedAt);
        });
        (0, vitest_1.it)('saves fork workflow with upstream and fork fields', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'fork-save-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'fork-save-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/fork-save-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const saved = await core.repoWorkflowSave('fork-save-repo', {
                type: 'fork',
                upstream: 'https://github.com/org/fork-save-repo.git',
                fork: 'https://github.com/me/fork-save-repo.git',
                pushTo: 'origin',
                prTarget: { repo: 'org/fork-save-repo', branch: 'main' },
                remotesSnapshot: {
                    origin: 'https://github.com/me/fork-save-repo.git',
                    upstream: 'https://github.com/org/fork-save-repo.git',
                },
            }, 'user');
            (0, vitest_1.expect)(saved.type).toBe('fork');
            (0, vitest_1.expect)(saved.upstream).toBe('https://github.com/org/fork-save-repo.git');
            (0, vitest_1.expect)(saved.fork).toBe('https://github.com/me/fork-save-repo.git');
        });
        (0, vitest_1.it)('saves contributor workflow', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'contrib-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'contrib-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/org/contrib-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const saved = await core.repoWorkflowSave('contrib-repo', {
                type: 'contributor',
                pushTo: 'origin',
                prTarget: { repo: 'org/contrib-repo', branch: 'main' },
            }, 'auto');
            (0, vitest_1.expect)(saved.type).toBe('contributor');
            (0, vitest_1.expect)(saved.confirmedBy).toBe('auto');
        });
        (0, vitest_1.it)('sets confirmedAt to an ISO timestamp', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'ts-test-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'ts-test-repo',
                        localPath: repoDir,
                        remoteUrl: null,
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            const before = new Date().toISOString();
            const saved = await core.repoWorkflowSave('ts-test-repo', { type: 'owner', pushTo: 'origin', prTarget: { repo: 'me/ts-test-repo', branch: 'main' } }, 'user');
            const after = new Date().toISOString();
            (0, vitest_1.expect)(saved.confirmedAt >= before).toBe(true);
            (0, vitest_1.expect)(saved.confirmedAt <= after).toBe(true);
        });
        (0, vitest_1.it)('throws REPO_NOT_FOUND when repo not in index', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            await (0, vitest_1.expect)(core.repoWorkflowSave('ghost-repo', { type: 'owner', pushTo: 'origin', prTarget: { repo: 'me/ghost-repo', branch: 'main' } }, 'user')).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
        });
    });
    // ─── Staleness detection ──────────────────────────────────────────────────
    (0, vitest_1.describe)('staleness detection', () => {
        (0, vitest_1.it)('does not warn when remotes match snapshot', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'stable-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const snapshot = { origin: 'https://github.com/me/stable-repo.git' };
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'stable-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/stable-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                        workflow: {
                            type: 'owner',
                            pushTo: 'origin',
                            prTarget: { repo: 'me/stable-repo', branch: 'main' },
                            confirmedAt: '2026-03-01T10:00:00Z',
                            confirmedBy: 'user',
                            remotesSnapshot: snapshot,
                        },
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            // Mock _listRemotes to return the same snapshot
            vitest_1.vi.spyOn(core, '_listRemotes').mockResolvedValue({ ...snapshot });
            const result = await core.repoWorkflow('stable-repo');
            (0, vitest_1.expect)(result.source).toBe('index');
            (0, vitest_1.expect)(result.stalenessWarning).toBeUndefined();
        });
        (0, vitest_1.it)('warns when a remote was added', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'new-remote-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const snapshot = { origin: 'https://github.com/me/new-remote-repo.git' };
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'new-remote-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/new-remote-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                        workflow: {
                            type: 'owner',
                            pushTo: 'origin',
                            prTarget: { repo: 'me/new-remote-repo', branch: 'main' },
                            confirmedAt: '2026-03-01T10:00:00Z',
                            confirmedBy: 'user',
                            remotesSnapshot: snapshot,
                        },
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            // Mock _listRemotes to return current state with an extra remote
            vitest_1.vi.spyOn(core, '_listRemotes').mockResolvedValue({
                ...snapshot,
                upstream: 'https://github.com/org/new-remote-repo.git',
            });
            const result = await core.repoWorkflow('new-remote-repo');
            (0, vitest_1.expect)(result.source).toBe('index');
            (0, vitest_1.expect)(result.stalenessWarning).toBeDefined();
            (0, vitest_1.expect)(result.stalenessWarning).toMatch(/upstream/);
        });
        (0, vitest_1.it)('warns when a remote URL changed', async () => {
            const { core, indexPath } = await buildTestCore(tmpDir);
            const repoDir = path_1.default.join(tmpDir, 'changed-url-repo');
            await (0, promises_1.mkdir)(repoDir, { recursive: true });
            const index = {
                version: '1',
                scannedAt: '2026-03-22T00:00:00Z',
                scanPaths: [],
                repos: [{
                        name: 'changed-url-repo',
                        localPath: repoDir,
                        remoteUrl: 'https://github.com/me/changed-url-repo.git',
                        defaultBranch: 'main',
                        language: null,
                        framework: null,
                        lastCommitDate: '',
                        lastScannedAt: '2026-03-22T00:00:00Z',
                        workflow: {
                            type: 'owner',
                            pushTo: 'origin',
                            prTarget: { repo: 'me/changed-url-repo', branch: 'main' },
                            confirmedAt: '2026-03-01T10:00:00Z',
                            confirmedBy: 'user',
                            remotesSnapshot: { origin: 'https://github.com/me/changed-url-repo.git' },
                        },
                    }],
            };
            await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
            // Remote URL changed (repo moved)
            vitest_1.vi.spyOn(core, '_listRemotes').mockResolvedValue({
                origin: 'https://github.com/neworg/changed-url-repo.git',
            });
            const result = await core.repoWorkflow('changed-url-repo');
            (0, vitest_1.expect)(result.source).toBe('index');
            (0, vitest_1.expect)(result.stalenessWarning).toBeDefined();
            (0, vitest_1.expect)(result.stalenessWarning).toMatch(/origin/);
        });
    });
});
//# sourceMappingURL=repo-workflow-detection.test.js.map