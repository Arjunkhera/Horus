"use strict";
/**
 * Lightweight HTTP client for reading Vault repo profiles.
 *
 * Used by ForgeCore.repoWorkflow() to fetch the hosting and workflow
 * metadata stored in a Vault repo-profile page, before falling back
 * to auto-detection from local git remotes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultClient = void 0;
exports.extractHostingFromUrl = extractHostingFromUrl;
class VaultClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    /**
     * Fetch the repo profile for a named repository from Vault.
     *
     * Calls GET /get-page with id=repos/{repoName}.md and parses the
     * hosting and workflow fields from the returned page metadata.
     *
     * Returns null if:
     * - Vault is unreachable
     * - The page does not exist
     * - The page has no hosting/workflow fields
     */
    async fetchRepoProfile(repoName) {
        const url = `${this.baseUrl.replace(/\/$/, '')}/get-page`;
        const body = JSON.stringify({ id: `repos/${repoName}.md` });
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                return null;
            const data = await res.json();
            // Vault returns a PageFull — extract hosting/workflow from the
            // raw frontmatter fields embedded in the response.
            const hosting = data['hosting'];
            const workflow = data['workflow'];
            if (!hosting && !workflow)
                return null;
            return { hosting, workflow };
        }
        catch {
            // Network error, timeout, or parse failure — degrade gracefully
            return null;
        }
    }
}
exports.VaultClient = VaultClient;
/**
 * Extract (hostname, org) from a git remote URL.
 *
 * Handles HTTPS and SSH formats:
 *   https://github.com/Arjunkhera/Vault.git  →  { hostname: 'github.com', org: 'Arjunkhera' }
 *   git@github.com:Arjunkhera/Vault.git      →  { hostname: 'github.com', org: 'Arjunkhera' }
 */
function extractHostingFromUrl(remoteUrl) {
    if (!remoteUrl)
        return { hostname: 'github.com', org: '' };
    // SSH: git@github.com:org/repo.git
    const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\//);
    if (sshMatch)
        return { hostname: sshMatch[1], org: sshMatch[2] };
    // HTTPS: https://github.com/org/repo.git
    const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/([^/]+)\//);
    if (httpsMatch)
        return { hostname: httpsMatch[1], org: httpsMatch[2] };
    return { hostname: 'github.com', org: '' };
}
//# sourceMappingURL=vault-client.js.map