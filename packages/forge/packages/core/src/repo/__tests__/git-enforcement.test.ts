import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  buildPushScript,
  buildCreatePrScript,
  buildPrePushHook,
  buildCommitMsgHook,
  installEnforcementHooks,
} from '../git-enforcement.js';
import type { RepoIndexWorkflow } from '../../models/repo-index.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function ownerWorkflow(overrides: Partial<RepoIndexWorkflow> = {}): RepoIndexWorkflow {
  return {
    type: 'owner',
    pushTo: 'origin',
    prTarget: { repo: 'MyOrg/MyRepo', branch: 'main' },
    confirmedAt: '2026-01-01T00:00:00.000Z',
    confirmedBy: 'user',
    ...overrides,
  };
}

function forkWorkflow(overrides: Partial<RepoIndexWorkflow> = {}): RepoIndexWorkflow {
  return {
    type: 'fork',
    upstream: 'git@github.com:UpstreamOrg/UpstreamRepo.git',
    fork: 'git@github.com:myuser/UpstreamRepo.git',
    pushTo: 'origin',
    prTarget: { repo: 'UpstreamOrg/UpstreamRepo', branch: 'main' },
    confirmedAt: '2026-01-01T00:00:00.000Z',
    confirmedBy: 'user',
    ...overrides,
  };
}

function contributorWorkflow(overrides: Partial<RepoIndexWorkflow> = {}): RepoIndexWorkflow {
  return {
    type: 'contributor',
    pushTo: 'origin',
    prTarget: { repo: 'SomeOrg/SomeProject', branch: 'develop' },
    confirmedAt: '2026-01-01T00:00:00.000Z',
    confirmedBy: 'user',
    ...overrides,
  };
}

// ─── push.sh tests ────────────────────────────────────────────────────────────

describe('buildPushScript', () => {
  it('owner workflow: pushes to origin', () => {
    const script = buildPushScript(ownerWorkflow(), 'MyRepo');
    expect(script).toContain('#!/bin/sh');
    expect(script).toContain('PUSH_REMOTE="origin"');
    expect(script).toContain('git push "$PUSH_REMOTE" "$CURRENT_BRANCH"');
    expect(script).toContain('Workflow: owner');
  });

  it('fork workflow: pushes to origin (the fork)', () => {
    const script = buildPushScript(forkWorkflow(), 'UpstreamRepo');
    expect(script).toContain('PUSH_REMOTE="origin"');
    expect(script).toContain('Workflow: fork');
    expect(script).toContain('UpstreamOrg/UpstreamRepo');
  });

  it('contributor workflow: pushes to origin', () => {
    const script = buildPushScript(contributorWorkflow(), 'SomeProject');
    expect(script).toContain('PUSH_REMOTE="origin"');
    expect(script).toContain('Workflow: contributor');
  });

  it('custom pushTo remote is used', () => {
    const wf = ownerWorkflow({ pushTo: 'myremote' });
    const script = buildPushScript(wf, 'MyRepo');
    expect(script).toContain('PUSH_REMOTE="myremote"');
  });

  it('passes extra args to git push', () => {
    const script = buildPushScript(ownerWorkflow(), 'MyRepo');
    // The "$@" forwards extra args (e.g., --force-with-lease)
    expect(script).toContain('"$@"');
  });

  it('exits on error (set -e)', () => {
    const script = buildPushScript(ownerWorkflow(), 'MyRepo');
    expect(script).toContain('set -e');
  });

  it('guards against detached HEAD', () => {
    const script = buildPushScript(ownerWorkflow(), 'MyRepo');
    expect(script).toContain('detached HEAD');
    expect(script).toContain('exit 1');
  });
});

// ─── create-pr.sh tests ───────────────────────────────────────────────────────

describe('buildCreatePrScript', () => {
  it('owner workflow: creates PR in same repo', () => {
    const script = buildCreatePrScript(ownerWorkflow(), 'MyRepo');
    expect(script).toContain('#!/bin/sh');
    expect(script).toContain('gh pr create --base "main"');
    // Should NOT include --repo (stays in same repo)
    expect(script).not.toContain('--repo');
    // Should NOT include --head (not a fork)
    expect(script).not.toContain('--head');
  });

  it('owner workflow: uses correct base branch', () => {
    const wf = ownerWorkflow({ prTarget: { repo: 'MyOrg/MyRepo', branch: 'develop' } });
    const script = buildCreatePrScript(wf, 'MyRepo');
    expect(script).toContain('--base "develop"');
  });

  it('fork workflow: targets upstream repo with --repo and --head', () => {
    const script = buildCreatePrScript(forkWorkflow(), 'UpstreamRepo');
    expect(script).toContain('--repo "UpstreamOrg/UpstreamRepo"');
    expect(script).toContain('--base "main"');
    expect(script).toContain('--head "$FORK_OWNER:$CURRENT_BRANCH"');
  });

  it('fork workflow: derives fork owner from remote URL', () => {
    const script = buildCreatePrScript(forkWorkflow(), 'UpstreamRepo');
    // Script should contain the sed command to extract owner from URL
    expect(script).toContain('git remote get-url origin');
    expect(script).toContain('FORK_OWNER');
  });

  it('fork workflow: handles failure to get fork owner gracefully', () => {
    const script = buildCreatePrScript(forkWorkflow(), 'UpstreamRepo');
    expect(script).toContain('Could not determine fork owner');
    // Falls back to gh pr create without --head
    expect(script).toContain('exec gh pr create --repo');
  });

  it('contributor workflow: creates PR in same repo (no fork redirect)', () => {
    const script = buildCreatePrScript(contributorWorkflow(), 'SomeProject');
    expect(script).toContain('gh pr create --base "develop"');
    expect(script).not.toContain('--repo');
    expect(script).not.toContain('--head');
  });

  it('all workflows: forward extra args via $@', () => {
    for (const wf of [ownerWorkflow(), forkWorkflow(), contributorWorkflow()]) {
      const script = buildCreatePrScript(wf, 'Repo');
      expect(script).toContain('"$@"');
    }
  });

  it('includes set -e', () => {
    const script = buildCreatePrScript(ownerWorkflow(), 'MyRepo');
    expect(script).toContain('set -e');
  });
});

// ─── pre-push hook tests ──────────────────────────────────────────────────────

describe('buildPrePushHook', () => {
  it('rejects push to wrong remote', () => {
    const hook = buildPrePushHook(ownerWorkflow(), 'MyRepo');
    expect(hook).toContain('#!/bin/sh');
    expect(hook).toContain('EXPECTED_REMOTE="origin"');
    expect(hook).toContain('exit 1');
    expect(hook).toContain('REJECTED');
  });

  it('allows push to correct remote', () => {
    const hook = buildPrePushHook(ownerWorkflow(), 'MyRepo');
    // When REMOTE == EXPECTED_REMOTE, exits 0
    expect(hook).toContain('exit 0');
  });

  it('includes clear error message with the allowed remote', () => {
    const hook = buildPrePushHook(ownerWorkflow({ pushTo: 'origin' }), 'MyRepo');
    // Hook uses $EXPECTED_REMOTE shell variable in the error message
    expect(hook).toContain('git push $EXPECTED_REMOTE <branch>');
    expect(hook).toContain('.forge/scripts/push.sh');
  });

  it('custom pushTo: enforces the correct remote', () => {
    const hook = buildPrePushHook(ownerWorkflow({ pushTo: 'myremote' }), 'MyRepo');
    expect(hook).toContain('EXPECTED_REMOTE="myremote"');
    // Error message uses the shell variable, not the literal value
    expect(hook).toContain('git push $EXPECTED_REMOTE <branch>');
  });

  it('fork workflow: enforces origin (not upstream)', () => {
    const hook = buildPrePushHook(forkWorkflow(), 'UpstreamRepo');
    expect(hook).toContain('EXPECTED_REMOTE="origin"');
    // Explains the fork workflow
    expect(hook).toContain("Workflow 'fork'");
  });

  it('includes repo name in generated comment header', () => {
    const hook = buildPrePushHook(ownerWorkflow(), 'SomeSpecificRepo');
    expect(hook).toContain('SomeSpecificRepo');
  });
});

// ─── commit-msg hook tests ────────────────────────────────────────────────────

describe('buildCommitMsgHook', () => {
  describe('when commitFormat is "conventional"', () => {
    const wf = ownerWorkflow({ commitFormat: 'conventional' });

    it('returns executable hook content', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('#!/bin/sh');
    });

    it('validates valid conventional commit types', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert');
    });

    it('rejects non-conforming messages with clear error', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('REJECTED');
      expect(hook).toContain('exit 1');
      expect(hook).toContain('Conventional Commits');
    });

    it('skips merge commits', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('Merge*');
    });

    it('skips fixup commits', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('fixup!*');
    });

    it('accepts scope notation in pattern', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      // Scope is optional: type(scope): or type:
      expect(hook).toContain('(\\([^)]+\\))?');
    });

    it('accepts breaking change notation', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      // Breaking change marker: type!: description
      expect(hook).toContain('!?:');
    });

    it('includes examples in the error message', () => {
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('feat(forge):');
      expect(hook).toContain('fix:');
    });
  });

  describe('when commitFormat is not "conventional"', () => {
    it('returns no-op hook when commitFormat is undefined', () => {
      const wf = ownerWorkflow({ commitFormat: undefined });
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('exit 0');
      expect(hook).not.toContain('REJECTED');
      expect(hook).not.toContain('conventional');
    });

    it('returns no-op hook when commitFormat is a different value', () => {
      const wf = ownerWorkflow({ commitFormat: 'freeform' });
      const hook = buildCommitMsgHook(wf, 'MyRepo');
      expect(hook).toContain('exit 0');
      expect(hook).not.toContain('REJECTED');
    });
  });
});

// ─── installEnforcementHooks integration tests ───────────────────────────────

describe('installEnforcementHooks', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-hooks-test-'));
    // Create the minimal directory structure a worktree would have
    await fs.mkdir(path.join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Writes all files ────────────────────────────────────────────────────

  it('installs all 4 files for owner workflow', async () => {
    await installEnforcementHooks(tmpDir, ownerWorkflow(), 'TestRepo');

    const hookFiles = ['pre-push', 'commit-msg'];
    for (const f of hookFiles) {
      const content = await fs.readFile(path.join(tmpDir, '.git', 'hooks', f), 'utf8');
      expect(content).toBeTruthy();
    }

    const scriptFiles = ['push.sh', 'create-pr.sh'];
    for (const f of scriptFiles) {
      const content = await fs.readFile(path.join(tmpDir, '.forge', 'scripts', f), 'utf8');
      expect(content).toBeTruthy();
    }
  });

  it('creates .forge/scripts directory if not present', async () => {
    // No pre-created .forge directory
    await installEnforcementHooks(tmpDir, ownerWorkflow(), 'TestRepo');
    const stat = await fs.stat(path.join(tmpDir, '.forge', 'scripts'));
    expect(stat.isDirectory()).toBe(true);
  });

  // ─── Correct content per workflow ────────────────────────────────────────

  it('owner workflow: push.sh targets origin', async () => {
    await installEnforcementHooks(tmpDir, ownerWorkflow(), 'TestRepo');
    const push = await fs.readFile(path.join(tmpDir, '.forge', 'scripts', 'push.sh'), 'utf8');
    expect(push).toContain('PUSH_REMOTE="origin"');
  });

  it('fork workflow: create-pr.sh includes --repo and --head', async () => {
    await installEnforcementHooks(tmpDir, forkWorkflow(), 'UpstreamRepo');
    const pr = await fs.readFile(path.join(tmpDir, '.forge', 'scripts', 'create-pr.sh'), 'utf8');
    expect(pr).toContain('--repo "UpstreamOrg/UpstreamRepo"');
    expect(pr).toContain('--head');
  });

  it('contributor workflow: create-pr.sh targets correct base branch', async () => {
    await installEnforcementHooks(tmpDir, contributorWorkflow(), 'SomeProject');
    const pr = await fs.readFile(path.join(tmpDir, '.forge', 'scripts', 'create-pr.sh'), 'utf8');
    expect(pr).toContain('--base "develop"');
    expect(pr).not.toContain('--repo');
  });

  it('pre-push hook enforces pushTo remote', async () => {
    await installEnforcementHooks(tmpDir, ownerWorkflow({ pushTo: 'myremote' }), 'TestRepo');
    const hook = await fs.readFile(path.join(tmpDir, '.git', 'hooks', 'pre-push'), 'utf8');
    expect(hook).toContain('EXPECTED_REMOTE="myremote"');
  });

  it('commit-msg hook enforces conventional commits when configured', async () => {
    const wf = ownerWorkflow({ commitFormat: 'conventional' });
    await installEnforcementHooks(tmpDir, wf, 'TestRepo');
    const hook = await fs.readFile(path.join(tmpDir, '.git', 'hooks', 'commit-msg'), 'utf8');
    expect(hook).toContain('REJECTED');
    expect(hook).toContain('feat|fix|');
  });

  it('commit-msg hook is no-op when commitFormat is not set', async () => {
    const wf = ownerWorkflow({ commitFormat: undefined });
    await installEnforcementHooks(tmpDir, wf, 'TestRepo');
    const hook = await fs.readFile(path.join(tmpDir, '.git', 'hooks', 'commit-msg'), 'utf8');
    expect(hook).not.toContain('REJECTED');
    expect(hook).toContain('exit 0');
  });

  // ─── Null workflow → placeholders ────────────────────────────────────────

  it('installs no-op placeholders when workflow is null', async () => {
    await installEnforcementHooks(tmpDir, null, 'TestRepo');

    const hookNames = ['pre-push', 'commit-msg'];
    for (const f of hookNames) {
      const content = await fs.readFile(path.join(tmpDir, '.git', 'hooks', f), 'utf8');
      expect(content).toContain('exit 0');
      expect(content).not.toContain('REJECTED');
    }

    const scriptNames = ['push.sh', 'create-pr.sh'];
    for (const f of scriptNames) {
      const content = await fs.readFile(path.join(tmpDir, '.forge', 'scripts', f), 'utf8');
      expect(content).toContain('exit 0');
    }
  });

  // ─── File permissions ────────────────────────────────────────────────────

  it('all hooks and scripts are executable (mode 0o755)', async () => {
    await installEnforcementHooks(tmpDir, ownerWorkflow(), 'TestRepo');

    const files = [
      path.join(tmpDir, '.git', 'hooks', 'pre-push'),
      path.join(tmpDir, '.git', 'hooks', 'commit-msg'),
      path.join(tmpDir, '.forge', 'scripts', 'push.sh'),
      path.join(tmpDir, '.forge', 'scripts', 'create-pr.sh'),
    ];

    for (const f of files) {
      const stat = await fs.stat(f);
      // mode & 0o777 to isolate permission bits
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o755);
    }
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────

  it('can be called twice without error (idempotent)', async () => {
    await installEnforcementHooks(tmpDir, ownerWorkflow(), 'TestRepo');
    await expect(
      installEnforcementHooks(tmpDir, ownerWorkflow(), 'TestRepo'),
    ).resolves.toBeUndefined();
  });
});
