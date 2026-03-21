"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGitUrl = normalizeGitUrl;
/**
 * Normalize a git remote URL to a canonical form for comparison.
 * Strips protocol, auth, and .git suffix.
 *
 * Examples:
 *   git@github.com:org/repo.git → github.com/org/repo
 *   https://github.com/org/repo.git → github.com/org/repo
 *   https://github.com/org/repo → github.com/org/repo
 *   https://user:pass@github.com/org/repo.git → github.com/org/repo
 */
function normalizeGitUrl(url) {
    let normalized = url.trim();
    // Convert git@host:org/repo to host/org/repo
    if (normalized.startsWith('git@')) {
        normalized = normalized.slice(4).replace(':', '/');
    }
    else {
        // Strip protocol (https://, http://, ssh://, git://)
        normalized = normalized.replace(/^[a-z]+:\/\//, '');
        // Strip auth (user:pass@)
        normalized = normalized.replace(/^[^@]+@/, '');
    }
    // Strip .git suffix
    if (normalized.endsWith('.git')) {
        normalized = normalized.slice(0, -4);
    }
    return normalized;
}
//# sourceMappingURL=url-utils.js.map