import { WorkspaceMetadataStore } from './workspace-metadata-store.js';
import type { WorkspaceRecord } from '../models/workspace-record.js';
export declare class WorkspaceLifecycleManager {
    private store;
    constructor(forgeDir?: string, store?: WorkspaceMetadataStore);
    /**
     * Pause a workspace (active → paused).
     */
    pause(id: string): Promise<WorkspaceRecord>;
    /**
     * Complete a workspace, recording completion time.
     */
    complete(id: string): Promise<WorkspaceRecord>;
    /**
     * Archive a workspace (terminal state).
     */
    archive(id: string): Promise<WorkspaceRecord>;
    /**
     * Update lastAccessedAt timestamp.
     */
    touch(id: string): Promise<void>;
    /**
     * Delete a workspace record and remove its files from disk.
     * Optionally checks for uncommitted changes unless force=true.
     */
    delete(id: string, opts?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Get workspaces that should be cleaned up based on retention policy.
     */
    getRetentionCandidates(retentionDays: number): Promise<WorkspaceRecord[]>;
    /**
     * Clean up workspaces based on retention policy.
     * Returns list of cleaned workspace IDs.
     */
    clean(retentionDays: number, opts?: {
        dryRun?: boolean;
    }): Promise<{
        cleaned: string[];
        skipped: string[];
    }>;
    /**
     * Check if a workspace has uncommitted changes in any of its git worktrees.
     */
    private hasUncommittedChanges;
    /**
     * Validate state transition and apply it.
     */
    private transition;
}
//# sourceMappingURL=workspace-lifecycle.d.ts.map