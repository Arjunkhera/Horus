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
 * Validates vault has git repo, then performs pull with optional conflict detection.
 */
export async function handleSyncPull(
  input: SyncPullInput,
  ctx: ToolContext
): Promise<SyncPullOutput | AnvilError> {
  try {
    // 1. Validate vault has git repo
    if (!(await isGitRepo(ctx.vaultPath))) {
      return makeError(
        ERROR_CODES.NO_GIT_REPO,
        'Vault is not a Git repository. Initialize git with "git init".'
      );
    }

    // 2. Call syncPull with context
    const remote = input.remote ?? 'origin';
    const result = await syncPull(
      ctx.vaultPath,
      remote,
      input.branch,
      ctx.watcher
    );

    // 3. Return result or error
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
