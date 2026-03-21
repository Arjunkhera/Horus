import type { RepoIndex } from '../models/repo-index.js';
/**
 * Scan multiple paths for git repositories and merge with existing index if provided.
 * Repositories found in the current scan replace those in the existing index.
 * Repositories in the existing index that are in paths NOT covered by the current scan are preserved.
 */
export declare function scan(scanPaths: string[], existingIndex?: RepoIndex): Promise<RepoIndex>;
//# sourceMappingURL=repo-scanner.d.ts.map