"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgeSearchClient = void 0;
const search_1 = require("@horus/search");
// ── ForgeSearchClient ─────────────────────────────────────────────────────────
const COLLECTION = 'horus_documents';
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
class ForgeSearchClient {
    ts;
    constructor(ts) {
        this.ts = ts;
    }
    /**
     * Create a ForgeSearchClient from environment variables.
     * Returns null when TYPESENSE_HOST is not set (Typesense not configured).
     */
    static create() {
        if (!process.env.TYPESENSE_HOST)
            return null;
        try {
            const config = (0, search_1.loadSearchConfig)();
            const ts = (0, search_1.createClient)(config);
            return new ForgeSearchClient(ts);
        }
        catch {
            return null;
        }
    }
    // ── Indexing ────────────────────────────────────────────────────────────────
    /**
     * Upsert a repo index entry into horus_documents.
     * Uses the repo name as the document ID (prefixed with "forge-repo-").
     */
    async indexRepo(entry) {
        const doc = {
            id: `forge-repo-${entry.name}`,
            source: 'forge',
            source_type: 'repo',
            title: entry.name,
            body: [entry.localPath, entry.remoteUrl ?? '', entry.language ?? '']
                .filter(Boolean)
                .join(' '),
            tags: [
                ...(entry.language ? [entry.language] : []),
                ...(entry.framework ? [entry.framework] : []),
            ],
            local_path: entry.localPath,
            remote_url: entry.remoteUrl ?? undefined,
            language: entry.language ?? undefined,
            default_branch: entry.defaultBranch,
            created_at: Math.floor(new Date(entry.lastScannedAt).getTime() / 1000),
            modified_at: Math.floor(new Date(entry.lastScannedAt).getTime() / 1000),
        };
        try {
            await this.ts.collections(COLLECTION).documents().upsert(doc);
        }
        catch {
            // Typesense unavailable or schema mismatch — degrade silently
        }
    }
    /**
     * Upsert a batch of repo entries (used on full scan).
     */
    async indexRepos(entries) {
        for (const entry of entries) {
            await this.indexRepo(entry);
        }
    }
    /**
     * Upsert an artifact (skill, plugin, agent) into horus_documents.
     * Uses "forge-<type>-<id>" as the document ID.
     */
    async indexArtifact(meta, type) {
        const doc = {
            id: `forge-${type}-${meta.id}`,
            source: 'forge',
            source_type: type,
            title: meta.name,
            body: meta.description,
            tags: meta.tags ?? [],
            created_at: Math.floor(Date.now() / 1000),
            modified_at: Math.floor(Date.now() / 1000),
        };
        try {
            await this.ts.collections(COLLECTION).documents().upsert(doc);
        }
        catch {
            // Degrade silently
        }
    }
    // ── Search ──────────────────────────────────────────────────────────────────
    /**
     * Search for repos using Typesense typo tolerance.
     * Returns an array of matching repo names, ordered by relevance.
     * Returns null on error (caller should fall back to substring matching).
     */
    async searchRepos(query) {
        try {
            const result = await this.ts.collections(COLLECTION).documents().search({
                q: query,
                query_by: 'title,body',
                filter_by: 'source:forge && source_type:repo',
                per_page: 10,
                num_typos: 2,
                typo_tokens_threshold: 1,
            });
            const hits = (result.hits ?? []);
            return hits.map((h) => h.document.title);
        }
        catch {
            return null;
        }
    }
    /**
     * Search for artifacts (skills, plugins, agents) using Typesense.
     * Returns null on error (caller should fall back to in-memory scoring).
     */
    async searchArtifacts(query, type) {
        try {
            const typeFilter = type
                ? `source:forge && source_type:${type}`
                : 'source:forge && source_type:[skill,plugin,agent]';
            const result = await this.ts.collections(COLLECTION).documents().search({
                q: query,
                query_by: 'title,body,tags',
                filter_by: typeFilter,
                per_page: 20,
                num_typos: 2,
                typo_tokens_threshold: 1,
            });
            const hits = (result.hits ?? []);
            return hits.map((h) => h.document);
        }
        catch {
            return null;
        }
    }
}
exports.ForgeSearchClient = ForgeSearchClient;
//# sourceMappingURL=forge-search-client.js.map