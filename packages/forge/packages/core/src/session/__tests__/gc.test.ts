import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  classifyWorktree,
  isCleanTree,
  getWorktreeTreeState,
  worktreeGc,
  cloneGc,
  type WorktreeTreeState,
} from '../gc.js';
import { createSessionWorktree } from '../../repo/clone-semantics.js';
import { repoClonePath } from '../../repo/clone-layout.js';
import { LocalRepoStateStoreManager, repoStatePath } from '../../repo/local-repo-state-store.js';

const CLEAN: WorktreeTreeState = { uncommitted: false, unpushed: false, stash: false, determined: true };

describe('classifyWorktree (pure — Bug J guard)', () => {
  const OLD = 365 * 86_400_000; // a year old

  it('BUG J: in-progress + dirty + very old → NOT eligible', () => {
    const r = classifyWorktree({
      status: 'in_progress',
      tree: { uncommitted: true, unpushed: true, stash: false, determined: true },
      ageMs: OLD,
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/active/);
  });

  it('age alone is never sufficient: inactive but dirty + ancient → NOT eligible', () => {
    const r = classifyWorktree({
      status: 'done',
      tree: { uncommitted: true, unpushed: false, stash: false, determined: true },
      ageMs: OLD,
    });
    expect(r.eligible).toBe(false);
  });

  it('unknown status (null) → NOT eligible (treated as unsafe)', () => {
    expect(classifyWorktree({ status: null, tree: CLEAN, ageMs: OLD }).eligible).toBe(false);
  });

  it('undetermined tree → NOT eligible', () => {
    const r = classifyWorktree({
      status: 'done',
      tree: { uncommitted: false, unpushed: false, stash: false, determined: false },
      ageMs: 0,
    });
    expect(r.eligible).toBe(false);
  });

  it('inactive + clean → eligible', () => {
    expect(classifyWorktree({ status: 'done', tree: CLEAN, ageMs: 0 }).eligible).toBe(true);
    expect(classifyWorktree({ status: 'cancelled', tree: CLEAN, ageMs: 0 }).eligible).toBe(true);
  });
});

describe('isCleanTree', () => {
  it('only clean when determined and all signals false', () => {
    expect(isCleanTree(CLEAN)).toBe(true);
    expect(isCleanTree({ ...CLEAN, unpushed: true })).toBe(false);
    expect(isCleanTree({ ...CLEAN, determined: false })).toBe(false);
  });
});

const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

describe('GC integration', () => {
  let root: string;
  let source: string;
  let dataPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'ci4-gc-'));
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

  it('getWorktreeTreeState detects clean vs dirty', async () => {
    const wt = await createSessionWorktree(source, 's1', 'main', 'feat/s1', { dataPath });
    const t1 = await getWorktreeTreeState(wt);
    expect(t1.uncommitted).toBe(false);
    await fs.writeFile(join(wt, 'README.md'), 'changed');
    const t2 = await getWorktreeTreeState(wt);
    expect(t2.uncommitted).toBe(true);
  });

  it('BUG J end-to-end: old + in-progress + dirty worktree, default call deletes NOTHING', async () => {
    const wt = await createSessionWorktree(source, 'sBugJ', 'main', 'feat/bugj', {
      dataPath,
      now: () => new Date('2020-01-01T00:00:00.000Z'), // ancient
    });
    await fs.writeFile(join(wt, 'README.md'), 'dirty'); // uncommitted

    // Default (dry-run) call, status in_progress
    const plan = await worktreeGc({
      dataPath,
      resolveStatus: async () => 'in_progress',
      now: () => new Date(),
    });

    expect(plan.applied).toBe(false);
    expect(plan.reclaimed).toHaveLength(0);
    expect(plan.retained).toHaveLength(1);
    // Worktree still on disk + still in state
    expect((await fs.stat(wt)).isDirectory()).toBe(true);
    const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
    const clone = repoClonePath(source, dataPath);
    expect((await store.get(clone))?.worktrees).toHaveLength(1);
  });

  it('even with apply:true, an active dirty worktree is NOT deleted', async () => {
    const wt = await createSessionWorktree(source, 's2', 'main', 'feat/s2', { dataPath });
    await fs.writeFile(join(wt, 'README.md'), 'dirty');
    const plan = await worktreeGc({
      dataPath,
      apply: true,
      resolveStatus: async () => 'in_progress',
    });
    expect(plan.reclaimed).toHaveLength(0);
    expect((await fs.stat(wt)).isDirectory()).toBe(true);
  });

  it('inactive worktree with UNPUSHED commits is RETAINED even with apply:true', async () => {
    const wt = await createSessionWorktree(source, 's3a', 'main', 'feat/s3a', { dataPath });
    // Commit local work that is not on the upstream → must not be destroyed.
    await fs.writeFile(join(wt, 'wip.txt'), 'unpushed work');
    execFileSync('git', [...GIT_ID, 'add', '.'], { cwd: wt });
    execFileSync('git', [...GIT_ID, 'commit', '-q', '-m', 'wip'], { cwd: wt });
    const plan = await worktreeGc({
      dataPath,
      apply: true,
      resolveStatus: async () => 'done', // inactive, but has unpushed commits
    });
    expect(plan.reclaimed).toHaveLength(0);
    expect(plan.retained[0]!.reasons.join(' ')).toMatch(/unpushed/);
    expect((await fs.stat(wt)).isDirectory()).toBe(true);
  });

  it('apply:true removes ONLY an inactive + clean (pushed) worktree', async () => {
    const wt = await createSessionWorktree(source, 's3', 'main', 'feat/s3', { dataPath });
    // Make it genuinely clean: branch pushed + upstream set, no local diff.
    execFileSync('git', ['push', '-q', '-u', 'origin', 'feat/s3'], { cwd: wt });
    const plan = await worktreeGc({
      dataPath,
      apply: true,
      resolveStatus: async () => 'done',
    });
    expect(plan.reclaimed.map((c) => c.sessionId)).toEqual(['s3']);
    await expect(fs.stat(wt)).rejects.toThrow();
    const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
    expect((await store.get(repoClonePath(source, dataPath)))?.worktrees).toHaveLength(0);
  });

  it('cloneGc never reclaims a clone with live worktrees; dry-run is default', async () => {
    await createSessionWorktree(source, 's4', 'main', 'feat/s4', { dataPath });
    const clone = repoClonePath(source, dataPath);

    const withWt = await cloneGc({ dataPath, maxIdleMs: 0, now: () => new Date(2999, 0) });
    expect(withWt.reclaimed.find((c) => c.clonePath === clone)).toBeUndefined();
    expect(withWt.applied).toBe(false);

    // Drop the worktree from state → now LRU-eligible, but default is dry-run
    const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
    await store.patch(
      { host: 'github.com', org: 'acme', name: 'widget', clonePath: clone },
      { worktrees: [], lastUsedAt: '2000-01-01T00:00:00.000Z' },
    );
    const dry = await cloneGc({ dataPath, maxIdleMs: 1000, now: () => new Date() });
    expect(dry.reclaimed.map((c) => c.clonePath)).toContain(clone);
    expect(dry.applied).toBe(false);
    expect((await fs.stat(clone)).isDirectory()).toBe(true); // not deleted (dry-run)
  });
});
