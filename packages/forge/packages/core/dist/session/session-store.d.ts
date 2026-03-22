import type { SessionRecord, SessionStore } from '../models/session.js';
/**
 * Persistent store for code session records.
 *
 * Backed by a single JSON file (default: ~/Horus/data/config/sessions.json).
 * All mutations read → transform → write atomically (within single-process limits).
 */
export declare class SessionStoreManager {
    private readonly storePath;
    constructor(storePath: string);
    /**
     * Load all sessions from disk.
     * Returns an empty store if the file does not exist.
     */
    load(): Promise<SessionStore>;
    /**
     * Persist the store to disk, creating parent directories as needed.
     */
    save(store: SessionStore): Promise<void>;
    /**
     * Add a new session record.
     */
    add(record: SessionRecord): Promise<void>;
    /**
     * Find the first active session for a given workItem and repo combination.
     * "Active" = the session directory still exists on disk.
     */
    findByWorkItem(workItem: string, repo: string): Promise<SessionRecord | null>;
    /**
     * Count how many sessions exist for a workItem+repo pair.
     * Used to determine the next agent slot number.
     */
    countByWorkItem(workItem: string, repo: string): Promise<number>;
    /**
     * List all sessions.
     */
    list(): Promise<SessionRecord[]>;
    /**
     * Delete a session by sessionId.
     */
    remove(sessionId: string): Promise<void>;
}
//# sourceMappingURL=session-store.d.ts.map