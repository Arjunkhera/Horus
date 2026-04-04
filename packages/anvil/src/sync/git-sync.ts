// Git operations wrapper using simple-git
// Provides typed wrapper functions for common git operations

import { simpleGit, SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import type { AnvilWatcher } from '../storage/watcher.js';
import { makeError, ERROR_CODES, type AnvilError } from '../types/error.js';

/**
 * Result type for git pull operations
 */
export type SyncPullResult =
  | { status: 'ok'; filesChanged: number; conflicts: [] }
  | { status: 'conflict'; conflicts: Array<{ filePath: string; type: 'merge_conflict' }> }
  | { status: 'no_changes' };

/**
 * Result type for git push operations
 */
export type SyncPushResult =
  | { status: 'ok'; filesCommitted: number; commitHash: string }
  | { status: 'no_changes' }
  | { status: 'push_failed'; message: string };

/**
 * Check if a directory is a git repository by checking for .git directory
 */
export async function isGitRepo(vaultPath: string): Promise<boolean> {
  try {
    const gitDir = `${vaultPath}/.git`;
    const stats = await fs.stat(gitDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Perform a git pull operation (fetch + merge) with conflict detection
 * Optionally waits for watcher batch completion if no conflicts
 */
export async function syncPull(
  vaultPath: string,
  remote: string = 'origin',
  branch?: string,
  watcher?: AnvilWatcher
): Promise<SyncPullResult | AnvilError> {
  try {
    // Check if it's a git repo
    if (!(await isGitRepo(vaultPath))) {
      return makeError(
        ERROR_CODES.NO_GIT_REPO,
        'Vault is not a Git repository. Initialize git with "git init".'
      );
    }

    const git: SimpleGit = simpleGit(vaultPath);

    // 1. Fetch from remote
    try {
      await git.fetch(remote);
    } catch (err) {
      return makeError(
        ERROR_CODES.SYNC_ERROR,
        `Failed to fetch from remote "${remote}": ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 2. Merge with fast-forward preference, fallback to regular merge
    const mergeRef = branch ? `${remote}/${branch}` : `${remote}/HEAD`;
    let mergeResult: unknown;
    try {
      mergeResult = await git.merge(['--ff-only', mergeRef]);
    } catch {
      // Fast-forward failed, try regular merge
      try {
        mergeResult = await git.merge([mergeRef]);
      } catch (err) {
        return makeError(
          ERROR_CODES.SYNC_ERROR,
          `Failed to merge from "${mergeRef}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 3. Check for conflict markers in changed files
    const conflicts = await detectConflictMarkers(vaultPath);

    if (conflicts.length > 0) {
      return {
        status: 'conflict',
        conflicts: conflicts.map((filePath) => ({
          filePath,
          type: 'merge_conflict' as const,
        })),
      };
    }

    // 4. Get count of changed files
    const status = await git.status();
    const filesChanged = (status.files?.length ?? 0) + (status.created?.length ?? 0) + (status.modified?.length ?? 0) + (status.deleted?.length ?? 0);

    // 5. If no conflicts and watcher available, wait for batch
    if (watcher) {
      await watcher.waitForBatch();
    }

    if (filesChanged === 0) {
      return { status: 'no_changes' };
    }

    return {
      status: 'ok',
      filesChanged,
      conflicts: [],
    };
  } catch (err) {
    return makeError(
      ERROR_CODES.SYNC_ERROR,
      `Unexpected error during pull: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Perform a git push operation (add + commit + push)
 * Only stages .md files and .anvil/types/*.yaml files
 * Never stages .anvil/.local/ directory
 */
export async function syncPush(
  vaultPath: string,
  message: string
): Promise<SyncPushResult | AnvilError> {
  try {
    // Check if it's a git repo
    if (!(await isGitRepo(vaultPath))) {
      return makeError(
        ERROR_CODES.NO_GIT_REPO,
        'Vault is not a Git repository. Initialize git with "git init".'
      );
    }

    const git: SimpleGit = simpleGit(vaultPath);

    // 1. Check current status
    const statusBefore = await git.status();

    // 2. Stage only .md and .anvil/types/*.yaml files (never .anvil/.local/)
    // Handle patterns separately since missing patterns cause errors
    try {
      // First try to add markdown files
      try {
        await git.add(['*.md']);
      } catch {
        // No .md files might exist, continue
      }

      // Then try to add type YAML files if the directory exists
      try {
        const typesPath = `${vaultPath}/.anvil/types`;
        try {
          await fs.stat(typesPath);
          // Directory exists, try to add yaml files from it
          await git.add(['.anvil/types/*.yaml']);
        } catch {
          // Directory doesn't exist, skip
        }
      } catch {
        // No type files might exist, continue
      }
    } catch (err) {
      return makeError(
        ERROR_CODES.SYNC_ERROR,
        `Failed to stage files: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 3. Check if anything was staged
    const statusAfter = await git.status();
    const isStagedEmpty = (statusAfter.staged?.length ?? 0) === 0 && (statusAfter.files?.length ?? 0) === 0;

    // Only count untracked files that would actually be staged (.md or .anvil/types/*.yaml)
    const relevantNotAdded = (statusBefore.not_added ?? []).filter(
      (f) => f.endsWith('.md') || (f.startsWith('.anvil/types/') && f.endsWith('.yaml'))
    );
    if (isStagedEmpty && relevantNotAdded.length === 0) {
      return { status: 'no_changes' };
    }

    // 4. Commit
    let commitHash = '';
    try {
      const commitResult = await git.commit(message);
      commitHash = commitResult.commit;
      // If git.commit() returned silently with no hash, nothing was committed
      if (!commitHash) {
        return { status: 'no_changes' };
      }
    } catch (err) {
      // No changes to commit
      if ((err instanceof Error && err.message.includes('nothing to commit')) || (statusAfter.staged?.length ?? 0) === 0) {
        return { status: 'no_changes' };
      }
      return makeError(
        ERROR_CODES.SYNC_ERROR,
        `Failed to commit: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 5. Push
    try {
      await git.push();
    } catch (err) {
      // Check if error is due to no remote
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('no remote') || errMsg.includes('No remote')) {
        return makeError(
          ERROR_CODES.NO_REMOTE,
          'No remote configured for this repository. Add a remote with "git remote add origin <url>".'
        );
      }
      return {
        status: 'push_failed',
        message: errMsg,
      };
    }

    // Get count of files committed
    const filesCommitted = statusAfter.staged?.length ?? 1;

    return {
      status: 'ok',
      filesCommitted,
      commitHash,
    };
  } catch (err) {
    return makeError(
      ERROR_CODES.SYNC_ERROR,
      `Unexpected error during push: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Detect conflict markers in changed files
 * Returns array of file paths that contain conflict markers
 */
async function detectConflictMarkers(vaultPath: string): Promise<string[]> {
  const git: SimpleGit = simpleGit(vaultPath);
  const status = await git.status();

  const conflictFiles: string[] = [];

  // Check all modified/added files
  const filesToCheck: string[] = [];
  
  // Extract file paths from status.files (which are FileStatusResult objects)
  if (status.files && Array.isArray(status.files)) {
    for (const file of status.files) {
      if (typeof file === 'string') {
        filesToCheck.push(file);
      } else if (file && typeof file === 'object' && 'path' in file) {
        filesToCheck.push((file as unknown as { path: string }).path);
      }
    }
  }

  // Add other tracked changes
  if (status.modified) filesToCheck.push(...status.modified);
  if (status.created) filesToCheck.push(...status.created);

  for (const filePath of filesToCheck) {
    try {
      const fullPath = `${vaultPath}/${filePath}`;
      const content = await fs.readFile(fullPath, 'utf-8');
      if (content.includes('<<<<<<<')) {
        conflictFiles.push(filePath);
      }
    } catch {
      // File may have been deleted or inaccessible, skip
    }
  }

  return conflictFiles;
}
