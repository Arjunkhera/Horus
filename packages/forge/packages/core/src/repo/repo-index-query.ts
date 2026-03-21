import type { RepoIndexEntry } from '../models/repo-index.js';
import { normalizeGitUrl } from './url-utils.js';

/**
 * Query helper for the RepoIndex. Provides methods to search and filter repositories.
 */
export class RepoIndexQuery {
  constructor(private readonly repos: RepoIndexEntry[]) {}

  /**
   * Find a repository by name (case-insensitive).
   */
  findByName(name: string): RepoIndexEntry | null {
    return this.repos.find(r => r.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  /**
   * Find a repository by remote URL (with normalization).
   */
  findByRemoteUrl(url: string): RepoIndexEntry | null {
    const normalized = normalizeGitUrl(url);
    return this.repos.find(r => r.remoteUrl && normalizeGitUrl(r.remoteUrl) === normalized) ?? null;
  }

  /**
   * Search repositories by partial name or path match.
   */
  search(query: string): RepoIndexEntry[] {
    const q = query.toLowerCase();
    return this.repos
      .filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.localPath.toLowerCase().includes(q) ||
        (r.remoteUrl?.toLowerCase().includes(q) ?? false)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List all repositories, sorted by name.
   */
  listAll(): RepoIndexEntry[] {
    return [...this.repos].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a repository by local path.
   */
  getByPath(localPath: string): RepoIndexEntry | null {
    return this.repos.find(r => r.localPath === localPath) ?? null;
  }
}
