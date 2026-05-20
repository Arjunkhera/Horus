import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalRepoStateStoreManager,
  repoStatePath,
} from '../local-repo-state-store.js';

describe('repoStatePath', () => {
  it('is config/repo-state.json under the data path', () => {
    expect(repoStatePath('/d')).toBe('/d/config/repo-state.json');
  });
});

describe('LocalRepoStateStoreManager', () => {
  let dir: string;
  let store: LocalRepoStateStoreManager;
  const seed = { host: 'github.com', org: 'acme', name: 'x', clonePath: '/c/x' };

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ci3-state-'));
    store = new LocalRepoStateStoreManager(join(dir, 'repo-state.json'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns an empty store when the file is absent', async () => {
    expect(await store.load()).toEqual({ version: '1', repos: [] });
  });

  it('upsert is dedup-safe on clonePath', async () => {
    const entry = { ...seed, lastFetchedAt: null, lastUsedAt: null, worktrees: [] };
    await store.upsert(entry);
    await store.upsert({ ...entry, lastFetchedAt: '2026-01-01T00:00:00.000Z' });
    const loaded = await store.load();
    expect(loaded.repos).toHaveLength(1);
    expect(loaded.repos[0]!.lastFetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('patch creates then updates the same entry', async () => {
    await store.patch(seed, { lastFetchedAt: '2026-01-01T00:00:00.000Z' });
    await store.patch(seed, { lastUsedAt: '2026-02-02T00:00:00.000Z' });
    const e = await store.get('/c/x');
    expect(e?.lastFetchedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(e?.lastUsedAt).toBe('2026-02-02T00:00:00.000Z');
    expect((await store.load()).repos).toHaveLength(1);
  });

  it('addWorktree dedups on sessionId', async () => {
    await store.patch(seed, {});
    const wt = { sessionId: 's1', path: '/c/x/.horus/worktrees/s1', branch: 'b', createdAt: 'now' };
    await store.addWorktree('/c/x', wt);
    await store.addWorktree('/c/x', wt);
    expect((await store.get('/c/x'))?.worktrees).toHaveLength(1);
  });

  it('addWorktree throws for an unknown clone', async () => {
    await expect(
      store.addWorktree('/nope', { sessionId: 's', path: 'p', branch: 'b', createdAt: 'n' }),
    ).rejects.toThrow();
  });
});
