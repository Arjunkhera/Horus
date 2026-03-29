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
   * Space-separated terms are OR-matched: a repo is included if ANY term matches
   * its name, localPath, or remoteUrl (case-insensitive).
   */
  search(query: string): RepoIndexEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.repos
      .filter(r => {
        const name = r.name.toLowerCase();
        const path = r.localPath.toLowerCase();
        const url = r.remoteUrl?.toLowerCase() ?? '';
        return terms.some(t => name.includes(t) || path.includes(t) || url.includes(t));
      })
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
