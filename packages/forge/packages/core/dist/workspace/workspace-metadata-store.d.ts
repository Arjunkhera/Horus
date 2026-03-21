import { type WorkspaceRecord, type WorkspaceStore, type WorkspaceStatus } from '../models/workspace-record.js';
export declare const WORKSPACES_FILE = "workspaces.json";
export declare function generateWorkspaceId(): string;
export declare class WorkspaceMetadataStore {
    private storePath;
    constructor(storePath?: string);
    withPath(storePath: string): WorkspaceMetadataStore;
    /**
     * Load workspace store from disk. Returns empty store if file missing.
     */
    load(): Promise<WorkspaceStore>;
    /**
     * Save workspace store to disk. Creates directory if needed.
     */
    save(store: WorkspaceStore): Promise<void>;
    /**
     * Add a new workspace record. Throws if ID already exists.
     */
    create(record: WorkspaceRecord): Promise<void>;
    /**
     * Fetch a workspace record by ID. Returns null if not found.
     */
    get(id: string): Promise<WorkspaceRecord | null>;
    /**
     * Update a workspace record by merging a patch. Throws if ID not found.
     */
    update(id: string, patch: Partial<WorkspaceRecord>): Promise<WorkspaceRecord>;
    /**
     * Delete a workspace record by ID. Throws if ID not found.
     */
    delete(id: string): Promise<void>;
    /**
     * List all workspace records, optionally filtered by status.
     * Returns sorted by lastAccessedAt descending.
     */
    list(filter?: {
        status?: WorkspaceStatus;
    }): Promise<WorkspaceRecord[]>;
    /**
     * Find the first workspace linked to a story ID. Returns null if not found.
     */
    findByStoryId(storyId: string): Promise<WorkspaceRecord | null>;
    /**
     * Update lastAccessedAt to the current timestamp.
     */
    touch(id: string): Promise<void>;
    /**
     * Return workspaces that should be cleaned up based on retention policy.
     * Only includes active/paused workspaces older than retentionDays.
     */
    checkRetention(retentionDays: number): Promise<WorkspaceRecord[]>;
}
//# sourceMappingURL=workspace-metadata-store.d.ts.map