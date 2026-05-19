import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  repoClonePath,
  worktreePath,
  ensureHorusIgnored,
  horusDataPath,
} from './clone-layout.js';
import { deriveRepoCoordinate } from './url-utils.js';
import { LocalRepoStateStoreManager, repoStatePath } from './local-repo-state-store.js';

const execFileAsync = promisify(execFile);

/**
 * Default managed-clone refresh TTL (decision 2c413cf7). Override via the
 * `ttlMs` option or the `HORUS_CLONE_TTL_MS` env var. Default 1h: stale
 * enough to avoid per-resolve network churn on a hotbox VM, fresh enough
 * that a worktree branches from a near-current base.
 */
export const DEFAULT_CLONE_TTL_MS = 60 * 60 * 1000;

export function cloneTtlMs(override?: number): number {
  if (typeof override === 'number') return override;
  const env = process.env.HORUS_CLONE_TTL_MS;
  if (env && Number.isFinite(Number(env))) return Number(env);
  return DEFAULT_CLONE_TTL_MS;
}

export interface CloneSemanticsOptions {
  dataPath?: string;
  ttlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  gitTimeoutMs?: number;
}

/**
 * Pure staleness predicate (decision 2c413cf7). Never-fetched (null) is
 * always stale, forcing an initial fetch.
 */
export function isCloneStale(
  lastFetchedAt: string | null,
  ttlMs: number,
  now: Date,
): boolean {
  if (lastFetchedAt === null) return true;
  return now.getTime() - new Date(lastFetchedAt).getTime() > ttlMs;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a Horus-owned managed clone exists for `url`. Clones from the
 * canonical URL into the deterministic Horus path — NEVER touches the
 * user's own checkout (R1, S12). Idempotent. Returns the clone path.
 *
 * Atomic-rename clone pattern (mirrors repo-develop.cloneToManagedPool):
 * clone into a temp dir, then rename into place, so a partial/interrupted
 * clone never leaves a corrupt clonePath.
 */
export async function ensureClone(
  url: string,
  opts: CloneSemanticsOptions = {},
): Promise<string> {
  const dataPath = opts.dataPath ?? horusDataPath();
  const clonePath = repoClonePath(url, dataPath);
  const coord = deriveRepoCoordinate(url);
  const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));

  if (await isGitRepo(clonePath)) {
    await store.patch({ ...coord, clonePath }, {});
    await ensureHorusIgnored(clonePath);
    return clonePath;
  }

  // Not a valid clone — clear any partial state, clone fresh atomically.
  await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});
  const tmpPath = `${clonePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(dirname(clonePath), { recursive: true });
  try {
    await execFileAsync('git', ['clone', url, tmpPath], {
      timeout: opts.gitTimeoutMs ?? 120_000,
    });
    await fs.rename(tmpPath, clonePath);
  } catch (err) {
    await fs.rm(tmpPath, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  await ensureHorusIgnored(clonePath);
  await store.patch({ ...coord, clonePath }, {});
  return clonePath;
}

/**
 * Lazy-TTL refresh (decision 2c413cf7). If the clone's lastFetchedAt is
 * older than the TTL (or never), run `git fetch` of the base branch ONLY —
 * never pull/merge, so a checked-out tree is never mutated (R1, S3).
 * Returns true if a fetch was performed.
 */
export async function refreshIfStale(
  url: string,
  baseBranch: string,
  opts: CloneSemanticsOptions = {},
): Promise<boolean> {
  const dataPath = opts.dataPath ?? horusDataPath();
  const now = (opts.now ?? (() => new Date()))();
  const ttl = cloneTtlMs(opts.ttlMs);
  const clonePath = repoClonePath(url, dataPath);
  const coord = deriveRepoCoordinate(url);
  const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));

  const entry = await store.get(clonePath);
  if (!isCloneStale(entry?.lastFetchedAt ?? null, ttl, now)) return false;

  await execFileAsync('git', ['fetch', 'origin', baseBranch], {
    cwd: clonePath,
    timeout: opts.gitTimeoutMs ?? 120_000,
  });
  await store.patch({ ...coord, clonePath }, { lastFetchedAt: now.toISOString() });
  return true;
}

/**
 * Create a session worktree at {clone}/.horus/worktrees/{sessionId}/
 * (decision ca259b26), branching from the freshly-fetched base. Ensures
 * the clone exists and is fresh first. Records the worktree + lastUsedAt
 * in LocalRepoState (clone-tier GC LRU key, decision 6bb34855).
 */
export async function createSessionWorktree(
  url: string,
  sessionId: string,
  baseBranch: string,
  branch: string,
  opts: CloneSemanticsOptions = {},
): Promise<string> {
  const dataPath = opts.dataPath ?? horusDataPath();
  const now = (opts.now ?? (() => new Date()))();
  const clonePath = await ensureClone(url, opts);
  await refreshIfStale(url, baseBranch, opts);

  const wtPath = worktreePath(clonePath, sessionId);
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', branch, wtPath, `origin/${baseBranch}`],
    { cwd: clonePath, timeout: opts.gitTimeoutMs ?? 120_000 },
  );

  const coord = deriveRepoCoordinate(url);
  const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
  await store.patch({ ...coord, clonePath }, { lastUsedAt: now.toISOString() });
  await store.addWorktree(clonePath, {
    sessionId,
    path: wtPath,
    branch,
    createdAt: now.toISOString(),
  });
  return wtPath;
}
