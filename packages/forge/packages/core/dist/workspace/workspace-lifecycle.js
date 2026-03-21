"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceLifecycleManager = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs_1 = require("fs");
const workspace_metadata_store_js_1 = require("./workspace-metadata-store.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// Valid state transitions
const VALID_TRANSITIONS = {
    active: ['paused', 'completed', 'archived'],
    paused: ['active', 'completed', 'archived'],
    completed: ['archived'],
    archived: [], // terminal state
};
class WorkspaceLifecycleManager {
    store;
    constructor(forgeDir, store) {
        this.store = store || new workspace_metadata_store_js_1.WorkspaceMetadataStore(forgeDir);
    }
    /**
     * Pause a workspace (active → paused).
     */
    async pause(id) {
        return this.transition(id, 'paused');
    }
    /**
     * Complete a workspace, recording completion time.
     */
    async complete(id) {
        return this.transition(id, 'completed', {
            completedAt: new Date().toISOString(),
        });
    }
    /**
     * Archive a workspace (terminal state).
     */
    async archive(id) {
        return this.transition(id, 'archived');
    }
    /**
     * Update lastAccessedAt timestamp.
     */
    async touch(id) {
        await this.store.touch(id);
    }
    /**
     * Delete a workspace record and remove its files from disk.
     * Optionally checks for uncommitted changes unless force=true.
     */
    async delete(id, opts) {
        const record = await this.store.get(id);
        if (!record) {
            throw new Error(`Workspace '${id}' not found`);
        }
        // Check for uncommitted changes unless force is set
        if (opts?.force !== true) {
            const hasUncommitted = await this.hasUncommittedChanges(record);
            if (hasUncommitted) {
                throw new Error('Workspace has uncommitted changes. Use --force to delete anyway.');
            }
        }
        // Remove git worktrees
        for (const repo of record.repos) {
            if (repo.worktreePath) {
                try {
                    await execFileAsync('git', ['worktree', 'remove', repo.worktreePath], {
                        cwd: repo.localPath,
                        timeout: 10000,
                    });
                }
                catch {
                    // Try with --force if normal remove fails
                    try {
                        await execFileAsync('git', ['worktree', 'remove', '--force', repo.worktreePath], {
                            cwd: repo.localPath,
                            timeout: 10000,
                        });
                    }
                    catch (err) {
                        console.warn(`[Forge] Warning: Could not remove worktree at ${repo.worktreePath}: ${err}`);
                    }
                }
                // Prune stale worktrees
                try {
                    await execFileAsync('git', ['worktree', 'prune'], { cwd: repo.localPath });
                }
                catch {
                    /* ignore */
                }
            }
        }
        // Remove workspace folder from disk
        try {
            await fs_1.promises.rm(record.path, { recursive: true, force: true });
        }
        catch (err) {
            console.warn(`[Forge] Warning: Could not remove workspace folder: ${err}`);
        }
        // Delete record from store
        await this.store.delete(id);
    }
    /**
     * Get workspaces that should be cleaned up based on retention policy.
     */
    async getRetentionCandidates(retentionDays) {
        return this.store.checkRetention(retentionDays);
    }
    /**
     * Clean up workspaces based on retention policy.
     * Returns list of cleaned workspace IDs.
     */
    async clean(retentionDays, opts) {
        const candidates = await this.getRetentionCandidates(retentionDays);
        const cleaned = [];
        const skipped = [];
        for (const candidate of candidates) {
            if (opts?.dryRun) {
                cleaned.push(candidate.id);
            }
            else {
                try {
                    await this.delete(candidate.id, { force: true });
                    cleaned.push(candidate.id);
                }
                catch (err) {
                    console.warn(`[Forge] Could not delete workspace ${candidate.id}: ${err}`);
                    skipped.push(candidate.id);
                }
            }
        }
        return { cleaned, skipped };
    }
    /**
     * Check if a workspace has uncommitted changes in any of its git worktrees.
     */
    async hasUncommittedChanges(record) {
        for (const repo of record.repos) {
            if (repo.worktreePath) {
                try {
                    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
                        cwd: repo.worktreePath,
                        timeout: 5000,
                    });
                    if (stdout.trim().length > 0) {
                        return true;
                    }
                }
                catch {
                    // Assume uncommitted if we can't check
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Validate state transition and apply it.
     */
    async transition(id, targetStatus, extraFields) {
        const record = await this.store.get(id);
        if (!record) {
            throw new Error(`Workspace '${id}' not found`);
        }
        const allowed = VALID_TRANSITIONS[record.status];
        if (!allowed.includes(targetStatus)) {
            throw new Error(`Cannot transition workspace from '${record.status}' to '${targetStatus}'`);
        }
        return this.store.update(id, { status: targetStatus, ...extraFields });
    }
}
exports.WorkspaceLifecycleManager = WorkspaceLifecycleManager;
//# sourceMappingURL=workspace-lifecycle.js.map