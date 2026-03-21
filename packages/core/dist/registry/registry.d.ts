import type { DataAdapter } from '../adapters/types.js';
import type { ArtifactType, ArtifactBundle, ArtifactRef, ArtifactSummary, SearchResult } from '../models/index.js';
/**
 * Search/query interface over a DataAdapter.
 * Handles text matching, tag filtering, and result ranking.
 *
 * @example
 * const registry = new Registry(new FilesystemAdapter('./registry'));
 * const results = await registry.search('developer');
 * const skill = await registry.get({ type: 'skill', id: 'developer', version: '1.0.0' });
 */
export declare class Registry {
    private readonly adapter;
    constructor(adapter: DataAdapter);
    /**
     * Search for artifacts matching the query.
     * Scores: exact id match (100) > name contains (75) > description contains (50) > tag match (25).
     * Results are sorted by score descending.
     *
     * @param query - Text to search for (case-insensitive substring matching)
     * @param type - Optional artifact type filter
     */
    search(query: string, type?: ArtifactType): Promise<SearchResult[]>;
    /**
     * Get a single artifact bundle by ref.
     * @throws {ArtifactNotFoundError} if not found
     */
    get(ref: ArtifactRef): Promise<ArtifactBundle>;
    /**
     * List all artifacts, optionally filtered by type.
     * Returns lightweight summaries (no content).
     */
    list(type?: ArtifactType): Promise<ArtifactSummary[]>;
    /**
     * Publish an artifact bundle to the registry.
     * Delegates to the underlying adapter.
     */
    publish(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void>;
    private score;
}
//# sourceMappingURL=registry.d.ts.map