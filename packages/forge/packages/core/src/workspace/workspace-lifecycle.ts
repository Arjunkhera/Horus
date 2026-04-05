import { promises as fs } from 'fs';
import { WorkspaceMetadataStore } from './workspace-metadata-store.js';
import type { WorkspaceRecord, WorkspaceStatus } from '../models/workspace-record.js';

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
   *
   * Workspaces are context-only — they contain no git clones or worktrees.
   * The workspace folder is simply removed from disk. Use `forge_develop`
   * sessions (tracked separately) to manage isolated code sessions.
   */
  async delete(id: string, opts?: { force?: boolean }): Promise<void> {
    const record = await this.store.get(id);
    if (!record) {
      throw new Error(`Workspace '${id}' not found`);
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
