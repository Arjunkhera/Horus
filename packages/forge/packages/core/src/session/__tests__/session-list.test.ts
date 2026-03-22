import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { sessionList } from '../session-list.js';
import { SessionStoreManager } from '../session-store.js';
import type { GlobalConfig } from '../../models/global-config.js';
import type { SessionRecord } from '../../models/session.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGlobalConfig(tmpDir: string): GlobalConfig {
  return {
    registries: [],
    workspace: {
      mount_path: path.join(tmpDir, 'workspaces'),
      default_config: 'sdlc-default',
      retention_days: 30,
      store_path: path.join(tmpDir, 'workspaces.json'),
      sessions_path: path.join(tmpDir, 'sessions.json'),
      managed_repos_path: path.join(tmpDir, 'repos'),
      sessions_root: path.join(tmpDir, 'sessions'),
      max_sessions: 20,
    },
    mcp_endpoints: {},
    repos: {
      scan_paths: [],
      index_path: path.join(tmpDir, 'repos.json'),
    },
    global_plugins: {},
    claude_permissions: {
      allow: ['mcp__*__*'],
      deny: [],
    },
  };
}

function makeSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const base: SessionRecord = {
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

describe('sessionList', () => {
  let tmpDir: string;
  let config: GlobalConfig;
  let store: SessionStoreManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-session-list-test-'));
    config = makeGlobalConfig(tmpDir);
    store = new SessionStoreManager(config.workspace.sessions_path);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty sessions array when store is empty', async () => {
    const result = await sessionList({}, config);
    expect(result.sessions).toEqual([]);
  });

  it('returns all sessions when no filter is applied', async () => {
    await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'RepoA' }));
    await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002', repo: 'RepoB' }));

    const result = await sessionList({}, config);
    expect(result.sessions).toHaveLength(2);
  });

  it('filters by repo (case-insensitive)', async () => {
    await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'MyRepo' }));
    await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002', repo: 'OtherRepo' }));

    const result = await sessionList({ repo: 'myrepo' }, config);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].repo).toBe('MyRepo');
  });

  it('filters by workItem (exact match)', async () => {
    await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'RepoA' }));
    await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002', repo: 'RepoA' }));

    const result = await sessionList({ workItem: 'wi-001' }, config);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].workItem).toBe('wi-001');
  });

  it('filters by both repo and workItem (AND semantics)', async () => {
    await store.add(makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', repo: 'RepoA' }));
    await store.add(makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-001', repo: 'RepoB' }));
    await store.add(makeSessionRecord({ sessionId: 'sess-003', workItem: 'wi-002', repo: 'RepoA' }));

    const result = await sessionList({ repo: 'RepoA', workItem: 'wi-001' }, config);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionId).toBe('sess-001');
  });

  it('returns sessionPath as hostSessionPath when present', async () => {
    await store.add(makeSessionRecord({
      sessionId: 'sess-001',
      sessionPath: '/data/sessions/wi-001-myrepo',
      hostSessionPath: '/Users/arkhera/Horus/data/sessions/wi-001-myrepo',
    }));

    const result = await sessionList({}, config);
    expect(result.sessions[0].sessionPath).toBe('/Users/arkhera/Horus/data/sessions/wi-001-myrepo');
  });

  it('falls back to sessionPath when hostSessionPath is not set', async () => {
    await store.add(makeSessionRecord({
      sessionId: 'sess-001',
      sessionPath: '/data/sessions/wi-001-myrepo',
      hostSessionPath: undefined,
    }));

    const result = await sessionList({}, config);
    expect(result.sessions[0].sessionPath).toBe('/data/sessions/wi-001-myrepo');
  });

  it('uses createdAt as lastModified fallback for old records', async () => {
    // Session without lastModified field (pre-WI-5 record)
    const record = makeSessionRecord({ sessionId: 'sess-001', createdAt: '2026-01-01T00:00:00.000Z' });
    delete (record as any).lastModified;
    await store.add(record);

    const result = await sessionList({}, config);
    expect(result.sessions[0].lastModified).toBe('2026-01-01T00:00:00.000Z');
  });

  it('includes all required fields in each session item', async () => {
    await store.add(makeSessionRecord({ sessionId: 'sess-001' }));
    const result = await sessionList({}, config);
    const s = result.sessions[0];
    expect(s).toHaveProperty('sessionId');
    expect(s).toHaveProperty('sessionPath');
    expect(s).toHaveProperty('repo');
    expect(s).toHaveProperty('workItem');
    expect(s).toHaveProperty('branch');
    expect(s).toHaveProperty('createdAt');
    expect(s).toHaveProperty('lastModified');
  });
});
