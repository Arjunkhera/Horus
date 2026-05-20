import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalRepoStateStoreManager, repoStatePath } from '../repo/local-repo-state-store.js';
import type { LocalRepoStateEntry, LocalRepoWorktree } from '../models/local-repo-state.js';

const execFileAsync = promisify(execFile);

/**
 * Two-tier positive-intent GC (decision 6bb34855) — the Bug J fix.
 *
 * Bug J: `forge_session_cleanup(olderThan:"1d")` destroyed 3 in-progress
 * sessions by age ALONE. This module makes that structurally impossible:
 *
 *   - Age is NEVER a sufficient condition for deletion.
 *   - A worktree is reclaimable ONLY if its work item is not active AND
 *     its tree is clean (no uncommitted, no unpushed, no stash).
 *   - Dry-run is the DEFAULT. Destruction requires `apply: true`.
 *   - When tree state cannot be determined, treat as NOT clean (safe).
 *   - A clone is never reclaimed while it has any live worktree.
 */

const ACTIVE_STATUSES = new Set([
  'in_progress',
  'in-progress',
  'in_review',
  'in-review',
  'open',
  'blocked',
]);

export interface WorktreeTreeState {
  uncommitted: boolean;
  unpushed: boolean;
  stash: boolean;
  /** Could every signal be determined? If false, callers must treat as unsafe. */
  determined: boolean;
}

export function isCleanTree(t: WorktreeTreeState): boolean {
  return t.determined && !t.uncommitted && !t.unpushed && !t.stash;
}

/**
 * Pure eligibility classifier. eligible IFF the work item is not active
 * AND the tree is clean. `ageMs` is accepted only to be surfaced in the
 * plan output — it is deliberately NOT part of the decision (Bug J).
 */
export function classifyWorktree(input: {
  status: string | null;
  tree: WorktreeTreeState;
  ageMs: number;
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const active = input.status !== null && ACTIVE_STATUSES.has(input.status);
  if (active) reasons.push(`work item status '${input.status}' is active`);
  if (input.status === null) reasons.push('work item status unknown (Anvil) — treated as active/unsafe');
  const clean = isCleanTree(input.tree);
  if (!input.tree.determined) reasons.push('tree state could not be determined — treated as dirty/unsafe');
  else {
    if (input.tree.uncommitted) reasons.push('uncommitted changes');
    if (input.tree.unpushed) reasons.push('unpushed commits');
    if (input.tree.stash) reasons.push('stash entries present');
  }
  const eligible = !active && input.status !== null && clean;
  if (eligible) reasons.push(`inactive + clean (age ${Math.round(input.ageMs / 86_400_000)}d, informational only)`);
  return { eligible, reasons };
}

/** Inspect a worktree's git tree state. Any failure → determined:false (unsafe). */
export async function getWorktreeTreeState(worktreePath: string): Promise<WorktreeTreeState> {
  try {
    const { stdout: porcelain } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      timeout: 15_000,
    });
    const { stdout: stashList } = await execFileAsync('git', ['stash', 'list'], {
      cwd: worktreePath,
      timeout: 10_000,
    });
    // Unpushed: commits on HEAD not reachable from its upstream. If no
    // upstream is configured we cannot prove the work is pushed → unsafe.
    let unpushed = true;
    try {
      const { stdout: up } = await execFileAsync(
        'git',
        ['rev-list', '--count', '@{upstream}..HEAD'],
        { cwd: worktreePath, timeout: 10_000 },
      );
      unpushed = parseInt(up.trim(), 10) > 0;
    } catch {
      unpushed = true; // no upstream / unknown → conservative
    }
    return {
      uncommitted: porcelain.trim().length > 0,
      unpushed,
      stash: stashList.trim().length > 0,
      determined: true,
    };
  } catch {
    return { uncommitted: true, unpushed: true, stash: true, determined: false };
  }
}

export interface WorktreeGcCandidate {
  clonePath: string;
  sessionId: string;
  worktreePath: string;
  branch: string;
  eligible: boolean;
  reasons: string[];
}

export interface GcPlan<T> {
  /** false = dry-run (nothing was deleted). */
  applied: boolean;
  reclaimed: T[];
  retained: T[];
}

export interface WorktreeGcOptions {
  dataPath?: string;
  /** MUST be explicitly true to delete. Default (undefined/false) = dry-run. */
  apply?: boolean;
  /** Resolve the Anvil status for a worktree's work item. */
  resolveStatus: (wt: LocalRepoWorktree, entry: LocalRepoStateEntry) => Promise<string | null>;
  now?: () => Date;
}

/**
 * Worktree-tier GC. Dry-run by default — returns the plan with per-candidate
 * eligibility + reasons. Deletes ONLY eligible candidates and ONLY when
 * `apply: true`.
 */
export async function worktreeGc(opts: WorktreeGcOptions): Promise<GcPlan<WorktreeGcCandidate>> {
  const dataPath = opts.dataPath;
  const now = (opts.now ?? (() => new Date()))();
  const store = new LocalRepoStateStoreManager(repoStatePath(dataPath));
  const state = await store.load();

  const reclaimed: WorktreeGcCandidate[] = [];
  const retained: WorktreeGcCandidate[] = [];

  for (const entry of state.repos) {
    for (const wt of entry.worktrees) {
      const status = await opts.resolveStatus(wt, entry);
      const tree = await getWorktreeTreeState(wt.path);
      const ageMs = now.getTime() - new Date(wt.createdAt).getTime();
      const { eligible, reasons } = classifyWorktree({ status, tree, ageMs });
      const cand: WorktreeGcCandidate = {
        clonePath: entry.clonePath,
        sessionId: wt.sessionId,
        worktreePath: wt.path,
        branch: wt.branch,
        eligible,
        reasons,
      };
      if (eligible) reclaimed.push(cand);
      else retained.push(cand);
    }
  }

  if (opts.apply === true) {
    for (const cand of reclaimed) {
      await execFileAsync('git', ['worktree', 'remove', '--force', cand.worktreePath], {
        cwd: cand.clonePath,
        timeout: 15_000,
      }).catch(() => {});
      await execFileAsync('git', ['worktree', 'prune'], {
        cwd: cand.clonePath,
        timeout: 10_000,
      }).catch(() => {});
      await fs.rm(cand.worktreePath, { recursive: true, force: true }).catch(() => {});
      const entry = state.repos.find((r) => r.clonePath === cand.clonePath)!;
      entry.worktrees = entry.worktrees.filter((w) => w.sessionId !== cand.sessionId);
    }
    await store.save(state);
  }

  return { applied: opts.apply === true, reclaimed, retained };
}

export interface CloneGcCandidate {
  clonePath: string;
  liveWorktrees: number;
  lastUsedAt: string | null;
  eligible: boolean;
  reasons: string[];
}

export interface CloneGcOptions {
  dataPath?: string;
  apply?: boolean;
  /** LRU age: a clone unused longer than this is reclaim-eligible. */
  maxIdleMs: number;
  now?: () => Date;
}

/**
 * Clone-tier GC. LRU on `lastUsedAt`. A clone is NEVER reclaimed while it
 * has any live worktree (subordinate to the worktree tier). Dry-run default.
 */
export async function cloneGc(opts: CloneGcOptions): Promise<GcPlan<CloneGcCandidate>> {
  const now = (opts.now ?? (() => new Date()))();
  const store = new LocalRepoStateStoreManager(repoStatePath(opts.dataPath));
  const state = await store.load();

  const reclaimed: CloneGcCandidate[] = [];
  const retained: CloneGcCandidate[] = [];

  for (const entry of state.repos) {
    const reasons: string[] = [];
    let eligible = true;
    if (entry.worktrees.length > 0) {
      eligible = false;
      reasons.push(`${entry.worktrees.length} live worktree(s) — never reclaim`);
    } else if (entry.lastUsedAt === null) {
      eligible = false;
      reasons.push('never used — no LRU signal, retained');
    } else {
      const idle = now.getTime() - new Date(entry.lastUsedAt).getTime();
      if (idle <= opts.maxIdleMs) {
        eligible = false;
        reasons.push(`idle ${Math.round(idle / 86_400_000)}d ≤ threshold — retained`);
      } else {
        reasons.push(`idle ${Math.round(idle / 86_400_000)}d > threshold, no live worktrees`);
      }
    }
    const cand: CloneGcCandidate = {
      clonePath: entry.clonePath,
      liveWorktrees: entry.worktrees.length,
      lastUsedAt: entry.lastUsedAt,
      eligible,
      reasons,
    };
    if (eligible) reclaimed.push(cand);
    else retained.push(cand);
  }

  if (opts.apply === true) {
    for (const cand of reclaimed) {
      await fs.rm(cand.clonePath, { recursive: true, force: true }).catch(() => {});
    }
    state.repos = state.repos.filter(
      (r) => !reclaimed.some((c) => c.clonePath === r.clonePath),
    );
    await store.save(state);
  }

  return { applied: opts.apply === true, reclaimed, retained };
}
