import type { GlobalConfig } from '../models/global-config.js';
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
/**
 * List active sessions from the session store, with optional filtering.
 *
 * Returns sessions with host-side paths when Forge runs in Docker.
 * The `lastModified` field falls back to `createdAt` for sessions that
 * pre-date the lastModified field (backward-compatible).
 */
export declare function sessionList(opts: SessionListOptions, globalConfig: GlobalConfig): Promise<SessionListResult>;
//# sourceMappingURL=session-list.d.ts.map