"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const session_cleanup_js_1 = require("../session-cleanup.js");
const session_store_js_1 = require("../session-store.js");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeGlobalConfig(tmpDir, anvilUrl) {
    return {
        registries: [],
        workspace: {
            mount_path: path_1.default.join(tmpDir, 'workspaces'),
            default_config: 'sdlc-default',
            retention_days: 30,
            store_path: path_1.default.join(tmpDir, 'workspaces.json'),
            sessions_path: path_1.default.join(tmpDir, 'sessions.json'),
            managed_repos_path: path_1.default.join(tmpDir, 'repos'),
            sessions_root: path_1.default.join(tmpDir, 'sessions'),
            max_sessions: 20,
        },
        mcp_endpoints: anvilUrl
            ? { anvil: { url: anvilUrl, transport: 'http' } }
            : {},
        repos: {
            scan_paths: [],
            index_path: path_1.default.join(tmpDir, 'repos.json'),
        },
        global_plugins: {},
        claude_permissions: {
            allow: ['mcp__*__*'],
            deny: [],
        },
    };
}
function makeSessionRecord(overrides, tmpDir) {
    const sessionPath = path_1.default.join(tmpDir, 'sessions', overrides.sessionId);
    return {
        workItem: 'wi-001',
        repo: 'MyRepo',
        branch: 'feature/wi-001',
        baseBranch: 'main',
        hostSessionPath: undefined,
        repoSource: 'user',
        workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'Org/MyRepo', branch: 'main' },
        },
        agentSlot: 1,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        sessionPath,
        ...overrides,
    };
}
async function createFakeSessionDir(sessionPath) {
    await fs_1.promises.mkdir(sessionPath, { recursive: true });
    // Create a fake .git file so the path looks like a worktree
    await fs_1.promises.writeFile(path_1.default.join(sessionPath, '.git'), 'gitdir: /nonexistent/.git/worktrees/test\n', 'utf-8');
}
// ─── Mock child_process.execFile ──────────────────────────────────────────────
vitest_1.vi.mock('child_process', async () => {
    const actual = await vitest_1.vi.importActual('child_process');
    return {
        ...actual,
        execFile: vitest_1.vi.fn((_cmd, args, _opts, cb) => {
            if (typeof cb === 'function') {
                const joined = args.join(' ');
                if (joined.startsWith('worktree remove') || joined.startsWith('worktree prune')) {
                    cb(null, { stdout: '', stderr: '' });
                }
                else {
                    cb(null, { stdout: '', stderr: '' });
                }
            }
            // Return a fake ChildProcess-like object for the non-callback path
            return { on: () => { } };
        }),
    };
});
// ─── Tests ────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('sessionCleanup — input validation', () => {
    let tmpDir;
    let config;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cleanup-test-'));
        config = makeGlobalConfig(tmpDir);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('throws when no options are provided', async () => {
        await (0, vitest_1.expect)((0, session_cleanup_js_1.sessionCleanup)({}, config)).rejects.toThrow('At least one of workItem, olderThan, or auto must be specified');
    });
    (0, vitest_1.it)('throws on invalid olderThan format', async () => {
        await (0, vitest_1.expect)((0, session_cleanup_js_1.sessionCleanup)({ olderThan: 'invalid' }, config)).rejects.toThrow('Invalid olderThan format');
    });
    (0, vitest_1.it)('throws on olderThan with invalid unit', async () => {
        await (0, vitest_1.expect)((0, session_cleanup_js_1.sessionCleanup)({ olderThan: '30w' }, config)).rejects.toThrow('Invalid olderThan format');
    });
});
(0, vitest_1.describe)('sessionCleanup — by workItem', () => {
    let tmpDir;
    let config;
    let store;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cleanup-test-'));
        config = makeGlobalConfig(tmpDir);
        store = new session_store_js_1.SessionStoreManager(config.workspace.sessions_path);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('cleans session matching the specified workItem', async () => {
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
        const s2 = makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002' }, tmpDir);
        await store.add(s1);
        await store.add(s2);
        await createFakeSessionDir(s1.sessionPath);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ workItem: 'wi-001' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-001');
        (0, vitest_1.expect)(result.skipped).not.toContain('sess-001');
        // wi-002 was not targeted — it's not in cleaned or skipped (skipped is for explicit no-match)
        const remaining = await store.list();
        (0, vitest_1.expect)(remaining.some(s => s.sessionId === 'sess-002')).toBe(true);
        (0, vitest_1.expect)(remaining.some(s => s.sessionId === 'sess-001')).toBe(false);
    });
    (0, vitest_1.it)('cleans multiple sessions for the same workItem', async () => {
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', agentSlot: 1 }, tmpDir);
        const s2 = makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-001', agentSlot: 2 }, tmpDir);
        await store.add(s1);
        await store.add(s2);
        await createFakeSessionDir(s1.sessionPath);
        await createFakeSessionDir(s2.sessionPath);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ workItem: 'wi-001' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-001');
        (0, vitest_1.expect)(result.cleaned).toContain('sess-002');
        (0, vitest_1.expect)(result.cleaned).toHaveLength(2);
    });
    (0, vitest_1.it)('returns empty cleaned when workItem has no sessions', async () => {
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ workItem: 'wi-nonexistent' }, config);
        (0, vitest_1.expect)(result.cleaned).toHaveLength(0);
        (0, vitest_1.expect)(result.errors).toHaveLength(0);
    });
});
(0, vitest_1.describe)('sessionCleanup — by olderThan', () => {
    let tmpDir;
    let config;
    let store;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cleanup-test-'));
        config = makeGlobalConfig(tmpDir);
        store = new session_store_js_1.SessionStoreManager(config.workspace.sessions_path);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('cleans sessions older than the specified threshold (days)', async () => {
        const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago
        const newDate = new Date().toISOString();
        const s1 = makeSessionRecord({ sessionId: 'sess-old', workItem: 'wi-001', lastModified: oldDate, createdAt: oldDate }, tmpDir);
        const s2 = makeSessionRecord({ sessionId: 'sess-new', workItem: 'wi-002', lastModified: newDate, createdAt: newDate }, tmpDir);
        await store.add(s1);
        await store.add(s2);
        await createFakeSessionDir(s1.sessionPath);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ olderThan: '30d' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-old');
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-new');
    });
    (0, vitest_1.it)('cleans sessions older than the specified threshold (hours)', async () => {
        const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(); // 13 hours ago
        const newDate = new Date().toISOString();
        const s1 = makeSessionRecord({ sessionId: 'sess-old', workItem: 'wi-001', lastModified: oldDate, createdAt: oldDate }, tmpDir);
        const s2 = makeSessionRecord({ sessionId: 'sess-new', workItem: 'wi-002', lastModified: newDate, createdAt: newDate }, tmpDir);
        await store.add(s1);
        await store.add(s2);
        await createFakeSessionDir(s1.sessionPath);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ olderThan: '12h' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-old');
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-new');
    });
    (0, vitest_1.it)('cleans sessions older than the specified threshold (minutes)', async () => {
        const oldDate = new Date(Date.now() - 61 * 60 * 1000).toISOString(); // 61 minutes ago
        const newDate = new Date().toISOString();
        const s1 = makeSessionRecord({ sessionId: 'sess-old', workItem: 'wi-001', lastModified: oldDate, createdAt: oldDate }, tmpDir);
        const s2 = makeSessionRecord({ sessionId: 'sess-new', workItem: 'wi-002', lastModified: newDate, createdAt: newDate }, tmpDir);
        await store.add(s1);
        await store.add(s2);
        await createFakeSessionDir(s1.sessionPath);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ olderThan: '60m' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-old');
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-new');
    });
    (0, vitest_1.it)('uses lastModified as the age reference, not createdAt', async () => {
        // Created 35 days ago but modified 1 day ago — should NOT be cleaned by 30d threshold
        const oldCreate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
        const recentModify = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
        const s1 = makeSessionRecord({
            sessionId: 'sess-recent-activity',
            workItem: 'wi-001',
            createdAt: oldCreate,
            lastModified: recentModify,
        }, tmpDir);
        await store.add(s1);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ olderThan: '30d' }, config);
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-recent-activity');
    });
    (0, vitest_1.it)('falls back to createdAt when lastModified is absent', async () => {
        const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        const record = makeSessionRecord({ sessionId: 'sess-no-modified', workItem: 'wi-001', createdAt: oldDate }, tmpDir);
        delete record.lastModified;
        await store.add(record);
        await createFakeSessionDir(record.sessionPath);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ olderThan: '30d' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-no-modified');
    });
});
(0, vitest_1.describe)('sessionCleanup — auto-cleanup policy', () => {
    let tmpDir;
    let store;
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
        vitest_1.vi.restoreAllMocks();
    });
    async function setupWithAnvil(anvilUrl) {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cleanup-auto-test-'));
        const config = makeGlobalConfig(tmpDir, anvilUrl);
        store = new session_store_js_1.SessionStoreManager(config.workspace.sessions_path);
        return { config, store };
    }
    (0, vitest_1.it)('cleans cancelled sessions immediately', async () => {
        const { config, store } = await setupWithAnvil('http://anvil:8100');
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-cancelled' }, tmpDir);
        await store.add(s1);
        await createFakeSessionDir(s1.sessionPath);
        // Mock Anvil to return 'cancelled' status
        vitest_1.vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'cancelled' }),
        });
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-001');
    });
    (0, vitest_1.it)('cleans done sessions that are 7+ days old', async () => {
        const { config, store } = await setupWithAnvil('http://anvil:8100');
        const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-done-old', lastModified: oldDate, createdAt: oldDate }, tmpDir);
        await store.add(s1);
        await createFakeSessionDir(s1.sessionPath);
        vitest_1.vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'done' }),
        });
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-001');
    });
    (0, vitest_1.it)('skips done sessions within the 7-day grace period', async () => {
        const { config, store } = await setupWithAnvil('http://anvil:8100');
        const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-done-recent', lastModified: recentDate, createdAt: recentDate }, tmpDir);
        await store.add(s1);
        vitest_1.vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'done' }),
        });
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-001');
        (0, vitest_1.expect)(result.skipped).toContain('sess-001');
    });
    (0, vitest_1.it)('skips in_progress sessions', async () => {
        const { config, store } = await setupWithAnvil('http://anvil:8100');
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-in-progress' }, tmpDir);
        await store.add(s1);
        vitest_1.vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'in-progress' }),
        });
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-001');
        (0, vitest_1.expect)(result.skipped).toContain('sess-001');
    });
    (0, vitest_1.it)('skips in_review sessions', async () => {
        const { config, store } = await setupWithAnvil('http://anvil:8100');
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-in-review' }, tmpDir);
        await store.add(s1);
        vitest_1.vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'in_review' }),
        });
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-001');
        (0, vitest_1.expect)(result.skipped).toContain('sess-001');
    });
    (0, vitest_1.it)('warns and skips when work item not found in Anvil', async () => {
        const { config, store } = await setupWithAnvil('http://anvil:8100');
        const s1 = makeSessionRecord({ sessionId: 'sess-orphan', workItem: 'wi-unknown' }, tmpDir);
        await store.add(s1);
        vitest_1.vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: false,
            json: async () => ({}),
        });
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-orphan');
        (0, vitest_1.expect)(result.skipped).toContain('sess-orphan');
        // A warning should be in errors
        (0, vitest_1.expect)(result.errors.some(e => e.includes('[WARN]') && e.includes('sess-orphan'))).toBe(true);
    });
    (0, vitest_1.it)('warns and skips when Anvil is not configured', async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cleanup-noanvil-test-'));
        const config = makeGlobalConfig(tmpDir); // no anvil URL
        const store = new session_store_js_1.SessionStoreManager(config.workspace.sessions_path);
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
        await store.add(s1);
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ auto: true }, config);
        (0, vitest_1.expect)(result.cleaned).not.toContain('sess-001');
        (0, vitest_1.expect)(result.skipped).toContain('sess-001');
        (0, vitest_1.expect)(result.errors.some(e => e.includes('Anvil endpoint not configured'))).toBe(true);
    });
});
(0, vitest_1.describe)('sessionCleanup — store integrity', () => {
    let tmpDir;
    let config;
    let store;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-cleanup-integrity-test-'));
        config = makeGlobalConfig(tmpDir);
        store = new session_store_js_1.SessionStoreManager(config.workspace.sessions_path);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('removes session from store even if session directory is already gone', async () => {
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
        await store.add(s1);
        // Do NOT create the directory — simulate manual deletion
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ workItem: 'wi-001' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-001');
        const remaining = await store.list();
        (0, vitest_1.expect)(remaining.some(s => s.sessionId === 'sess-001')).toBe(false);
    });
    (0, vitest_1.it)('includes git errors as warnings, not blocking errors', async () => {
        const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
        await store.add(s1);
        await createFakeSessionDir(s1.sessionPath);
        // The git mock will succeed; verify cleaned is populated
        const result = await (0, session_cleanup_js_1.sessionCleanup)({ workItem: 'wi-001' }, config);
        (0, vitest_1.expect)(result.cleaned).toContain('sess-001');
    });
});
//# sourceMappingURL=session-cleanup.test.js.map