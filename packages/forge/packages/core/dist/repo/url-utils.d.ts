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
export declare function normalizeGitUrl(url: string): string;
//# sourceMappingURL=url-utils.d.ts.map