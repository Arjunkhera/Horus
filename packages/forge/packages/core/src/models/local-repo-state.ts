import { z } from 'zod';

/**
 * LocalRepoState (RR-9) — machine-specific record of where Horus-managed
 * clones live and their refresh/use bookkeeping. Decisions 349fdd96
 * (layout), 2c413cf7 (lazy-TTL fetch), ca259b26 (colocated worktrees),
 * 6bb34855 (clone-tier GC needs lastUsedAt).
 *
 * This file lives under the Horus data path (~/Horus/data/config/
 * repo-state.json), NOT inside any repo — it is inherently git-ignored
 * and never synced (paths are machine-specific, D9).
 */

export const LocalRepoWorktreeSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  branch: z.string(),
  createdAt: z.string(), // ISO
});
export type LocalRepoWorktree = z.infer<typeof LocalRepoWorktreeSchema>;

export const LocalRepoStateEntrySchema = z.object({
  host: z.string(),
  org: z.string(),
  name: z.string(),
  clonePath: z.string(),
  /** ISO of last `git fetch`; null = never fetched (forces refresh). */
  lastFetchedAt: z.string().nullable(),
  /** ISO of last time a worktree was created/used (clone-tier GC LRU key). */
  lastUsedAt: z.string().nullable(),
  worktrees: z.array(LocalRepoWorktreeSchema),
});
export type LocalRepoStateEntry = z.infer<typeof LocalRepoStateEntrySchema>;

export const LocalRepoStateStoreSchema = z.object({
  version: z.literal('1'),
  repos: z.array(LocalRepoStateEntrySchema),
});
export type LocalRepoStateStore = z.infer<typeof LocalRepoStateStoreSchema>;

export const EMPTY_LOCAL_REPO_STATE: LocalRepoStateStore = {
  version: '1',
  repos: [],
};
