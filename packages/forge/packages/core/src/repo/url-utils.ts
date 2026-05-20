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
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();
  
  // Convert git@host:org/repo to host/org/repo
  if (normalized.startsWith('git@')) {
    normalized = normalized.slice(4).replace(':', '/');
  } else {
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

/**
 * Repo coordinate used to derive the Horus-owned managed-clone path
 * `~/Horus/data/repos/{host}/{org}/{name}/` (decision 349fdd96).
 */
export interface RepoCoordinate {
  /** Normalized host: lowercased, port stripped. e.g. "github.com" */
  host: string;
  /** Owner segment(s) between host and the final name. Joined with "/" to
   *  keep nested GitLab groups (group/subgroup) deterministic. */
  org: string;
  /** Final repository name segment. */
  name: string;
}

/**
 * Normalize the host segment of a git remote URL for use as a filesystem
 * path component. Lowercases and strips any port. The `{host}` segment
 * resolves the D5 enterprise-host collision class
 * (github.com vs github.adobe.com vs gitlab) — see decision 349fdd96.
 */
export function normalizeHost(url: string): string {
  const canonical = normalizeGitUrl(url); // host/org/.../name
  const host = canonical.split('/')[0] ?? '';
  // Strip port (e.g. "github.example.com:8443" → "github.example.com")
  return host.split(':')[0]!.toLowerCase();
}

/**
 * Derive the {host, org, name} coordinate from any git remote URL.
 * Deterministic and dependency-free so the managed-clone path is computable
 * straight from registry metadata with no lookup (decision 349fdd96).
 *
 * Throws if the URL does not contain at least host + one path segment + name.
 */
export function deriveRepoCoordinate(url: string): RepoCoordinate {
  const canonical = normalizeGitUrl(url); // host/org/.../name
  const segments = canonical.split('/').filter(Boolean);
  if (segments.length < 3) {
    throw new Error(
      `Cannot derive repo coordinate from URL "${url}" — expected host/org/name, got "${canonical}"`,
    );
  }
  const host = segments[0]!.split(':')[0]!.toLowerCase();
  const name = segments[segments.length - 1]!;
  const org = segments.slice(1, -1).join('/');
  return { host, org, name };
}
