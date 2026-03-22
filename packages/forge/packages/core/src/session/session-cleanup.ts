import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SessionRecord } from '../models/session.js';
import type { GlobalConfig } from '../models/global-config.js';
import { SessionStoreManager } from './session-store.js';

const execFileAsync = promisify(execFile);

// ─── Public types ────────────────────────────────────────────────────────────

export interface SessionCleanupOptions {
  /** Clean the session for a specific work item */
  workItem?: string;
  /**
   * Clean sessions older than this threshold.
   * Format: "<number><unit>" where unit is d (days), h (hours), m (minutes).
   * Examples: "30d", "12h", "60m"
   */
  olderThan?: string;
  /**
   * Auto-cleanup mode: query Anvil for work item status and clean eligible sessions.
   *
   * Policy:
   *   - done (for 7+ days) → eligible
   *   - cancelled           → eligible immediately
   *   - in_progress / in_review → skip
   *   - not found          → warn, skip
   */
  auto?: boolean;
}

export interface SessionCleanupResult {
  cleaned: string[];
  skipped: string[];
  errors: string[];
}

// ─── Threshold parsing ───────────────────────────────────────────────────────

/**
 * Parse an olderThan string (e.g. "30d", "12h", "60m") into milliseconds.
 * Returns null if the string is invalid.
 */
function parseThresholdMs(olderThan: string): number | null {
  const match = olderThan.trim().match(/^(\d+)(d|h|m)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'm') return value * 60 * 1000;
  return null;
}

// ─── Anvil status query ──────────────────────────────────────────────────────

/**
 * Minimal Anvil HTTP client for fetching work item status.
 * Uses the same REST pattern as VaultClient.
 */
async function fetchAnvilWorkItemStatus(
  anvilUrl: string,
  workItem: string,
): Promise<string | null> {
  const url = `${anvilUrl.replace(/\/$/, '')}/notes/${workItem}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return (data['status'] as string) ?? null;
  } catch {
    return null;
  }
}

// ─── Git worktree cleanup ────────────────────────────────────────────────────

/**
 * Remove a git worktree and prune the worktree list.
 *
 * Steps:
 *   1. `git worktree remove <sessionPath>` (--force to handle detached heads)
 *   2. `git worktree prune` on the base repo
 *   3. Remove session directory if still present (failsafe)
 *
 * All git failures are caught and returned as warnings — the session record
 * is still removed from sessions.json regardless.
 */
async function removeWorktree(
  sessionPath: string,
  repoLocalPath: string,
): Promise<string[]> {
  const warnings: string[] = [];

  // Step 1: git worktree remove
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', sessionPath], {
      cwd: repoLocalPath,
      timeout: 15000,
    });
  } catch (err: any) {
    // Worktree may have already been manually removed — not fatal
    warnings.push(`git worktree remove: ${err.message ?? String(err)}`);
  }

  // Step 2: git worktree prune
  try {
    await execFileAsync('git', ['worktree', 'prune'], {
      cwd: repoLocalPath,
      timeout: 10000,
    });
  } catch (err: any) {
    warnings.push(`git worktree prune: ${err.message ?? String(err)}`);
  }

  // Step 3: remove directory if still present
  try {
    await fs.rm(sessionPath, { recursive: true, force: true });
  } catch (err: any) {
    // Non-fatal — directory may already be gone
    warnings.push(`rm session dir: ${err.message ?? String(err)}`);
  }

  return warnings;
}

// ─── Auto-cleanup policy ─────────────────────────────────────────────────────

const DONE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Determine if a session is eligible for auto-cleanup based on Anvil status.
 *
 * Returns:
 *   { eligible: true }  — session should be cleaned
 *   { eligible: false, reason: string } — session should be skipped
 *   { eligible: false, warn: true, reason: string } — skip with warning
 */
async function isEligibleForAutoCleanup(
  session: SessionRecord,
  anvilUrl: string,
): Promise<{ eligible: boolean; warn?: boolean; reason?: string }> {
  const status = await fetchAnvilWorkItemStatus(anvilUrl, session.workItem);

  if (status === null) {
    return {
      eligible: false,
      warn: true,
      reason: `Work item ${session.workItem} not found in Anvil — skipping (use explicit cleanup to remove)`,
    };
  }

  if (status === 'cancelled') {
    return { eligible: true };
  }

  if (status === 'done') {
    // Only eligible after 7-day grace period
    const modifiedAt = session.lastModified ?? session.createdAt;
    const age = Date.now() - new Date(modifiedAt).getTime();
    if (age >= DONE_GRACE_PERIOD_MS) {
      return { eligible: true };
    }
    const daysLeft = Math.ceil((DONE_GRACE_PERIOD_MS - age) / (24 * 60 * 60 * 1000));
    return {
      eligible: false,
      reason: `Work item done but grace period not expired (${daysLeft}d remaining)`,
    };
  }

  // in_progress, in_review, open, etc. — skip
  return {
    eligible: false,
    reason: `Work item status is '${status}' — skipping active session`,
  };
}

// ─── Repo base path resolution ───────────────────────────────────────────────

/**
 * Resolve the base repo path for a session record.
 *
 * For user-sourced sessions the repo.localPath is not available from the
 * session record directly. We use the session's repoSource as a hint and
 * fall back to a best-effort approach of checking the managed pool.
 *
 * The worktree must be removed from the perspective of the base repo.
 * If we cannot find the base repo, we fall back to removing the directory
 * directly (git worktree prune will clean up references on next access).
 */
async function resolveBaseRepoPath(
  session: SessionRecord,
  globalConfig: GlobalConfig,
): Promise<string | null> {
  const managedReposPath = globalConfig.workspace.managed_repos_path;

  if (session.repoSource === 'managed') {
    const managedPath = `${managedReposPath}/${session.repo}`;
    try {
      await fs.access(managedPath);
      return managedPath;
    } catch {
      return null;
    }
  }

  // For user-sourced repos, the worktree is inside the sessions root — the
  // base repo .git still tracks it. We need a reachable base path.
  // The sessionPath's .git/gitdir points back to the real .git:
  //   e.g., /data/sessions/<slug>/.git → /path/to/repo/.git/worktrees/<slug>
  // Read the gitdir to find the real repo.
  try {
    const gitdirPath = `${session.sessionPath}/.git`;
    const gitdirContent = await fs.readFile(gitdirPath, 'utf-8');
    // Format: "gitdir: /path/to/repo/.git/worktrees/<name>\n"
    const match = gitdirContent.trim().match(/^gitdir:\s*(.+)$/);
    if (match) {
      const worktreeRef = match[1].trim();
      // .../repo/.git/worktrees/<name> → .../repo
      const gitIdx = worktreeRef.lastIndexOf('/.git/');
      if (gitIdx !== -1) {
        return worktreeRef.slice(0, gitIdx);
      }
    }
  } catch {
    // Session path may not exist — cannot read .git file
  }

  return null;
}

// ─── Main cleanup function ───────────────────────────────────────────────────

/**
 * Clean up sessions based on the provided options.
 *
 * At least one of workItem, olderThan, or auto must be specified.
 * Multiple options are OR-combined: a session matching any criterion is cleaned.
 */
export async function sessionCleanup(
  opts: SessionCleanupOptions,
  globalConfig: GlobalConfig,
): Promise<SessionCleanupResult> {
  if (!opts.workItem && !opts.olderThan && !opts.auto) {
    throw new Error('At least one of workItem, olderThan, or auto must be specified.');
  }

  const sessionsPath = globalConfig.workspace.sessions_path;
  const store = new SessionStoreManager(sessionsPath);
  const allSessions = await store.list();

  const cleaned: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // Parse age threshold once
  let thresholdMs: number | null = null;
  if (opts.olderThan) {
    thresholdMs = parseThresholdMs(opts.olderThan);
    if (thresholdMs === null) {
      throw new Error(`Invalid olderThan format: "${opts.olderThan}". Expected format: <number><d|h|m> (e.g., "30d", "12h")`);
    }
  }

  // Resolve Anvil URL for auto-cleanup
  const anvilUrl = globalConfig.mcp_endpoints.anvil?.url ?? null;

  for (const session of allSessions) {
    let shouldClean = false;
    let skipReason: string | undefined;
    let warnReason: string | undefined;

    // --- Criterion 1: specific workItem ---
    if (opts.workItem && session.workItem === opts.workItem) {
      shouldClean = true;
    }

    // --- Criterion 2: olderThan ---
    if (!shouldClean && thresholdMs !== null) {
      const modifiedAt = session.lastModified ?? session.createdAt;
      const age = Date.now() - new Date(modifiedAt).getTime();
      if (age >= thresholdMs) {
        shouldClean = true;
      }
    }

    // --- Criterion 3: auto-policy ---
    if (!shouldClean && opts.auto) {
      if (!anvilUrl) {
        // No Anvil configured — cannot determine status, skip with warning
        warnReason = `Auto-cleanup: Anvil endpoint not configured in forge.yaml — cannot query status for session ${session.sessionId}`;
        skipReason = warnReason;
      } else {
        const autoResult = await isEligibleForAutoCleanup(session, anvilUrl);
        if (autoResult.eligible) {
          shouldClean = true;
        } else {
          if (autoResult.warn) {
            warnReason = autoResult.reason;
          }
          skipReason = autoResult.reason;
        }
      }
    }

    if (!shouldClean) {
      if (skipReason) {
        if (warnReason) {
          errors.push(`[WARN] ${session.sessionId} (${session.repo}/${session.workItem}): ${warnReason}`);
        }
        skipped.push(session.sessionId);
      }
      continue;
    }

    // ── Perform cleanup ──
    try {
      const baseRepoPath = await resolveBaseRepoPath(session, globalConfig);

      if (baseRepoPath) {
        const warnings = await removeWorktree(session.sessionPath, baseRepoPath);
        for (const w of warnings) {
          errors.push(`[WARN] ${session.sessionId}: ${w}`);
        }
      } else {
        // Base repo not found — remove session directory directly
        try {
          await fs.rm(session.sessionPath, { recursive: true, force: true });
        } catch (err: any) {
          errors.push(`[WARN] ${session.sessionId}: could not remove session dir: ${err.message ?? String(err)}`);
        }
      }

      // Always remove from store, regardless of git success
      await store.remove(session.sessionId);
      cleaned.push(session.sessionId);
    } catch (err: any) {
      errors.push(`[ERROR] ${session.sessionId}: ${err.message ?? String(err)}`);
    }
  }

  return { cleaned, skipped, errors };
}
