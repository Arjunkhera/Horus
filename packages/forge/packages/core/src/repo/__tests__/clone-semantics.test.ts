import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  isCloneStale,
  cloneTtlMs,
  DEFAULT_CLONE_TTL_MS,
  ensureClone,
  refreshIfStale,
  createSessionWorktree,
} from '../clone-semantics.js';
import { repoClonePath, worktreePath } from '../clone-layout.js';
import { LocalRepoStateStoreManager, repoStatePath } from '../local-repo-state-store.js';

describe('isCloneStale (pure)', () => {
  const now = new Date('2026-05-20T12:00:00.000Z');
  it('never-fetched (null) is always stale', () => {
    expect(isCloneStale(null, DEFAULT_CLONE_TTL_MS, now)).toBe(true);
  });
  it('within TTL is fresh', () => {
    expect(isCloneStale('2026-05-20T11:30:00.000Z', 60 * 60 * 1000, now)).toBe(false);
  });
  it('beyond TTL is stale', () => {
    expect(isCloneStale('2026-05-20T10:00:00.000Z', 60 * 60 * 1000, now)).toBe(true);
  });
});

describe('cloneTtlMs', () => {
  it('defaults to 1h', () => {
    expect(cloneTtlMs()).toBe(DEFAULT_CLONE_TTL_MS);
  });
  it('honors an explicit override', () => {
    expect(cloneTtlMs(5000)).toBe(5000);
  });
  it('honors HORUS_CLONE_TTL_MS', () => {
    process.env.HORUS_CLONE_TTL_MS = '7777';
    try {
      expect(cloneTtlMs()).toBe(7777);
    } finally {
      delete process.env.HORUS_CLONE_TTL_MS;
    }
  });
});

const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

describe('clone-semantics integration', () => {
  let root: string;
  let source: string;
  let dataPath: string;
  const url = () => source; // local path is a valid git clone source

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'ci3-cs-'));
    // A local "remote" repo named github.com/acme/widget so coordinate derivation works.
    source = join(root, 'src', 'github.com', 'acme', 'widget');
    await fs.mkdir(source, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: source });
    await fs.writeFile(join(source, 'README.md'), 'v1');
    execFileSync('git', [...GIT_ID, 'add', '.'], { cwd: source });
    execFileSync('git', [...GIT_ID, 'commit', '-q', '-m', 'init'], { cwd: source });
    dataPath = join(root, 'data');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('ensureClone clones into the deterministic Horus path and is idempotent', async () => {
    const p1 = await ensureClone(url(), { dataPath });
    expect(p1).toBe(repoClonePath(url(), dataPath));
    expect((await fs.stat(join(p1, '.git'))).isDirectory()).toBe(true);
    // .horus/ ignored
    const exclude = await fs.readFile(join(p1, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('/.horus/');
    // idempotent: second call no-throw, same path, state deduped
    const p2 = await ensureClone(url(), { dataPath });
    expect(p2).toBe(p1);
    const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
    expect((await store.load()).repos).toHaveLength(1);
  });

  it('does NOT touch the user source checkout (R1)', async () => {
    await ensureClone(url(), { dataPath });
    const srcStatus = execFileSync('git', ['status', '--porcelain'], { cwd: source }).toString();
    expect(srcStatus.trim()).toBe('');
  });

  it('refreshIfStale fetches only when stale and records lastFetchedAt', async () => {
    await ensureClone(url(), { dataPath });
    const t0 = new Date('2026-05-20T12:00:00.000Z');
    // never-fetched → stale → fetches
    expect(await refreshIfStale(url(), 'main', { dataPath, now: () => t0 })).toBe(true);
    // immediately after, within TTL → no fetch
    const t1 = new Date(t0.getTime() + 60_000);
    expect(await refreshIfStale(url(), 'main', { dataPath, now: () => t1 })).toBe(false);
    // far future → stale again
    const t2 = new Date(t0.getTime() + DEFAULT_CLONE_TTL_MS + 1);
    expect(await refreshIfStale(url(), 'main', { dataPath, now: () => t2 })).toBe(true);
  });

  it('createSessionWorktree makes a worktree branching from base + records state', async () => {
    const now = () => new Date('2026-05-20T12:00:00.000Z');
    const wt = await createSessionWorktree(url(), 'sess-1', 'main', 'feat/sess-1', {
      dataPath,
      now,
    });
    const clone = repoClonePath(url(), dataPath);
    expect(wt).toBe(worktreePath(clone, 'sess-1'));
    // worktree is a real checkout of the base content
    expect(await fs.readFile(join(wt, 'README.md'), 'utf8')).toBe('v1');
    // on its own branch
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: wt,
    }).toString().trim();
    expect(branch).toBe('feat/sess-1');
    // state recorded
    const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
    const entry = await store.get(clone);
    expect(entry?.lastUsedAt).toBe('2026-05-20T12:00:00.000Z');
    expect(entry?.worktrees.map((w) => w.sessionId)).toEqual(['sess-1']);
    // colocated worktree doesn't dirty the clone
    const cloneStatus = execFileSync('git', ['status', '--porcelain'], { cwd: clone }).toString();
    expect(cloneStatus.trim()).toBe('');
  });
});
