import type { GlobalConfig } from '../models/global-config.js';
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
/**
 * Clean up sessions based on the provided options.
 *
 * At least one of workItem, olderThan, or auto must be specified.
 * Multiple options are OR-combined: a session matching any criterion is cleaned.
 */
export declare function sessionCleanup(opts: SessionCleanupOptions, globalConfig: GlobalConfig): Promise<SessionCleanupResult>;
//# sourceMappingURL=session-cleanup.d.ts.map