import type { SessionRecord } from '../models/session.js';
import type { GlobalConfig } from '../models/global-config.js';
import { SessionStoreManager } from './session-store.js';

// ─── Public types ────────────────────────────────────────────────────────────

export interface SessionListOptions {
  /** Filter to sessions for a specific repository */
  repo?: string;
  /** Filter to sessions for a specific work item */
  workItem?: string;
}

export interface SessionListItem {
  sessionId: string;
  sessionPath: string;
  repo: string;
  workItem: string;
  branch: string;
  createdAt: string;
  lastModified: string;
}

export interface SessionListResult {
  sessions: SessionListItem[];
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * List active sessions from the session store, with optional filtering.
 *
 * Returns sessions with host-side paths when Forge runs in Docker.
 * The `lastModified` field falls back to `createdAt` for sessions that
 * pre-date the lastModified field (backward-compatible).
 */
export async function sessionList(
  opts: SessionListOptions,
  globalConfig: GlobalConfig,
): Promise<SessionListResult> {
  const sessionsPath = globalConfig.workspace.sessions_path;
  const store = new SessionStoreManager(sessionsPath);

  const records: SessionRecord[] = await store.listFiltered({
    repo: opts.repo,
    workItem: opts.workItem,
  });

  const sessions: SessionListItem[] = records.map(r => ({
    sessionId: r.sessionId,
    sessionPath: r.hostSessionPath ?? r.sessionPath,
    repo: r.repo,
    workItem: r.workItem,
    branch: r.branch,
    createdAt: r.createdAt,
    lastModified: r.lastModified ?? r.createdAt,
  }));

  return { sessions };
}
