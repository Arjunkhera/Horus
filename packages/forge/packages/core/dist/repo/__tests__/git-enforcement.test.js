"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const git_enforcement_js_1 = require("../git-enforcement.js");
// ─── Fixtures ──────────────────────────────────────────────────────────────────
function ownerWorkflow(overrides = {}) {
    return {
        type: 'owner',
        pushTo: 'origin',
        prTarget: { repo: 'MyOrg/MyRepo', branch: 'main' },
        confirmedAt: '2026-01-01T00:00:00.000Z',
        confirmedBy: 'user',
        ...overrides,
    };
}
function forkWorkflow(overrides = {}) {
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
function contributorWorkflow(overrides = {}) {
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
(0, vitest_1.describe)('buildPushScript', () => {
    (0, vitest_1.it)('owner workflow: pushes to origin', () => {
        const script = (0, git_enforcement_js_1.buildPushScript)(ownerWorkflow(), 'MyRepo');
        (0, vitest_1.expect)(script).toContain('#!/bin/sh');
        (0, vitest_1.expect)(script).toContain('PUSH_REMOTE="origin"');
        (0, vitest_1.expect)(script).toContain('git push "$PUSH_REMOTE" "$CURRENT_BRANCH"');
        (0, vitest_1.expect)(script).toContain('Workflow: owner');
    });
    (0, vitest_1.it)('fork workflow: pushes to origin (the fork)', () => {
        const script = (0, git_enforcement_js_1.buildPushScript)(forkWorkflow(), 'UpstreamRepo');
        (0, vitest_1.expect)(script).toContain('PUSH_REMOTE="origin"');
        (0, vitest_1.expect)(script).toContain('Workflow: fork');
        (0, vitest_1.expect)(script).toContain('UpstreamOrg/UpstreamRepo');
    });
    (0, vitest_1.it)('contributor workflow: pushes to origin', () => {
        const script = (0, git_enforcement_js_1.buildPushScript)(contributorWorkflow(), 'SomeProject');
        (0, vitest_1.expect)(script).toContain('PUSH_REMOTE="origin"');
        (0, vitest_1.expect)(script).toContain('Workflow: contributor');
    });
    (0, vitest_1.it)('custom pushTo remote is used', () => {
        const wf = ownerWorkflow({ pushTo: 'myremote' });
        const script = (0, git_enforcement_js_1.buildPushScript)(wf, 'MyRepo');
        (0, vitest_1.expect)(script).toContain('PUSH_REMOTE="myremote"');
    });
    (0, vitest_1.it)('passes extra args to git push', () => {
        const script = (0, git_enforcement_js_1.buildPushScript)(ownerWorkflow(), 'MyRepo');
        // The "$@" forwards extra args (e.g., --force-with-lease)
        (0, vitest_1.expect)(script).toContain('"$@"');
    });
    (0, vitest_1.it)('exits on error (set -e)', () => {
        const script = (0, git_enforcement_js_1.buildPushScript)(ownerWorkflow(), 'MyRepo');
        (0, vitest_1.expect)(script).toContain('set -e');
    });
    (0, vitest_1.it)('guards against detached HEAD', () => {
        const script = (0, git_enforcement_js_1.buildPushScript)(ownerWorkflow(), 'MyRepo');
        (0, vitest_1.expect)(script).toContain('detached HEAD');
        (0, vitest_1.expect)(script).toContain('exit 1');
    });
});
// ─── create-pr.sh tests ───────────────────────────────────────────────────────
(0, vitest_1.describe)('buildCreatePrScript', () => {
    (0, vitest_1.it)('owner workflow: creates PR in same repo', () => {
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(ownerWorkflow(), 'MyRepo');
        (0, vitest_1.expect)(script).toContain('#!/bin/sh');
        (0, vitest_1.expect)(script).toContain('gh pr create --base "main"');
        // Should NOT include --repo (stays in same repo)
        (0, vitest_1.expect)(script).not.toContain('--repo');
        // Should NOT include --head (not a fork)
        (0, vitest_1.expect)(script).not.toContain('--head');
    });
    (0, vitest_1.it)('owner workflow: uses correct base branch', () => {
        const wf = ownerWorkflow({ prTarget: { repo: 'MyOrg/MyRepo', branch: 'develop' } });
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(wf, 'MyRepo');
        (0, vitest_1.expect)(script).toContain('--base "develop"');
    });
    (0, vitest_1.it)('fork workflow: targets upstream repo with --repo and --head', () => {
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(forkWorkflow(), 'UpstreamRepo');
        (0, vitest_1.expect)(script).toContain('--repo "UpstreamOrg/UpstreamRepo"');
        (0, vitest_1.expect)(script).toContain('--base "main"');
        (0, vitest_1.expect)(script).toContain('--head "$FORK_OWNER:$CURRENT_BRANCH"');
    });
    (0, vitest_1.it)('fork workflow: derives fork owner from remote URL', () => {
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(forkWorkflow(), 'UpstreamRepo');
        // Script should contain the sed command to extract owner from URL
        (0, vitest_1.expect)(script).toContain('git remote get-url origin');
        (0, vitest_1.expect)(script).toContain('FORK_OWNER');
    });
    (0, vitest_1.it)('fork workflow: handles failure to get fork owner gracefully', () => {
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(forkWorkflow(), 'UpstreamRepo');
        (0, vitest_1.expect)(script).toContain('Could not determine fork owner');
        // Falls back to gh pr create without --head
        (0, vitest_1.expect)(script).toContain('exec gh pr create --repo');
    });
    (0, vitest_1.it)('contributor workflow: creates PR in same repo (no fork redirect)', () => {
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(contributorWorkflow(), 'SomeProject');
        (0, vitest_1.expect)(script).toContain('gh pr create --base "develop"');
        (0, vitest_1.expect)(script).not.toContain('--repo');
        (0, vitest_1.expect)(script).not.toContain('--head');
    });
    (0, vitest_1.it)('all workflows: forward extra args via $@', () => {
        for (const wf of [ownerWorkflow(), forkWorkflow(), contributorWorkflow()]) {
            const script = (0, git_enforcement_js_1.buildCreatePrScript)(wf, 'Repo');
            (0, vitest_1.expect)(script).toContain('"$@"');
        }
    });
    (0, vitest_1.it)('includes set -e', () => {
        const script = (0, git_enforcement_js_1.buildCreatePrScript)(ownerWorkflow(), 'MyRepo');
        (0, vitest_1.expect)(script).toContain('set -e');
    });
});
// ─── pre-push hook tests ──────────────────────────────────────────────────────
(0, vitest_1.describe)('buildPrePushHook', () => {
    (0, vitest_1.it)('rejects push to wrong remote', () => {
        const hook = (0, git_enforcement_js_1.buildPrePushHook)(ownerWorkflow(), 'MyRepo');
        (0, vitest_1.expect)(hook).toContain('#!/bin/sh');
        (0, vitest_1.expect)(hook).toContain('EXPECTED_REMOTE="origin"');
        (0, vitest_1.expect)(hook).toContain('exit 1');
        (0, vitest_1.expect)(hook).toContain('REJECTED');
    });
    (0, vitest_1.it)('allows push to correct remote', () => {
        const hook = (0, git_enforcement_js_1.buildPrePushHook)(ownerWorkflow(), 'MyRepo');
        // When REMOTE == EXPECTED_REMOTE, exits 0
        (0, vitest_1.expect)(hook).toContain('exit 0');
    });
    (0, vitest_1.it)('includes clear error message with the allowed remote', () => {
        const hook = (0, git_enforcement_js_1.buildPrePushHook)(ownerWorkflow({ pushTo: 'origin' }), 'MyRepo');
        // Hook uses $EXPECTED_REMOTE shell variable in the error message
        (0, vitest_1.expect)(hook).toContain('git push $EXPECTED_REMOTE <branch>');
        (0, vitest_1.expect)(hook).toContain('.forge/scripts/push.sh');
    });
    (0, vitest_1.it)('custom pushTo: enforces the correct remote', () => {
        const hook = (0, git_enforcement_js_1.buildPrePushHook)(ownerWorkflow({ pushTo: 'myremote' }), 'MyRepo');
        (0, vitest_1.expect)(hook).toContain('EXPECTED_REMOTE="myremote"');
        // Error message uses the shell variable, not the literal value
        (0, vitest_1.expect)(hook).toContain('git push $EXPECTED_REMOTE <branch>');
    });
    (0, vitest_1.it)('fork workflow: enforces origin (not upstream)', () => {
        const hook = (0, git_enforcement_js_1.buildPrePushHook)(forkWorkflow(), 'UpstreamRepo');
        (0, vitest_1.expect)(hook).toContain('EXPECTED_REMOTE="origin"');
        // Explains the fork workflow
        (0, vitest_1.expect)(hook).toContain("Workflow 'fork'");
    });
    (0, vitest_1.it)('includes repo name in generated comment header', () => {
        const hook = (0, git_enforcement_js_1.buildPrePushHook)(ownerWorkflow(), 'SomeSpecificRepo');
        (0, vitest_1.expect)(hook).toContain('SomeSpecificRepo');
    });
});
// ─── commit-msg hook tests ────────────────────────────────────────────────────
(0, vitest_1.describe)('buildCommitMsgHook', () => {
    (0, vitest_1.describe)('when commitFormat is "conventional"', () => {
        const wf = ownerWorkflow({ commitFormat: 'conventional' });
        (0, vitest_1.it)('returns executable hook content', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('#!/bin/sh');
        });
        (0, vitest_1.it)('validates valid conventional commit types', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert');
        });
        (0, vitest_1.it)('rejects non-conforming messages with clear error', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('REJECTED');
            (0, vitest_1.expect)(hook).toContain('exit 1');
            (0, vitest_1.expect)(hook).toContain('Conventional Commits');
        });
        (0, vitest_1.it)('skips merge commits', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('Merge*');
        });
        (0, vitest_1.it)('skips fixup commits', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('fixup!*');
        });
        (0, vitest_1.it)('accepts scope notation in pattern', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            // Scope is optional: type(scope): or type:
            (0, vitest_1.expect)(hook).toContain('(\\([^)]+\\))?');
        });
        (0, vitest_1.it)('accepts breaking change notation', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            // Breaking change marker: type!: description
            (0, vitest_1.expect)(hook).toContain('!?:');
        });
        (0, vitest_1.it)('includes examples in the error message', () => {
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('feat(forge):');
            (0, vitest_1.expect)(hook).toContain('fix:');
        });
    });
    (0, vitest_1.describe)('when commitFormat is not "conventional"', () => {
        (0, vitest_1.it)('returns no-op hook when commitFormat is undefined', () => {
            const wf = ownerWorkflow({ commitFormat: undefined });
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('exit 0');
            (0, vitest_1.expect)(hook).not.toContain('REJECTED');
            (0, vitest_1.expect)(hook).not.toContain('conventional');
        });
        (0, vitest_1.it)('returns no-op hook when commitFormat is a different value', () => {
            const wf = ownerWorkflow({ commitFormat: 'freeform' });
            const hook = (0, git_enforcement_js_1.buildCommitMsgHook)(wf, 'MyRepo');
            (0, vitest_1.expect)(hook).toContain('exit 0');
            (0, vitest_1.expect)(hook).not.toContain('REJECTED');
        });
    });
});
// ─── installEnforcementHooks integration tests ───────────────────────────────
(0, vitest_1.describe)('installEnforcementHooks', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-hooks-test-'));
        // Create the minimal directory structure a worktree would have
        await fs_1.promises.mkdir(path_1.default.join(tmpDir, '.git', 'hooks'), { recursive: true });
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    // ─── Writes all files ────────────────────────────────────────────────────
    (0, vitest_1.it)('installs all 4 files for owner workflow', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow(), 'TestRepo', tmpDir);
        const hookFiles = ['pre-push', 'commit-msg'];
        for (const f of hookFiles) {
            const content = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.git', 'hooks', f), 'utf8');
            (0, vitest_1.expect)(content).toBeTruthy();
        }
        const scriptFiles = ['push.sh', 'create-pr.sh'];
        for (const f of scriptFiles) {
            const content = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.forge', 'scripts', f), 'utf8');
            (0, vitest_1.expect)(content).toBeTruthy();
        }
    });
    (0, vitest_1.it)('creates .forge/scripts directory if not present', async () => {
        // No pre-created .forge directory
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow(), 'TestRepo', tmpDir);
        const stat = await fs_1.promises.stat(path_1.default.join(tmpDir, '.forge', 'scripts'));
        (0, vitest_1.expect)(stat.isDirectory()).toBe(true);
    });
    // ─── Correct content per workflow ────────────────────────────────────────
    (0, vitest_1.it)('owner workflow: push.sh targets origin', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow(), 'TestRepo', tmpDir);
        const push = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.forge', 'scripts', 'push.sh'), 'utf8');
        (0, vitest_1.expect)(push).toContain('PUSH_REMOTE="origin"');
    });
    (0, vitest_1.it)('fork workflow: create-pr.sh includes --repo and --head', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, forkWorkflow(), 'UpstreamRepo', tmpDir);
        const pr = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.forge', 'scripts', 'create-pr.sh'), 'utf8');
        (0, vitest_1.expect)(pr).toContain('--repo "UpstreamOrg/UpstreamRepo"');
        (0, vitest_1.expect)(pr).toContain('--head');
    });
    (0, vitest_1.it)('contributor workflow: create-pr.sh targets correct base branch', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, contributorWorkflow(), 'SomeProject', tmpDir);
        const pr = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.forge', 'scripts', 'create-pr.sh'), 'utf8');
        (0, vitest_1.expect)(pr).toContain('--base "develop"');
        (0, vitest_1.expect)(pr).not.toContain('--repo');
    });
    (0, vitest_1.it)('pre-push hook enforces pushTo remote', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow({ pushTo: 'myremote' }), 'TestRepo', tmpDir);
        const hook = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.git', 'hooks', 'pre-push'), 'utf8');
        (0, vitest_1.expect)(hook).toContain('EXPECTED_REMOTE="myremote"');
    });
    (0, vitest_1.it)('commit-msg hook enforces conventional commits when configured', async () => {
        const wf = ownerWorkflow({ commitFormat: 'conventional' });
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, wf, 'TestRepo', tmpDir);
        const hook = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.git', 'hooks', 'commit-msg'), 'utf8');
        (0, vitest_1.expect)(hook).toContain('REJECTED');
        (0, vitest_1.expect)(hook).toContain('feat|fix|');
    });
    (0, vitest_1.it)('commit-msg hook is no-op when commitFormat is not set', async () => {
        const wf = ownerWorkflow({ commitFormat: undefined });
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, wf, 'TestRepo', tmpDir);
        const hook = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.git', 'hooks', 'commit-msg'), 'utf8');
        (0, vitest_1.expect)(hook).not.toContain('REJECTED');
        (0, vitest_1.expect)(hook).toContain('exit 0');
    });
    // ─── Null workflow → placeholders ────────────────────────────────────────
    (0, vitest_1.it)('installs no-op placeholders when workflow is null', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, null, 'TestRepo', tmpDir);
        const hookNames = ['pre-push', 'commit-msg'];
        for (const f of hookNames) {
            const content = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.git', 'hooks', f), 'utf8');
            (0, vitest_1.expect)(content).toContain('exit 0');
            (0, vitest_1.expect)(content).not.toContain('REJECTED');
        }
        const scriptNames = ['push.sh', 'create-pr.sh'];
        for (const f of scriptNames) {
            const content = await fs_1.promises.readFile(path_1.default.join(tmpDir, '.forge', 'scripts', f), 'utf8');
            (0, vitest_1.expect)(content).toContain('exit 0');
        }
    });
    // ─── File permissions ────────────────────────────────────────────────────
    (0, vitest_1.it)('all hooks and scripts are executable (mode 0o755)', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow(), 'TestRepo', tmpDir);
        const files = [
            path_1.default.join(tmpDir, '.git', 'hooks', 'pre-push'),
            path_1.default.join(tmpDir, '.git', 'hooks', 'commit-msg'),
            path_1.default.join(tmpDir, '.forge', 'scripts', 'push.sh'),
            path_1.default.join(tmpDir, '.forge', 'scripts', 'create-pr.sh'),
        ];
        for (const f of files) {
            const stat = await fs_1.promises.stat(f);
            // mode & 0o777 to isolate permission bits
            const perms = stat.mode & 0o777;
            (0, vitest_1.expect)(perms).toBe(0o755);
        }
    });
    // ─── Idempotency ─────────────────────────────────────────────────────────
    (0, vitest_1.it)('can be called twice without error (idempotent)', async () => {
        await (0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow(), 'TestRepo', tmpDir);
        await (0, vitest_1.expect)((0, git_enforcement_js_1.installEnforcementHooks)(tmpDir, ownerWorkflow(), 'TestRepo', tmpDir)).resolves.toBeUndefined();
    });
});
//# sourceMappingURL=git-enforcement.test.js.map