import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  WorkspaceStoreSchema,
  WorkspaceRecordSchema,
  type WorkspaceRecord,
  type WorkspaceStore,
  type WorkspaceStatus,
} from '../models/workspace-record.js';

export const WORKSPACES_FILE = 'workspaces.json';

export function generateWorkspaceId(): string {
  return `ws-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export class WorkspaceMetadataStore {
  private storePath: string;

  constructor(storePath: string = path.join(process.env.HOME ?? '~', '.forge', WORKSPACES_FILE)) {
    this.storePath = storePath;
  }

  // For testing — override store path
  withPath(storePath: string): WorkspaceMetadataStore {
    this.storePath = storePath;
    return this;
  }

  /**
   * Load workspace store from disk. Returns empty store if file missing.
   */
  async load(): Promise<WorkspaceStore> {
    try {
      const raw = await fs.readFile(this.storePath, 'utf-8');
      return WorkspaceStoreSchema.parse(JSON.parse(raw));
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { version: '1', workspaces: {} };
      }
      console.warn(`[Forge] Warning: Could not parse workspace store: ${err.message}`);
      return { version: '1', workspaces: {} };
    }
  }

  /**
   * Save workspace store to disk. Creates directory if needed.
   */
  async save(store: WorkspaceStore): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  /**
   * Add a new workspace record. Throws if ID already exists.
   */
  async create(record: WorkspaceRecord): Promise<void> {
    // Validate the record
    WorkspaceRecordSchema.parse(record);

    const store = await this.load();

    if (store.workspaces[record.id]) {
      throw new Error(`Workspace with ID "${record.id}" already exists`);
    }

    store.workspaces[record.id] = record;
    await this.save(store);
  }

  /**
   * Fetch a workspace record by ID. Returns null if not found.
   */
  async get(id: string): Promise<WorkspaceRecord | null> {
    const store = await this.load();
    return store.workspaces[id] ?? null;
  }

  /**
   * Update a workspace record by merging a patch. Throws if ID not found.
   */
  async update(id: string, patch: Partial<WorkspaceRecord>): Promise<WorkspaceRecord> {
    const store = await this.load();

    const existing = store.workspaces[id];
    if (!existing) {
      throw new Error(`Workspace with ID "${id}" not found`);
    }

    const updated = { ...existing, ...patch };
    WorkspaceRecordSchema.parse(updated);

    store.workspaces[id] = updated;
    await this.save(store);

    return updated;
  }

  /**
   * Delete a workspace record by ID. Throws if ID not found.
   */
  async delete(id: string): Promise<void> {
    const store = await this.load();

    if (!store.workspaces[id]) {
      throw new Error(`Workspace with ID "${id}" not found`);
    }

    delete store.workspaces[id];
    await this.save(store);
  }

  /**
   * List all workspace records, optionally filtered by status.
   * Returns sorted by lastAccessedAt descending.
   */
  async list(filter?: { status?: WorkspaceStatus }): Promise<WorkspaceRecord[]> {
    const store = await this.load();

    let records = Object.values(store.workspaces);

    if (filter?.status) {
      records = records.filter((r) => r.status === filter.status);
    }

    records.sort((a, b) => {
      return new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime();
    });

    return records;
  }

  /**
   * Find the first workspace linked to a story ID. Returns null if not found.
   */
  async findByStoryId(storyId: string): Promise<WorkspaceRecord | null> {
    const store = await this.load();

    for (const record of Object.values(store.workspaces)) {
      if (record.storyId === storyId) {
        return record;
      }
    }

    return null;
  }

  /**
   * Update lastAccessedAt to the current timestamp.
   */
  async touch(id: string): Promise<void> {
    await this.update(id, { lastAccessedAt: new Date().toISOString() });
  }

  /**
   * Return workspaces that should be cleaned up based on retention policy.
   * Only includes active/paused workspaces older than retentionDays.
   */
  async checkRetention(retentionDays: number): Promise<WorkspaceRecord[]> {
    const store = await this.load();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const candidates = Object.values(store.workspaces).filter((record) => {
      // Only consider active and paused workspaces
      if (record.status !== 'active' && record.status !== 'paused') {
        return false;
      }

      // Check if lastAccessedAt is older than cutoff
      return new Date(record.lastAccessedAt) < cutoffDate;
    });

    return candidates;
  }
}
