"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionStoreManager = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const session_js_1 = require("../models/session.js");
/**
 * Persistent store for code session records.
 *
 * Backed by a single JSON file (default: ~/Horus/data/config/sessions.json).
 * All mutations read → transform → write atomically (within single-process limits).
 */
class SessionStoreManager {
    storePath;
    constructor(storePath) {
        this.storePath = storePath;
    }
    /**
     * Load all sessions from disk.
     * Returns an empty store if the file does not exist.
     */
    async load() {
        try {
            const raw = await fs_1.promises.readFile(this.storePath, 'utf-8');
            const parsed = JSON.parse(raw);
            return session_js_1.SessionStoreSchema.parse(parsed);
        }
        catch (err) {
            if (err?.code === 'ENOENT') {
                return { version: '1', sessions: [] };
            }
            throw err;
        }
    }
    /**
     * Persist the store to disk, creating parent directories as needed.
     */
    async save(store) {
        await fs_1.promises.mkdir(path_1.default.dirname(this.storePath), { recursive: true });
        await fs_1.promises.writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
    }
    /**
     * Add a new session record.
     */
    async add(record) {
        const store = await this.load();
        store.sessions.push(record);
        await this.save(store);
    }
    /**
     * Find the first active session for a given workItem and repo combination.
     * "Active" = the session directory still exists on disk.
     */
    async findByWorkItem(workItem, repo) {
        const store = await this.load();
        const matches = store.sessions.filter(s => s.workItem === workItem && s.repo === repo);
        // Return the lowest-slot session (primary agent)
        matches.sort((a, b) => a.agentSlot - b.agentSlot);
        return matches[0] ?? null;
    }
    /**
     * Count how many sessions exist for a workItem+repo pair.
     * Used to determine the next agent slot number.
     */
    async countByWorkItem(workItem, repo) {
        const store = await this.load();
        return store.sessions.filter(s => s.workItem === workItem && s.repo === repo).length;
    }
    /**
     * List all sessions.
     */
    async list() {
        const store = await this.load();
        return store.sessions;
    }
    /**
     * List sessions filtered by optional repo and/or workItem.
     * Both filters are AND-combined when provided.
     */
    async listFiltered(opts) {
        const store = await this.load();
        return store.sessions.filter(s => {
            if (opts.repo && s.repo.toLowerCase() !== opts.repo.toLowerCase())
                return false;
            if (opts.workItem && s.workItem !== opts.workItem)
                return false;
            return true;
        });
    }
    /**
     * Update the lastModified timestamp of a session in place.
     */
    async touch(sessionId) {
        const store = await this.load();
        const idx = store.sessions.findIndex(s => s.sessionId === sessionId);
        if (idx !== -1) {
            store.sessions[idx] = { ...store.sessions[idx], lastModified: new Date().toISOString() };
            await this.save(store);
        }
    }
    /**
     * Count total sessions across all work items.
     */
    async count() {
        const store = await this.load();
        return store.sessions.length;
    }
    /**
     * Delete a session by sessionId.
     */
    async remove(sessionId) {
        const store = await this.load();
        store.sessions = store.sessions.filter(s => s.sessionId !== sessionId);
        await this.save(store);
    }
}
exports.SessionStoreManager = SessionStoreManager;
//# sourceMappingURL=session-store.js.map