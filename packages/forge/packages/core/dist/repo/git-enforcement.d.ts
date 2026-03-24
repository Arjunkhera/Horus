import type { RepoIndexWorkflow } from '../models/repo-index.js';
/**
 * Generate the content of push.sh for a given worktree session.
 *
 * push.sh reads workflow metadata from HORUS_DATA_PATH/config/repos.json to
 * determine the correct `git push` target. It accepts optional extra args
 * (e.g., --force-with-lease) forwarded to git.
 *
 * Workflow mapping:
 *   owner       → git push origin <branch>
 *   fork        → git push origin <branch>  (origin = the user's fork)
 *   contributor → git push origin <branch>
 *
 * All three types push to `pushTo` (always "origin" by convention). The
 * distinction matters for create-pr.sh, not for the push target itself.
 */
export declare function buildPushScript(workflow: RepoIndexWorkflow, repoName: string): string;
/**
 * Generate the content of create-pr.sh for a given worktree session.
 *
 * create-pr.sh constructs the correct `gh pr create` invocation based on
 * workflow type:
 *
 *   owner / contributor → gh pr create --base <prTarget.branch>
 *   fork                → gh pr create --repo <prTarget.repo> --base <prTarget.branch>
 *                                       --head <fork-owner>:<branch>
 *
 * Usage: ./create-pr.sh --title "..." --body "..."
 *        (all args forwarded to gh pr create)
 */
export declare function buildCreatePrScript(workflow: RepoIndexWorkflow, repoName: string): string;
/**
 * Generate the content of the pre-push git hook.
 *
 * Validates that the push target remote matches workflow.pushTo.
 * If the agent tries to push to the wrong remote (e.g., directly to
 * upstream instead of origin on a fork workflow), the hook rejects it
 * with a clear error message.
 *
 * pre-push receives: <remote-name> <remote-url> on stdin line pairs
 * The remote name is passed as $1 by git.
 */
export declare function buildPrePushHook(workflow: RepoIndexWorkflow, repoName: string): string;
/**
 * Generate the content of the commit-msg git hook.
 *
 * If workflow.commitFormat === "conventional", validates that the commit
 * message follows the Conventional Commits spec:
 *   <type>(<scope>): <description>
 *   where type ∈ {feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert}
 *
 * If commitFormat is not set or is not "conventional", the hook is a no-op.
 *
 * The commit message file path is passed as $1 by git.
 */
export declare function buildCommitMsgHook(workflow: RepoIndexWorkflow, repoName: string): string;
/**
 * Install enforcement scripts and hooks into a worktree session.
 *
 * Scripts go to: <sessionPath>/.forge/scripts/
 *   - push.sh
 *   - create-pr.sh
 *
 * Hooks go to: <worktreeBasePath>/.git/hooks/
 *   - pre-push
 *   - commit-msg
 *
 * `worktreeBasePath` is the base repo (managed clone), whose `.git` is a real
 * directory. In a git worktree, `sessionPath/.git` is a file (not a dir), so
 * hooks must be installed into the base repo's `.git/hooks/` instead.
 *
 * All scripts/hooks are chmod 755 (executable).
 *
 * If workflow is null (repo has no confirmed workflow yet), installs
 * no-op placeholder hooks so git operations don't fail. The scripts
 * still run but print a warning.
 */
export declare function installEnforcementHooks(sessionPath: string, workflow: RepoIndexWorkflow | null, repoName: string, worktreeBasePath: string): Promise<void>;
//# sourceMappingURL=git-enforcement.d.ts.map