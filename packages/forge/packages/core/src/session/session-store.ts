import { promises as fs } from 'fs';
import path from 'path';
import type { SessionRecord, SessionStore } from '../models/session.js';
import { SessionStoreSchema } from '../models/session.js';

/**
 * Persistent store for code session records.
 *
 * Backed by a single JSON file (default: ~/Horus/data/config/sessions.json).
 * All mutations read → transform → write atomically (within single-process limits).
 */
export class SessionStoreManager {
  constructor(private readonly storePath: string) {}

  /**
   * Load all sessions from disk.
   * Returns an empty store if the file does not exist.
   */
  async load(): Promise<SessionStore> {
    try {
      const raw = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return SessionStoreSchema.parse(parsed);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { version: '1', sessions: [] };
      }
      throw err;
    }
  }

  /**
   * Persist the store to disk, creating parent directories as needed.
   */
  async save(store: SessionStore): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  /**
   * Add a new session record.
   */
  async add(record: SessionRecord): Promise<void> {
    const store = await this.load();
    store.sessions.push(record);
    await this.save(store);
  }

  /**
   * Find the first active session for a given workItem and repo combination.
   * "Active" = the session directory still exists on disk.
   */
  async findByWorkItem(workItem: string, repo: string): Promise<SessionRecord | null> {
    const store = await this.load();
    const matches = store.sessions.filter(
      s => s.workItem === workItem && s.repo === repo,
    );
    // Return the lowest-slot session (primary agent)
    matches.sort((a, b) => a.agentSlot - b.agentSlot);
    return matches[0] ?? null;
  }

  /**
   * Count how many sessions exist for a workItem+repo pair.
   * Used to determine the next agent slot number.
   */
  async countByWorkItem(workItem: string, repo: string): Promise<number> {
    const store = await this.load();
    return store.sessions.filter(
      s => s.workItem === workItem && s.repo === repo,
    ).length;
  }

  /**
   * List all sessions.
   */
  async list(): Promise<SessionRecord[]> {
    const store = await this.load();
    return store.sessions;
  }

  /**
   * Delete a session by sessionId.
   */
  async remove(sessionId: string): Promise<void> {
    const store = await this.load();
    store.sessions = store.sessions.filter(s => s.sessionId !== sessionId);
    await this.save(store);
  }
}
