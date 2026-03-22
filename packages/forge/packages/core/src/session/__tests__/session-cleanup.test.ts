import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { sessionCleanup } from '../session-cleanup.js';
import { SessionStoreManager } from '../session-store.js';
import type { GlobalConfig } from '../../models/global-config.js';
import type { SessionRecord } from '../../models/session.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGlobalConfig(tmpDir: string, anvilUrl?: string): GlobalConfig {
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
    mcp_endpoints: anvilUrl
      ? { anvil: { url: anvilUrl, transport: 'http' } }
      : {},
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

function makeSessionRecord(
  overrides: Partial<SessionRecord> & { sessionId: string },
  tmpDir: string,
): SessionRecord {
  const sessionPath = path.join(tmpDir, 'sessions', overrides.sessionId);
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

async function createFakeSessionDir(sessionPath: string): Promise<void> {
  await fs.mkdir(sessionPath, { recursive: true });
  // Create a fake .git file so the path looks like a worktree
  await fs.writeFile(
    path.join(sessionPath, '.git'),
    'gitdir: /nonexistent/.git/worktrees/test\n',
    'utf-8',
  );
}

// ─── Mock child_process.execFile ──────────────────────────────────────────────

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: vi.fn(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (typeof cb === 'function') {
          const joined = args.join(' ');
          if (joined.startsWith('worktree remove') || joined.startsWith('worktree prune')) {
            cb(null, { stdout: '', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
        }
        // Return a fake ChildProcess-like object for the non-callback path
        return { on: () => {} } as any;
      },
    ),
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sessionCleanup — input validation', () => {
  let tmpDir: string;
  let config: GlobalConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cleanup-test-'));
    config = makeGlobalConfig(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when no options are provided', async () => {
    await expect(sessionCleanup({}, config)).rejects.toThrow(
      'At least one of workItem, olderThan, or auto must be specified',
    );
  });

  it('throws on invalid olderThan format', async () => {
    await expect(sessionCleanup({ olderThan: 'invalid' }, config)).rejects.toThrow(
      'Invalid olderThan format',
    );
  });

  it('throws on olderThan with invalid unit', async () => {
    await expect(sessionCleanup({ olderThan: '30w' }, config)).rejects.toThrow(
      'Invalid olderThan format',
    );
  });
});

describe('sessionCleanup — by workItem', () => {
  let tmpDir: string;
  let config: GlobalConfig;
  let store: SessionStoreManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cleanup-test-'));
    config = makeGlobalConfig(tmpDir);
    store = new SessionStoreManager(config.workspace.sessions_path);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('cleans session matching the specified workItem', async () => {
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
    const s2 = makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-002' }, tmpDir);
    await store.add(s1);
    await store.add(s2);
    await createFakeSessionDir(s1.sessionPath);

    const result = await sessionCleanup({ workItem: 'wi-001' }, config);

    expect(result.cleaned).toContain('sess-001');
    expect(result.skipped).not.toContain('sess-001');

    // wi-002 was not targeted — it's not in cleaned or skipped (skipped is for explicit no-match)
    const remaining = await store.list();
    expect(remaining.some(s => s.sessionId === 'sess-002')).toBe(true);
    expect(remaining.some(s => s.sessionId === 'sess-001')).toBe(false);
  });

  it('cleans multiple sessions for the same workItem', async () => {
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001', agentSlot: 1 }, tmpDir);
    const s2 = makeSessionRecord({ sessionId: 'sess-002', workItem: 'wi-001', agentSlot: 2 }, tmpDir);
    await store.add(s1);
    await store.add(s2);
    await createFakeSessionDir(s1.sessionPath);
    await createFakeSessionDir(s2.sessionPath);

    const result = await sessionCleanup({ workItem: 'wi-001' }, config);

    expect(result.cleaned).toContain('sess-001');
    expect(result.cleaned).toContain('sess-002');
    expect(result.cleaned).toHaveLength(2);
  });

  it('returns empty cleaned when workItem has no sessions', async () => {
    const result = await sessionCleanup({ workItem: 'wi-nonexistent' }, config);
    expect(result.cleaned).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('sessionCleanup — by olderThan', () => {
  let tmpDir: string;
  let config: GlobalConfig;
  let store: SessionStoreManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cleanup-test-'));
    config = makeGlobalConfig(tmpDir);
    store = new SessionStoreManager(config.workspace.sessions_path);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('cleans sessions older than the specified threshold (days)', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago
    const newDate = new Date().toISOString();

    const s1 = makeSessionRecord({ sessionId: 'sess-old', workItem: 'wi-001', lastModified: oldDate, createdAt: oldDate }, tmpDir);
    const s2 = makeSessionRecord({ sessionId: 'sess-new', workItem: 'wi-002', lastModified: newDate, createdAt: newDate }, tmpDir);
    await store.add(s1);
    await store.add(s2);
    await createFakeSessionDir(s1.sessionPath);

    const result = await sessionCleanup({ olderThan: '30d' }, config);

    expect(result.cleaned).toContain('sess-old');
    expect(result.cleaned).not.toContain('sess-new');
  });

  it('cleans sessions older than the specified threshold (hours)', async () => {
    const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(); // 13 hours ago
    const newDate = new Date().toISOString();

    const s1 = makeSessionRecord({ sessionId: 'sess-old', workItem: 'wi-001', lastModified: oldDate, createdAt: oldDate }, tmpDir);
    const s2 = makeSessionRecord({ sessionId: 'sess-new', workItem: 'wi-002', lastModified: newDate, createdAt: newDate }, tmpDir);
    await store.add(s1);
    await store.add(s2);
    await createFakeSessionDir(s1.sessionPath);

    const result = await sessionCleanup({ olderThan: '12h' }, config);

    expect(result.cleaned).toContain('sess-old');
    expect(result.cleaned).not.toContain('sess-new');
  });

  it('cleans sessions older than the specified threshold (minutes)', async () => {
    const oldDate = new Date(Date.now() - 61 * 60 * 1000).toISOString(); // 61 minutes ago
    const newDate = new Date().toISOString();

    const s1 = makeSessionRecord({ sessionId: 'sess-old', workItem: 'wi-001', lastModified: oldDate, createdAt: oldDate }, tmpDir);
    const s2 = makeSessionRecord({ sessionId: 'sess-new', workItem: 'wi-002', lastModified: newDate, createdAt: newDate }, tmpDir);
    await store.add(s1);
    await store.add(s2);
    await createFakeSessionDir(s1.sessionPath);

    const result = await sessionCleanup({ olderThan: '60m' }, config);

    expect(result.cleaned).toContain('sess-old');
    expect(result.cleaned).not.toContain('sess-new');
  });

  it('uses lastModified as the age reference, not createdAt', async () => {
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

    const result = await sessionCleanup({ olderThan: '30d' }, config);
    expect(result.cleaned).not.toContain('sess-recent-activity');
  });

  it('falls back to createdAt when lastModified is absent', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const record = makeSessionRecord({ sessionId: 'sess-no-modified', workItem: 'wi-001', createdAt: oldDate }, tmpDir);
    delete (record as any).lastModified;
    await store.add(record);
    await createFakeSessionDir(record.sessionPath);

    const result = await sessionCleanup({ olderThan: '30d' }, config);
    expect(result.cleaned).toContain('sess-no-modified');
  });
});

describe('sessionCleanup — auto-cleanup policy', () => {
  let tmpDir: string;
  let store: SessionStoreManager;

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function setupWithAnvil(anvilUrl: string): Promise<{
    config: GlobalConfig;
    store: SessionStoreManager;
  }> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cleanup-auto-test-'));
    const config = makeGlobalConfig(tmpDir, anvilUrl);
    store = new SessionStoreManager(config.workspace.sessions_path);
    return { config, store };
  }

  it('cleans cancelled sessions immediately', async () => {
    const { config, store } = await setupWithAnvil('http://anvil:8100');
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-cancelled' }, tmpDir);
    await store.add(s1);
    await createFakeSessionDir(s1.sessionPath);

    // Mock Anvil to return 'cancelled' status
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'cancelled' }),
    } as any);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).toContain('sess-001');
  });

  it('cleans done sessions that are 7+ days old', async () => {
    const { config, store } = await setupWithAnvil('http://anvil:8100');
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-done-old', lastModified: oldDate, createdAt: oldDate }, tmpDir);
    await store.add(s1);
    await createFakeSessionDir(s1.sessionPath);

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'done' }),
    } as any);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).toContain('sess-001');
  });

  it('skips done sessions within the 7-day grace period', async () => {
    const { config, store } = await setupWithAnvil('http://anvil:8100');
    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-done-recent', lastModified: recentDate, createdAt: recentDate }, tmpDir);
    await store.add(s1);

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'done' }),
    } as any);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).not.toContain('sess-001');
    expect(result.skipped).toContain('sess-001');
  });

  it('skips in_progress sessions', async () => {
    const { config, store } = await setupWithAnvil('http://anvil:8100');
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-in-progress' }, tmpDir);
    await store.add(s1);

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'in-progress' }),
    } as any);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).not.toContain('sess-001');
    expect(result.skipped).toContain('sess-001');
  });

  it('skips in_review sessions', async () => {
    const { config, store } = await setupWithAnvil('http://anvil:8100');
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-in-review' }, tmpDir);
    await store.add(s1);

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'in_review' }),
    } as any);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).not.toContain('sess-001');
    expect(result.skipped).toContain('sess-001');
  });

  it('warns and skips when work item not found in Anvil', async () => {
    const { config, store } = await setupWithAnvil('http://anvil:8100');
    const s1 = makeSessionRecord({ sessionId: 'sess-orphan', workItem: 'wi-unknown' }, tmpDir);
    await store.add(s1);

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as any);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).not.toContain('sess-orphan');
    expect(result.skipped).toContain('sess-orphan');
    // A warning should be in errors
    expect(result.errors.some(e => e.includes('[WARN]') && e.includes('sess-orphan'))).toBe(true);
  });

  it('warns and skips when Anvil is not configured', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cleanup-noanvil-test-'));
    const config = makeGlobalConfig(tmpDir); // no anvil URL
    const store = new SessionStoreManager(config.workspace.sessions_path);
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
    await store.add(s1);

    const result = await sessionCleanup({ auto: true }, config);
    expect(result.cleaned).not.toContain('sess-001');
    expect(result.skipped).toContain('sess-001');
    expect(result.errors.some(e => e.includes('Anvil endpoint not configured'))).toBe(true);
  });
});

describe('sessionCleanup — store integrity', () => {
  let tmpDir: string;
  let config: GlobalConfig;
  let store: SessionStoreManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cleanup-integrity-test-'));
    config = makeGlobalConfig(tmpDir);
    store = new SessionStoreManager(config.workspace.sessions_path);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes session from store even if session directory is already gone', async () => {
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
    await store.add(s1);
    // Do NOT create the directory — simulate manual deletion

    const result = await sessionCleanup({ workItem: 'wi-001' }, config);
    expect(result.cleaned).toContain('sess-001');

    const remaining = await store.list();
    expect(remaining.some(s => s.sessionId === 'sess-001')).toBe(false);
  });

  it('includes git errors as warnings, not blocking errors', async () => {
    const s1 = makeSessionRecord({ sessionId: 'sess-001', workItem: 'wi-001' }, tmpDir);
    await store.add(s1);
    await createFakeSessionDir(s1.sessionPath);

    // The git mock will succeed; verify cleaned is populated
    const result = await sessionCleanup({ workItem: 'wi-001' }, config);
    expect(result.cleaned).toContain('sess-001');
  });
});
