// Handler for anvil_sync_push tool

import type {
  SyncPushInput,
  AnvilError,
} from '../types/index.js';
import { makeError, ERROR_CODES, isAnvilError } from '../types/index.js';
import { isGitRepo, syncPush } from '../sync/git-sync.js';
import type { ToolContext } from './create-note.js';

export type SyncPushOutput =
  | { status: 'ok'; filesCommitted: number; commitHash: string }
  | { status: 'no_changes' }
  | { status: 'push_failed'; message: string };

/**
 * Handle anvil_sync_push request.
 * Routes through GitSyncEngine when available (mutex-protected, health-tracked),
 * falls back to direct git operations for stdio mode or non-git vaults.
 */
export async function handleSyncPush(
  input: SyncPushInput,
  ctx: ToolContext
): Promise<SyncPushOutput | AnvilError> {
  try {
    if (ctx.syncEngine) {
      const result = await ctx.syncEngine.push();
      if (result.status === 'ok') {
        return {
          status: 'ok',
          filesCommitted: result.filesCommitted ?? 0,
          commitHash: result.commitHash ?? '',
        };
      } else if (result.status === 'no_changes') {
        return { status: 'no_changes' };
      } else {
        return { status: 'push_failed', message: result.error ?? 'Push failed' };
      }
    }

    // Fallback: direct git operations (no sync engine — stdio mode or no git repo)
    if (!(await isGitRepo(ctx.vaultPath))) {
      return makeError(
        ERROR_CODES.NO_GIT_REPO,
        'Vault is not a Git repository. Initialize git with "git init".'
      );
    }

    const result = await syncPush(ctx.vaultPath, input.message);

    if (isAnvilError(result)) {
      return result;
    }

    return result;
  } catch (err) {
    return makeError(
      ERROR_CODES.SYNC_ERROR,
      `Unexpected error during push: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
