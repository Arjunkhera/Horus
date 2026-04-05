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
 * Validates vault has git repo, then performs push.
 */
export async function handleSyncPush(
  input: SyncPushInput,
  ctx: ToolContext
): Promise<SyncPushOutput | AnvilError> {
  try {
    // 1. Validate vault has git repo
    if (!(await isGitRepo(ctx.vaultPath))) {
      return makeError(
        ERROR_CODES.NO_GIT_REPO,
        'Vault is not a Git repository. Initialize git with "git init".'
      );
    }

    // 2. Call syncPush with context
    const result = await syncPush(ctx.vaultPath, input.message);

    // 3. Return result or error
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
