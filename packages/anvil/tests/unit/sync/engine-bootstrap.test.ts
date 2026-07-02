// Unit tests for GitSyncEngine bootstrap self-heal.
//
// Regression coverage for the "daemon alive but never pushes" bug: a repo whose
// initial clone failed (network down) or that was freshly `git init`ed has a
// .git directory but no HEAD commit and no upstream. The engine must:
//   1. self-heal by creating an initial commit (born branch),
//   2. record lastPushAttempt so the stuck state is diagnosable (never silent
//      null forever),
//   3. push to the remote, setting upstream on the first push.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { mkdtemp } from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { execSync } from 'child_process';
import { GitSyncEngine } from '../../../src/core/sync/engine.js';
import { repoHasCommit } from '../../../src/sync/git-sync.js';
import type { AnvilWatcher } from '../../../src/storage/watcher.js';

const mkdtempAsync = promisify(mkdtemp);

function makeStubWatcher(): AnvilWatcher {
  return {
    addBatchCompleteListener() {},
    waitForBatch: async () => {},
  } as unknown as AnvilWatcher;
}

/** Create a bare repo to act as `origin`. */
function initBareRemote(dir: string): void {
  execSync('git init --bare -b master', { cwd: dir });
}

/** Init a working repo with NO commit (unborn branch), origin pointed at remote. */
function initUnbornClone(dir: string, remote: string): void {
  execSync('git init -b master', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  execSync(`git remote add origin "${remote}"`, { cwd: dir });
}

describe('GitSyncEngine bootstrap self-heal', () => {
  let workDir: string;
  let remoteDir: string;
  let engine: GitSyncEngine | null;

  beforeEach(async () => {
    workDir = await mkdtempAsync(join(tmpdir(), 'anvil-engine-work-'));
    remoteDir = await mkdtempAsync(join(tmpdir(), 'anvil-engine-remote-'));
    engine = null;
  });

  afterEach(async () => {
    if (engine) {
      try {
        await engine.stop();
      } catch {
        /* ignore */
      }
    }
    for (const d of [workDir, remoteDir]) {
      try {
        await fs.rm(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('creates an initial commit for an unborn repo so it becomes push-ready', async () => {
    initBareRemote(remoteDir);
    initUnbornClone(workDir, remoteDir);

    // Precondition: this is exactly the stuck state — .git exists, no HEAD.
    expect(await repoHasCommit(workDir)).toBe(false);

    // A local note exists but the branch is unborn.
    await fs.writeFile(join(workDir, 'note.md'), '# Note');

    engine = new GitSyncEngine({
      notesPath: workDir,
      watcher: makeStubWatcher(),
      pushDebounceMs: 10,
      pullIntervalMs: 5_000,
    });

    const result = await engine.push();

    // The repo now has a real HEAD — the branch was born.
    expect(await repoHasCommit(workDir)).toBe(true);
    expect(['ok', 'push_failed']).toContain(result.status);
  });

  it('records lastPushAttempt even on the very first push (diagnosable, not silent null)', async () => {
    initBareRemote(remoteDir);
    initUnbornClone(workDir, remoteDir);
    await fs.writeFile(join(workDir, 'note.md'), '# Note');

    engine = new GitSyncEngine({
      notesPath: workDir,
      watcher: makeStubWatcher(),
      pushDebounceMs: 10,
      pullIntervalMs: 5_000,
    });

    // Before the bug fix, lastPushAttempt stayed null forever in this state.
    expect(engine.getHealth().lastPushAttempt).toBeNull();

    await engine.push();

    expect(engine.getHealth().lastPushAttempt).not.toBeNull();
  });

  it('pushes the bootstrap commit to the remote and sets upstream', async () => {
    initBareRemote(remoteDir);
    initUnbornClone(workDir, remoteDir);
    await fs.writeFile(join(workDir, 'note.md'), '# Note');

    engine = new GitSyncEngine({
      notesPath: workDir,
      watcher: makeStubWatcher(),
      pushDebounceMs: 10,
      pullIntervalMs: 5_000,
    });

    const result = await engine.push();
    expect(result.status).toBe('ok');
    expect(engine.getHealth().lastPushSuccess).not.toBeNull();

    // The remote received the commit (branch master now exists on origin).
    const remoteBranches = execSync('git branch', { cwd: remoteDir })
      .toString();
    expect(remoteBranches).toContain('master');

    // Upstream tracking was established on the working clone.
    const tracking = execSync(
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
      { cwd: workDir },
    ).toString();
    expect(tracking.trim()).toBe('origin/master');
  });

  it('is a no-op self-heal when the repo already has commits', async () => {
    initBareRemote(remoteDir);
    initUnbornClone(workDir, remoteDir);
    // Give it a real first commit up front.
    execSync('touch .gitkeep', { cwd: workDir });
    execSync('git add .gitkeep', { cwd: workDir });
    execSync('git commit -m "Initial commit"', { cwd: workDir });
    execSync('git push -u origin master', { cwd: workDir });

    const headBefore = execSync('git rev-parse HEAD', { cwd: workDir })
      .toString()
      .trim();

    await fs.writeFile(join(workDir, 'note.md'), '# Note');

    engine = new GitSyncEngine({
      notesPath: workDir,
      watcher: makeStubWatcher(),
      pushDebounceMs: 10,
      pullIntervalMs: 5_000,
    });

    const result = await engine.push();
    expect(result.status).toBe('ok');

    // No spurious extra "bootstrap" commit was inserted before our note commit;
    // the parent of HEAD is still the original initial commit.
    const parentOfHead = execSync('git rev-parse HEAD~1', { cwd: workDir })
      .toString()
      .trim();
    expect(parentOfHead).toBe(headBefore);
  });
});
