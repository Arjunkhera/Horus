"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const session_list_js_1 = require("../session-list.js");
const session_store_js_1 = require("../session-store.js");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeGlobalConfig(tmpDir) {
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
        mcp_endpoints: {},
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
function makeSessionRecord(overrides = {}) {
    const base = {
        sessionId: 'sess-aabbccdd',
        workItem: 'wi-001',
        repo: 'MyRepo',
        branch: 'feature/wi-001',
        baseBranch: 'main',
        sessionPath: '/data/sessions/wi-001-myrepo',
        repoSource: 'user',
        workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'Org/MyRepo', branch: 'main' },
        },
        agentSlot: 1,
        createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
        lastModified: new Date('2026-01-01T00:00:00Z').toISOString(),
    };
    return { ...base, ...overrides };
}
// ─── Tests ────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('sessionList', () => {
    let tmpDir;
    let config;
    let store;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-session-list-test-'));
        config = makeGlobalConfig(tmpDir);
        store = new session_store_js_1.SessionStoreManager(config.workspace.sessions_path);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('returns empty sessions array when store is empty', async () => {
        const result = await (0, session_list_js_1.sessionList)({}, config);
        (0, vitest_1.expect)(result.sessions).toEqual([]);
    });
    (0, vitest_1.it)('returns all sessions when no filter is applied', async () => {
        await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'RepoA' }));
        await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002', repo: 'RepoB' }));
        const result = await (0, session_list_js_1.sessionList)({}, config);
        (0, vitest_1.expect)(result.sessions).toHaveLength(2);
    });
    (0, vitest_1.it)('filters by repo (case-insensitive)', async () => {
        await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'MyRepo' }));
        await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002', repo: 'OtherRepo' }));
        const result = await (0, session_list_js_1.sessionList)({ repo: 'myrepo' }, config);
        (0, vitest_1.expect)(result.sessions).toHaveLength(1);
        (0, vitest_1.expect)(result.sessions[0].repo).toBe('MyRepo');
    });
    (0, vitest_1.it)('filters by workItem (exact match)', async () => {
        await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'RepoA' }));
        await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002', repo: 'RepoA' }));
        const result = await (0, session_list_js_1.sessionList)({ workItem: 'wi-001' }, config);
        (0, vitest_1.expect)(result.sessions).toHaveLength(1);
        (0, vitest_1.expect)(result.sessions[0].workItem).toBe('wi-001');
    });
    (0, vitest_1.it)('filters by both repo and workItem (AND semantics)', async () => {
        await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'RepoA' }));
        await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-001', repo: 'RepoB' }));
        await store.add(makeSessionRecord({ sessionId: 'sess-003', workItem: 'wi-002', repo: 'RepoA' }));
        const result = await (0, session_list_js_1.sessionList)({ repo: 'RepoA', workItem: 'wi-001' }, config);
        (0, vitest_1.expect)(result.sessions).toHaveLength(1);
        (0, vitest_1.expect)(result.sessions[0].sessionId).toBe('sess-001');
    });
    (0, vitest_1.it)('returns sessionPath as hostSessionPath when present', async () => {
        await store.add(makeSessionRecord({
            sessionId: 'sess-001',
            sessionPath: '/data/sessions/wi-001-myrepo',
            hostSessionPath: '/Users/arkhera/Horus/data/sessions/wi-001-myrepo',
        }));
        const result = await (0, session_list_js_1.sessionList)({}, config);
        (0, vitest_1.expect)(result.sessions[0].sessionPath).toBe('/Users/arkhera/Horus/data/sessions/wi-001-myrepo');
    });
    (0, vitest_1.it)('falls back to sessionPath when hostSessionPath is not set', async () => {
        await store.add(makeSessionRecord({
            sessionId: 'sess-001',
            sessionPath: '/data/sessions/wi-001-myrepo',
            hostSessionPath: undefined,
        }));
        const result = await (0, session_list_js_1.sessionList)({}, config);
        (0, vitest_1.expect)(result.sessions[0].sessionPath).toBe('/data/sessions/wi-001-myrepo');
    });
    (0, vitest_1.it)('uses createdAt as lastModified fallback for old records', async () => {
        // Session without lastModified field (pre-WI-5 record)
        const record = makeSessionRecord({ sessionId: 'sess-001', createdAt: '2026-01-01T00:00:00.000Z' });
        delete record.lastModified;
        await store.add(record);
        const result = await (0, session_list_js_1.sessionList)({}, config);
        (0, vitest_1.expect)(result.sessions[0].lastModified).toBe('2026-01-01T00:00:00.000Z');
    });
    (0, vitest_1.it)('includes all required fields in each session item', async () => {
        await store.add(makeSessionRecord({ sessionId: 'sess-001' }));
        const result = await (0, session_list_js_1.sessionList)({}, config);
        const s = result.sessions[0];
        (0, vitest_1.expect)(s).toHaveProperty('sessionId');
        (0, vitest_1.expect)(s).toHaveProperty('sessionPath');
        (0, vitest_1.expect)(s).toHaveProperty('repo');
        (0, vitest_1.expect)(s).toHaveProperty('workItem');
        (0, vitest_1.expect)(s).toHaveProperty('branch');
        (0, vitest_1.expect)(s).toHaveProperty('createdAt');
        (0, vitest_1.expect)(s).toHaveProperty('lastModified');
    });
});
//# sourceMappingURL=session-list.test.js.map