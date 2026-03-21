import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { WorkspaceMetadataStore } from './workspace-metadata-store.js';
import type { WorkspaceRecord, WorkspaceStatus } from '../models/workspace-record.js';

const execFileAsync = promisify(execFile);

// Valid state transitions
const VALID_TRANSITIONS: Record<WorkspaceStatus, WorkspaceStatus[]> = {
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'completed', 'archived'],
  completed: ['archived'],
  archived: [], // terminal state
};

export class WorkspaceLifecycleManager {
  private store: WorkspaceMetadataStore;

  constructor(forgeDir?: string, store?: WorkspaceMetadataStore) {
    this.store = store || new WorkspaceMetadataStore(forgeDir);
  }

  /**
   * Pause a workspace (active → paused).
   */
  async pause(id: string): Promise<WorkspaceRecord> {
    return this.transition(id, 'paused');
  }

  /**
   * Complete a workspace, recording completion time.
   */
  async complete(id: string): Promise<WorkspaceRecord> {
    return this.transition(id, 'completed', {
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Archive a workspace (terminal state).
   */
  async archive(id: string): Promise<WorkspaceRecord> {
    return this.transition(id, 'archived');
  }

  /**
   * Update lastAccessedAt timestamp.
   */
  async touch(id: string): Promise<void> {
    await this.store.touch(id);
  }

  /**
   * Delete a workspace record and remove its files from disk.
   * Optionally checks for uncommitted changes unless force=true.
   */
  async delete(id: string, opts?: { force?: boolean }): Promise<void> {
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
        } catch {
          // Try with --force if normal remove fails
          try {
            await execFileAsync('git', ['worktree', 'remove', '--force', repo.worktreePath], {
              cwd: repo.localPath,
              timeout: 10000,
            });
          } catch (err) {
            console.warn(`[Forge] Warning: Could not remove worktree at ${repo.worktreePath}: ${err}`);
          }
        }

        // Prune stale worktrees
        try {
          await execFileAsync('git', ['worktree', 'prune'], { cwd: repo.localPath });
        } catch {
          /* ignore */
        }
      }
    }

    // Remove workspace folder from disk
    try {
      await fs.rm(record.path, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Forge] Warning: Could not remove workspace folder: ${err}`);
    }

    // Delete record from store
    await this.store.delete(id);
  }

  /**
   * Get workspaces that should be cleaned up based on retention policy.
   */
  async getRetentionCandidates(retentionDays: number): Promise<WorkspaceRecord[]> {
    return this.store.checkRetention(retentionDays);
  }

  /**
   * Clean up workspaces based on retention policy.
   * Returns list of cleaned workspace IDs.
   */
  async clean(
    retentionDays: number,
    opts?: { dryRun?: boolean },
  ): Promise<{ cleaned: string[]; skipped: string[] }> {
    const candidates = await this.getRetentionCandidates(retentionDays);
    const cleaned: string[] = [];
    const skipped: string[] = [];

    for (const candidate of candidates) {
      if (opts?.dryRun) {
        cleaned.push(candidate.id);
      } else {
        try {
          await this.delete(candidate.id, { force: true });
          cleaned.push(candidate.id);
        } catch (err) {
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
  private async hasUncommittedChanges(record: WorkspaceRecord): Promise<boolean> {
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
        } catch {
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
  private async transition(
    id: string,
    targetStatus: WorkspaceStatus,
    extraFields?: Partial<WorkspaceRecord>,
  ): Promise<WorkspaceRecord> {
    const record = await this.store.get(id);
    if (!record) {
      throw new Error(`Workspace '${id}' not found`);
    }

    const allowed = VALID_TRANSITIONS[record.status];
    if (!allowed.includes(targetStatus)) {
      throw new Error(
        `Cannot transition workspace from '${record.status}' to '${targetStatus}'`,
      );
    }

    return this.store.update(id, { status: targetStatus, ...extraFields });
  }
}
