// Handler for anvil_sync_pull tool

import type {
  SyncPullInput,
  AnvilError,
} from '../types/index.js';
import { makeError, ERROR_CODES, isAnvilError } from '../types/index.js';
import { isGitRepo, syncPull } from '../sync/git-sync.js';
import type { ToolContext } from './create-note.js';

export type SyncPullOutput =
  | { status: 'ok'; filesChanged: number; conflicts: [] }
  | { status: 'conflict'; conflicts: Array<{ filePath: string; type: 'merge_conflict' }> }
  | { status: 'no_changes' };

/**
 * Handle anvil_sync_pull request.
 * Routes through GitSyncEngine when available (mutex-protected, health-tracked),
 * falls back to direct git operations for stdio mode or non-git vaults.
 */
export async function handleSyncPull(
  input: SyncPullInput,
  ctx: ToolContext
): Promise<SyncPullOutput | AnvilError> {
  try {
    if (ctx.syncEngine) {
      const result = await ctx.syncEngine.pull();
      if (result.status === 'ok') {
        return { status: 'ok', filesChanged: result.filesChanged ?? 0, conflicts: [] };
      } else if (result.status === 'no_changes') {
        return { status: 'no_changes' };
      } else if (result.status === 'conflict') {
        return { status: 'conflict', conflicts: [{ filePath: result.error ?? 'unknown', type: 'merge_conflict' }] };
      } else {
        return makeError(ERROR_CODES.SYNC_ERROR, result.error ?? 'Pull failed');
      }
    }

    // Fallback: direct git operations (no sync engine — stdio mode or no git repo)
    if (!(await isGitRepo(ctx.vaultPath))) {
      return makeError(
        ERROR_CODES.NO_GIT_REPO,
        'Vault is not a Git repository. Initialize git with "git init".'
      );
    }

    const remote = input.remote ?? 'origin';
    const result = await syncPull(
      ctx.vaultPath,
      remote,
      input.branch,
      ctx.watcher
    );

    if (isAnvilError(result)) {
      return result;
    }

    return result;
  } catch (err) {
    return makeError(
      ERROR_CODES.SYNC_ERROR,
      `Unexpected error during pull: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
