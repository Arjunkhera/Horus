"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoIndexQuery = void 0;
const url_utils_js_1 = require("./url-utils.js");
/**
 * Query helper for the RepoIndex. Provides methods to search and filter repositories.
 */
class RepoIndexQuery {
    repos;
    constructor(repos) {
        this.repos = repos;
    }
    /**
     * Find a repository by name (case-insensitive).
     */
    findByName(name) {
        return this.repos.find(r => r.name.toLowerCase() === name.toLowerCase()) ?? null;
    }
    /**
     * Find a repository by remote URL (with normalization).
     */
    findByRemoteUrl(url) {
        const normalized = (0, url_utils_js_1.normalizeGitUrl)(url);
        return this.repos.find(r => r.remoteUrl && (0, url_utils_js_1.normalizeGitUrl)(r.remoteUrl) === normalized) ?? null;
    }
    /**
     * Search repositories by partial name or path match.
     */
    search(query) {
        const q = query.toLowerCase();
        return this.repos
            .filter(r => r.name.toLowerCase().includes(q) ||
            r.localPath.toLowerCase().includes(q) ||
            (r.remoteUrl?.toLowerCase().includes(q) ?? false))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    /**
     * List all repositories, sorted by name.
     */
    listAll() {
        return [...this.repos].sort((a, b) => a.name.localeCompare(b.name));
    }
    /**
     * Get a repository by local path.
     */
    getByPath(localPath) {
        return this.repos.find(r => r.localPath === localPath) ?? null;
    }
}
exports.RepoIndexQuery = RepoIndexQuery;
//# sourceMappingURL=repo-index-query.js.map