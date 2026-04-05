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
    /** Remote name to fetch from and use as worktree base, e.g. "origin" or "upstream" */
    'default-remote'?: string;
  };
}

export class VaultClient {
  constructor(private readonly baseUrl: string) {}

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
  async fetchRepoProfile(repoName: string): Promise<VaultRepoProfile | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/get-page`;
    const body = JSON.stringify({ id: `repos/${repoName}.md` });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as Record<string, unknown>;

      // Vault returns a PageFull — extract hosting/workflow from the
      // raw frontmatter fields embedded in the response.
      const hosting = data['hosting'] as VaultRepoProfile['hosting'] | undefined;
      const workflow = data['workflow'] as VaultRepoProfile['workflow'] | undefined;

      if (!hosting && !workflow) return null;

      return { hosting, workflow };
    } catch {
      // Network error, timeout, or parse failure — degrade gracefully
      return null;
    }
  }
}

/**
 * Extract (hostname, org) from a git remote URL.
 *
 * Handles HTTPS and SSH formats:
 *   https://github.com/Arjunkhera/Vault.git  →  { hostname: 'github.com', org: 'Arjunkhera' }
 *   git@github.com:Arjunkhera/Vault.git      →  { hostname: 'github.com', org: 'Arjunkhera' }
 */
export function extractHostingFromUrl(remoteUrl: string | null): { hostname: string; org: string } {
  if (!remoteUrl) return { hostname: 'github.com', org: '' };

  // SSH: git@github.com:org/repo.git
  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\//);
  if (sshMatch) return { hostname: sshMatch[1], org: sshMatch[2] };

  // HTTPS: https://github.com/org/repo.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/([^/]+)\//);
  if (httpsMatch) return { hostname: httpsMatch[1], org: httpsMatch[2] };

  return { hostname: 'github.com', org: '' };
}
