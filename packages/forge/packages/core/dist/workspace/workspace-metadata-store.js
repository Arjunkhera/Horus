"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceMetadataStore = exports.WORKSPACES_FILE = void 0;
exports.generateWorkspaceId = generateWorkspaceId;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const workspace_record_js_1 = require("../models/workspace-record.js");
exports.WORKSPACES_FILE = 'workspaces.json';
function generateWorkspaceId() {
    return `ws-${(0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 8)}`;
}
class WorkspaceMetadataStore {
    storePath;
    constructor(storePath = path_1.default.join(process.env.HOME ?? '~', 'Horus', 'data', 'config', exports.WORKSPACES_FILE)) {
        this.storePath = storePath;
    }
    // For testing — override store path
    withPath(storePath) {
        this.storePath = storePath;
        return this;
    }
    /**
     * Load workspace store from disk. Returns empty store if file missing.
     */
    async load() {
        try {
            const raw = await fs_1.promises.readFile(this.storePath, 'utf-8');
            return workspace_record_js_1.WorkspaceStoreSchema.parse(JSON.parse(raw));
        }
        catch (err) {
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
    async save(store) {
        await fs_1.promises.mkdir(path_1.default.dirname(this.storePath), { recursive: true });
        await fs_1.promises.writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
    }
    /**
     * Add a new workspace record. Throws if ID already exists.
     */
    async create(record) {
        // Validate the record
        workspace_record_js_1.WorkspaceRecordSchema.parse(record);
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
    async get(id) {
        const store = await this.load();
        return store.workspaces[id] ?? null;
    }
    /**
     * Update a workspace record by merging a patch. Throws if ID not found.
     */
    async update(id, patch) {
        const store = await this.load();
        const existing = store.workspaces[id];
        if (!existing) {
            throw new Error(`Workspace with ID "${id}" not found`);
        }
        const updated = { ...existing, ...patch };
        workspace_record_js_1.WorkspaceRecordSchema.parse(updated);
        store.workspaces[id] = updated;
        await this.save(store);
        return updated;
    }
    /**
     * Delete a workspace record by ID. Throws if ID not found.
     */
    async delete(id) {
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
    async list(filter) {
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
    async findByStoryId(storyId) {
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
    async touch(id) {
        await this.update(id, { lastAccessedAt: new Date().toISOString() });
    }
    /**
     * Return workspaces that should be cleaned up based on retention policy.
     * Only includes active/paused workspaces older than retentionDays.
     */
    async checkRetention(retentionDays) {
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
exports.WorkspaceMetadataStore = WorkspaceMetadataStore;
//# sourceMappingURL=workspace-metadata-store.js.map