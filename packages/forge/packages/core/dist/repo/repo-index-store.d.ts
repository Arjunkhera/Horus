import { type RepoIndex } from '../models/repo-index.js';
/**
 * Save a RepoIndex to disk as JSON.
 * Creates the directory if it doesn't exist.
 */
export declare function saveRepoIndex(index: RepoIndex, indexPath: string): Promise<void>;
/**
 * Load a RepoIndex from disk.
 * Returns null if the file doesn't exist.
 * Returns null and logs a warning if the file is malformed.
 */
export declare function loadRepoIndex(indexPath: string): Promise<RepoIndex | null>;
//# sourceMappingURL=repo-index-store.d.ts.map