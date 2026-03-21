/**
 * Lightweight HTTP client for reading Vault repo profiles.
 *
 * Used by ForgeCore.repoWorkflow() to fetch the hosting and workflow
 * metadata stored in a Vault repo-profile page, before falling back
 * to auto-detection from local git remotes.
 */
export interface VaultRepoProfile {
    hosting?: {
        hostname?: string;
        org?: string;
    };
    workflow?: {
        strategy?: string;
        'default-branch'?: string;
        'pr-target'?: string;
        'branch-convention'?: string;
    };
}
export declare class VaultClient {
    private readonly baseUrl;
    constructor(baseUrl: string);
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
    fetchRepoProfile(repoName: string): Promise<VaultRepoProfile | null>;
}
/**
 * Extract (hostname, org) from a git remote URL.
 *
 * Handles HTTPS and SSH formats:
 *   https://github.com/Arjunkhera/Vault.git  →  { hostname: 'github.com', org: 'Arjunkhera' }
 *   git@github.com:Arjunkhera/Vault.git      →  { hostname: 'github.com', org: 'Arjunkhera' }
 */
export declare function extractHostingFromUrl(remoteUrl: string | null): {
    hostname: string;
    org: string;
};
//# sourceMappingURL=vault-client.d.ts.map