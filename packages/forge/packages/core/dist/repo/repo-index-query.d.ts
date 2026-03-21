import type { RepoIndexEntry } from '../models/repo-index.js';
/**
 * Query helper for the RepoIndex. Provides methods to search and filter repositories.
 */
export declare class RepoIndexQuery {
    private readonly repos;
    constructor(repos: RepoIndexEntry[]);
    /**
     * Find a repository by name (case-insensitive).
     */
    findByName(name: string): RepoIndexEntry | null;
    /**
     * Find a repository by remote URL (with normalization).
     */
    findByRemoteUrl(url: string): RepoIndexEntry | null;
    /**
     * Search repositories by partial name or path match.
     */
    search(query: string): RepoIndexEntry[];
    /**
     * List all repositories, sorted by name.
     */
    listAll(): RepoIndexEntry[];
    /**
     * Get a repository by local path.
     */
    getByPath(localPath: string): RepoIndexEntry | null;
}
//# sourceMappingURL=repo-index-query.d.ts.map