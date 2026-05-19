import { homedir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { deriveRepoCoordinate, type RepoCoordinate } from './url-utils.js';

/**
 * Horus-owned managed-clone filesystem layout (decisions 349fdd96 + ca259b26).
 *
 *   {dataPath}/repos/{host}/{org}/{name}/                  ← managed clone
 *   {dataPath}/repos/{host}/{org}/{name}/.horus/worktrees/ ← session worktrees
 *
 * All clones live under the Horus-owned root, never straddling user paths
 * (R1 — the user's working tree is sacred). Worktrees are colocated inside
 * the clone so the clone + all its sessions form one GC subtree.
 */

/** Resolve the Horus data path: $HORUS_DATA_PATH or ~/Horus/data. */
export function horusDataPath(): string {
  return process.env.HORUS_DATA_PATH || join(homedir(), 'Horus', 'data');
}

/** Root under which all managed clones live: {dataPath}/repos. */
export function horusReposRoot(dataPath: string = horusDataPath()): string {
  return join(dataPath, 'repos');
}

/**
 * Deterministic managed-clone path for a repo, derived purely from its
 * git remote URL (decision 349fdd96). No filesystem or registry lookup.
 */
export function repoClonePath(url: string, dataPath: string = horusDataPath()): string {
  const { host, org, name } = deriveRepoCoordinate(url);
  return join(horusReposRoot(dataPath), host, org, name);
}

/** Coordinate-typed variant for callers that already resolved the URL. */
export function repoClonePathFromCoordinate(
  coord: RepoCoordinate,
  dataPath: string = horusDataPath(),
): string {
  return join(horusReposRoot(dataPath), coord.host, coord.org, coord.name);
}

/** Directory holding all session worktrees for a clone (decision ca259b26). */
export function repoWorktreesDir(clonePath: string): string {
  return join(clonePath, '.horus', 'worktrees');
}

/** Path of a single session worktree (multi-agent slots append -2/-3 upstream). */
export function worktreePath(clonePath: string, sessionId: string): string {
  return join(repoWorktreesDir(clonePath), sessionId);
}

const HORUS_EXCLUDE_LINE = '/.horus/';

/**
 * Ensure the colocated `.horus/` directory never pollutes the clone's
 * `git status` or commits (decision ca259b26 follow-up).
 *
 * Rationale for `.git/info/exclude` over `core.excludesFile`: per-clone
 * `.git/info/exclude` is scoped to exactly this clone, is never committed,
 * and does not mutate user-global git config — satisfying R1 (do not touch
 * the user's environment beyond the Horus-owned clone) and R8 (per-machine
 * facts stay out of tracked config). `core.excludesFile` is global and
 * invasive; a tracked `.gitignore` edit would dirty the user's repo.
 *
 * Idempotent: a no-op if the line is already present.
 */
export async function ensureHorusIgnored(clonePath: string): Promise<void> {
  const excludePath = join(clonePath, '.git', 'info', 'exclude');
  let existing = '';
  try {
    existing = await fs.readFile(excludePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // .git/info may not exist for an unusual clone — create it.
    await fs.mkdir(join(clonePath, '.git', 'info'), { recursive: true });
  }

  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes(HORUS_EXCLUDE_LINE) || lines.includes('.horus/')) {
    return;
  }

  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await fs.appendFile(
    excludePath,
    `${prefix}# Horus-managed session worktrees (do not commit)\n${HORUS_EXCLUDE_LINE}\n`,
  );
}
