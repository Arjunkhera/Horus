import type { RepoIndexEntry } from '../models/repo-index.js';
import type { ArtifactMeta, ArtifactType } from '../models/shared-types.js';
/**
 * A Typesense search hit for a repo or artifact document.
 */
export interface ForgeSearchHit {
    id: string;
    source_type: string;
    title: string;
    body: string;
    tags: string[];
    /** Present on repo documents */
    local_path?: string;
    remote_url?: string;
    language?: string;
    default_branch?: string;
}
/**
 * Typesense integration for Forge. Indexes repos and artifacts into the shared
 * `horus_documents` collection and provides fuzzy search over them.
 *
 * All public methods degrade gracefully: if Typesense is unavailable or returns
 * an error, they return null/empty rather than throwing.
 *
 * Usage:
 *   const client = ForgeSearchClient.create();
 *   if (client) {
 *     await client.indexRepo(entry);
 *     const names = await client.searchRepos('horus');
 *   }
 */
export declare class ForgeSearchClient {
    private readonly ts;
    private constructor();
    /**
     * Create a ForgeSearchClient from environment variables.
     * Returns null when TYPESENSE_HOST is not set (Typesense not configured).
     */
    static create(): ForgeSearchClient | null;
    /**
     * Upsert a repo index entry into horus_documents.
     * Uses the repo name as the document ID (prefixed with "forge-repo-").
     */
    indexRepo(entry: RepoIndexEntry): Promise<void>;
    /**
     * Upsert a batch of repo entries (used on full scan).
     */
    indexRepos(entries: RepoIndexEntry[]): Promise<void>;
    /**
     * Upsert an artifact (skill, plugin, agent) into horus_documents.
     * Uses "forge-<type>-<id>" as the document ID.
     */
    indexArtifact(meta: ArtifactMeta, type: ArtifactType): Promise<void>;
    /**
     * Search for repos using Typesense typo tolerance.
     * Returns an array of matching repo names, ordered by relevance.
     * Returns null on error (caller should fall back to substring matching).
     */
    searchRepos(query: string): Promise<string[] | null>;
    /**
     * Search for artifacts (skills, plugins, agents) using Typesense.
     * Returns null on error (caller should fall back to in-memory scoring).
     */
    searchArtifacts(query: string, type?: ArtifactType): Promise<ForgeSearchHit[] | null>;
}
//# sourceMappingURL=forge-search-client.d.ts.map