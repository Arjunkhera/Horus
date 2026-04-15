import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'node:crypto';
import type { RepoIndexEntry, RepoIndexWorkflow } from '../models/repo-index.js';
import type { SessionRecord, SessionWorkflow, RepoSource } from '../models/session.js';
import type { GlobalConfig } from '../models/global-config.js';
import { SessionStoreManager } from '../session/session-store.js';
import { ForgeError } from '../adapters/errors.js';
import { installEnforcementHooks } from './git-enforcement.js';
import { VaultClient } from '../vault/vault-client.js';

const execFileAsync = promisify(execFile);

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Inline workflow parameter — used when the client provides workflow info
 * directly (non-Claude-Code clients, first-time confirmation).
 */
export interface WorkflowInput {
  type: 'owner' | 'fork' | 'contributor';
  upstream?: string;
  fork?: string;
  pushTo: string;
  prTarget: { repo: string; branch: string };
  branchPattern?: string;
  commitFormat?: string;
}

export interface RepoDevelopOptions {
  /** Repository name (looked up in repo index) */
  repo: string;
  /** Work item ID or slug — used to namespace the session path */
  workItem: string;
  /** Optional branch name. Auto-generated from workItem if omitted. */
  branch?: string;
  /**
   * Inline workflow — saves to repo metadata and proceeds.
   * If omitted AND repo has no saved workflow, returns needs_workflow_confirmation.
   */
  workflow?: WorkflowInput;
  /**
   * Inline default remote — provided by the caller when responding to a
   * needs_remote_confirmation response. Saved to the repo index for future calls.
   */
  defaultRemote?: string;
  /**
   * Local path to disambiguate when multiple repos share the same name.
   * Provided by the caller when responding to a needs_repo_disambiguation response.
   */
  localPath?: string;
}

/** Session created or resumed successfully */
export interface RepoDevelopResult {
  status: 'created' | 'resumed';
  sessionId: string;
  sessionPath: string;
  hostSessionPath?: string;
  branch: string;
  baseBranch: string;
  repo: string;
  repoSource: RepoSource;
  workflow: SessionWorkflow;
  agentSlot: number;
  /**
   * Non-blocking warning, e.g. when the max_sessions ceiling is reached.
   * The session is created regardless; caller should surface this to the user.
   */
  warning?: string;
}

/** Workflow not yet confirmed for this repo */
export interface RepoDevelopNeedsConfirmation {
  status: 'needs_workflow_confirmation';
  detected: {
    type: 'owner' | 'fork' | 'contributor';
    upstream?: string;
    fork?: string;
    pushTo: string;
    prTarget: { repo: string; branch: string };
  };
  message: string;
}

/**
 * Default remote not yet configured for this repo.
 * The caller should present availableRemotes to the user, collect their choice,
 * and re-call forge_develop with the defaultRemote parameter set.
 * The chosen remote will be saved to the repo index for future calls.
 */
export interface RepoDevelopNeedsRemoteConfirmation {
  status: 'needs_remote_confirmation';
  availableRemotes: string[];
  message: string;
}

/**
 * Multiple repos share the same name in the index.
 * The caller should present matches to the user, collect their choice,
 * and re-call forge_develop with the localPath parameter set.
 */
export interface RepoDevelopNeedsRepoDisambiguation {
  status: 'needs_repo_disambiguation';
  matches: Array<{
    name: string;
    localPath: string;
    remoteUrl: string | null;
    defaultBranch: string;
  }>;
  message: string;
}

export type RepoDevelopResponse =
  | RepoDevelopResult
  | RepoDevelopNeedsConfirmation
  | RepoDevelopNeedsRemoteConfirmation
  | RepoDevelopNeedsRepoDisambiguation;

// ─── Internal helpers ────────────────────────────────────────────────────────

async function runGit(args: string[], cwd: string, timeout = 30000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout });
  return stdout.trim();
}

/** Generate a short random ID for sessions, e.g. "sess-ab12cd34" */
function generateSessionId(): string {
  return 'sess-' + randomBytes(4).toString('hex');
}

/**
 * Convert a workItem ID/slug to a filesystem-safe slug.
 * e.g. "2d9c5c7d-3f56-4a61-a197-2530dcc4db0e" → "2d9c5c7d"
 * e.g. "forge-develop-tool" → "forge-develop-tool"
 */
function toSlug(workItem: string): string {
  // If it looks like a UUID, use the first segment
  const uuidMatch = workItem.match(/^([0-9a-f]{8})-/i);
  if (uuidMatch) return uuidMatch[1];
  // Otherwise sanitize
  return workItem.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
}

/**
 * Auto-detect workflow from git remotes.
 * - Has 'upstream' remote → fork workflow
 * - Otherwise → owner (direct push)
 */
async function detectWorkflow(
  localPath: string,
  repoEntry: RepoIndexEntry,
): Promise<WorkflowInput> {
  let remotes: string[] = [];
  try {
    const out = await runGit(['remote', '-v'], localPath, 5000);
    remotes = out.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    // Not a git repo or git not available — fall through to defaults
  }

  const hasUpstream = remotes.some(r => r.startsWith('upstream\t') || r.startsWith('upstream '));
  const defaultBranch = repoEntry.defaultBranch;

  // Derive org/repo from remoteUrl, e.g. git@github.com:Org/Repo.git → Org/Repo
  let prTargetRepo = repoEntry.name;
  if (repoEntry.remoteUrl) {
    const m = repoEntry.remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) prTargetRepo = m[1];
  }

  if (hasUpstream) {
    const upstreamLine = remotes.find(r => r.startsWith('upstream\t') || r.startsWith('upstream '));
    const upstreamUrl = upstreamLine?.split(/\s+/)[1] ?? repoEntry.remoteUrl ?? '';
    return {
      type: 'fork',
      upstream: upstreamUrl,
      fork: repoEntry.remoteUrl ?? undefined,
      pushTo: 'origin',
      prTarget: { repo: prTargetRepo, branch: defaultBranch },
    };
  }

  return {
    type: 'owner',
    pushTo: 'origin',
    prTarget: { repo: prTargetRepo, branch: defaultBranch },
  };
}

/**
 * Clone a repo into the managed pool as a regular clone (not bare).
 * Used for tier-3 resolution when the repo isn't indexed locally,
 * or to create a writable managed clone from a read-only user-tier repo.
 *
 * Uses an atomic rename pattern: clones into a temp directory first, then
 * renames to destPath on success. On failure the temp dir is cleaned up,
 * ensuring destPath is never left in a partial state.
 */
async function cloneToManagedPool(
  sourceUrl: string,
  destPath: string,
): Promise<void> {
  const tmpPath = `${destPath}.tmp.${process.pid}`;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  // Local clones over virtiofs (Podman) are significantly slower than remote
  const timeout = isLocalPath(sourceUrl) ? 300_000 : 120_000;
  const startTime = Date.now();
  try {
    await execFileAsync('git', ['clone', sourceUrl, tmpPath], { timeout });
    await fs.rename(tmpPath, destPath);
  } catch (err: any) {
    await fs.rm(tmpPath, { recursive: true, force: true }).catch(() => {});
    const durationMs = Date.now() - startTime;
    const isTimeout = err.killed === true;
    const detail = err.stderr?.trim() ? ` stderr: ${err.stderr.trim()}` : ` ${err.message}`;
    throw new ForgeError(
      isTimeout ? 'CLONE_TIMEOUT' : 'CLONE_FAILED',
      `Failed to clone ${sourceUrl} to ${destPath} after ${durationMs}ms:${detail}`,
      isTimeout
        ? `Clone timed out after ${durationMs}ms. This may be caused by slow filesystem I/O (e.g. Podman virtiofs). The partial clone has been removed.`
        : 'Check the remote URL and your network/SSH access.',
    );
  }
}

/**
 * Fetch all remotes in a repo. Degrades gracefully if network is unavailable.
 * Returns true if fetch succeeded, false if it failed (with warning logged).
 */
async function fetchRemotes(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['fetch', '--all', '--prune'], {
      cwd: repoPath,
      timeout: 30000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List remote names configured in a repo (e.g. ["origin", "upstream"]).
 * Returns an empty array if git is unavailable or the repo has no remotes.
 */
async function getAvailableRemotes(repoPath: string): Promise<string[]> {
  try {
    const out = await runGit(['remote'], repoPath, 5000);
    return out.split('\n').map(r => r.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve which remote to use as the worktree fetch base.
 *
 * Resolution chain (first match wins):
 * 1. Forge repo registry — repoEntry.default_remote
 * 2. Vault repo profile — workflow.default-remote field
 * 3. Derive from confirmed workflow:
 *    - owner/contributor → workflow.pushTo (is both push and fetch remote)
 *    - fork → match workflow.upstream URL against remotesSnapshot to find remote name
 * 4. null — caller should ask the user and re-call with defaultRemote set
 */
async function resolveDefaultRemote(
  repoEntry: RepoIndexEntry,
  vaultBaseUrl: string | undefined,
  confirmedWorkflow: RepoIndexWorkflow | WorkflowInput | null,
): Promise<string | null> {
  // 1. Forge registry
  if (repoEntry.default_remote) return repoEntry.default_remote;

  // 2. Vault repo profile
  if (vaultBaseUrl) {
    try {
      const client = new VaultClient(vaultBaseUrl);
      const profile = await client.fetchRepoProfile(repoEntry.name);
      const vaultRemote = profile?.workflow?.['default-remote'];
      if (vaultRemote) return vaultRemote;
    } catch {
      // Vault unreachable — degrade gracefully
    }
  }

  // 3. Derive from confirmed workflow
  if (confirmedWorkflow) {
    if (confirmedWorkflow.type !== 'fork') {
      // owner/contributor: pushTo is the single remote for both push and fetch
      return confirmedWorkflow.pushTo;
    }
    // fork: the fetch remote is the upstream, not the fork.
    // Use remotesSnapshot (if saved) to map the upstream URL to its remote name.
    const snapshot = 'remotesSnapshot' in confirmedWorkflow
      ? confirmedWorkflow.remotesSnapshot
      : undefined;
    if (snapshot && confirmedWorkflow.upstream) {
      const remoteName = Object.entries(snapshot)
        .find(([, url]) => url === confirmedWorkflow.upstream)?.[0];
      if (remoteName) return remoteName;
    }
    // fork without a usable snapshot — fall through to ask the user
  }

  // 4. Not found — caller will prompt the user
  return null;
}

/**
 * Ensure we have a writable clone to use as the worktree base.
 *
 * User-tier repos (resolved from scan_paths / repo index) may be mounted
 * read-only (e.g. Docker `:ro` bind mounts). Git worktree creation writes
 * branch ref locks into the base repo's `.git/refs/heads/`, which fails on
 * a read-only filesystem.
 *
 * When the repo was resolved from the user tier, this function ensures a
 * managed clone exists at `managedReposPath/<name>` (always writable) and
 * returns its path. If the repo is already in the managed pool, the
 * original path is returned unchanged.
 */
async function ensureWritableWorktreeBase(
  repoEntry: RepoIndexEntry,
  repoSource: RepoSource,
  managedReposPath: string,
): Promise<{ worktreeBasePath: string; effectiveSource: RepoSource }> {
  if (repoSource !== 'user') {
    return { worktreeBasePath: repoEntry.localPath, effectiveSource: repoSource };
  }

  const managedClonePath = path.join(managedReposPath, repoEntry.name);
  let managedCloneExists = false;
  try {
    await fs.access(managedClonePath);
    // Validate it's a real git repo — guards against partial clones left by
    // prior failures or container restarts mid-clone
    await execFileAsync('git', ['rev-parse', '--git-dir'], {
      cwd: managedClonePath,
      timeout: 5000,
    });
    managedCloneExists = true;
  } catch {
    // Not yet cloned, or clone is corrupt — remove any partial state and start fresh
    await fs.rm(managedClonePath, { recursive: true, force: true }).catch(() => {});
  }

  if (!managedCloneExists) {
    // Clone from the user-tier (read-only) path into the managed pool (rw).
    // cloneToManagedPool accepts any valid git source — a local path works
    // the same as a remote URL for `git clone`.
    await cloneToManagedPool(repoEntry.localPath, managedClonePath);
  }

  return { worktreeBasePath: managedClonePath, effectiveSource: 'managed' };
}

// installEnforcementHooks is imported from git-enforcement.ts (WI-4)

/** Check if a string looks like a local filesystem path (not a remote URL). */
function isLocalPath(url: string): boolean {
  return !url.includes('://') && !url.startsWith('git@');
}

/**
 * Rewrite git worktree pointers so they use host-side paths instead of
 * Docker-internal container paths. This fixes two files:
 *
 * 1. `<sessionPath>/.git` — the worktree's gitdir pointer to the main repo
 * 2. `<mainRepo>/.git/worktrees/<id>/gitdir` — the backlink to the worktree
 *
 * Without this fix, every git command run from the host fails with
 * "fatal: not a git repository" because the paths only exist inside Docker.
 */
async function fixWorktreePathsForHost(
  sessionPath: string,
  hostSessionPath: string,
  worktreeBasePath: string,
  hostWorktreeBasePath: string,
  worktreeId: string,
): Promise<void> {
  // 1. Rewrite the .git file in the session worktree
  // Git writes the full worktreeBasePath into the gitdir pointer, so we
  // replace that precisely rather than just the managedReposPath prefix.
  // This is resilient to config mismatches (e.g. /data/horus-repos vs /data/repos).
  const dotGitPath = path.join(sessionPath, '.git');
  try {
    const dotGitContent = await fs.readFile(dotGitPath, 'utf-8');
    // e.g. "gitdir: /data/horus-repos/Horus/.git/worktrees/04b527d2-horus\n"
    const rewritten = dotGitContent.replace(worktreeBasePath, hostWorktreeBasePath);
    if (rewritten !== dotGitContent) {
      await fs.writeFile(dotGitPath, rewritten, 'utf-8');
    } else {
      console.warn(
        `[forge] fixWorktreePathsForHost: .git file did not contain expected path "${worktreeBasePath}" — skipping rewrite. gitdir content: ${dotGitContent.trim()}`,
      );
    }
  } catch (err) {
    console.warn(`[forge] fixWorktreePathsForHost: failed to rewrite .git file at ${dotGitPath}:`, err);
  }

  // 2. Rewrite the backlink in the main repo's worktrees directory
  const backlinkPath = path.join(
    worktreeBasePath,
    '.git',
    'worktrees',
    worktreeId,
    'gitdir',
  );
  try {
    const backlinkContent = await fs.readFile(backlinkPath, 'utf-8');
    // e.g. "/data/sessions/04b527d2-horus/.git\n"
    const rewritten = backlinkContent.replace(sessionPath, hostSessionPath);
    if (rewritten !== backlinkContent) {
      await fs.writeFile(backlinkPath, rewritten, 'utf-8');
    }
  } catch (err) {
    console.warn(`[forge] fixWorktreePathsForHost: failed to rewrite backlink at ${backlinkPath}:`, err);
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Core logic for `forge_develop`:
 *
 * 1. Resolve the repo via 3-tier lookup
 * 2. Check for existing session → resume if found
 * 3. Verify workflow is confirmed (or accept inline workflow input)
 * 4. Ensure writable worktree base (auto-clone user-tier repos to managed pool)
 * 5. git fetch + worktree creation
 * 6. Install enforcement hooks and scripts
 * 7. Save session record
 */
export async function repoDevelop(
  opts: RepoDevelopOptions,
  globalConfig: GlobalConfig,
  repoIndex: { repos: RepoIndexEntry[] } | null,
  saveRepoIndexFn: (repos: RepoIndexEntry[]) => Promise<void>,
): Promise<RepoDevelopResponse> {

  const { repo: repoName, workItem, branch: requestedBranch, workflow: inlineWorkflow, localPath } = opts;

  const sessionsPath = globalConfig.workspace.sessions_path;
  const managedReposPath = globalConfig.workspace.managed_repos_path;
  const sessionsRoot = globalConfig.workspace.sessions_root;
  const hostWorkspacesPath = globalConfig.workspace.host_workspaces_path;

  const sessionStore = new SessionStoreManager(sessionsPath);

  // ── Tier-1: Check user repo index ─────────────────────────────────────────
  let repoEntry: RepoIndexEntry | null = null;
  let repoSource: RepoSource = 'user';

  if (repoIndex) {
    if (localPath) {
      // Disambiguation re-call: resolve by exact path
      repoEntry = repoIndex.repos.find(r => r.localPath === localPath) ?? null;
    } else {
      // Name-based lookup with collision detection
      const matches = repoIndex.repos.filter(
        r => r.name.toLowerCase() === repoName.toLowerCase(),
      );
      if (matches.length > 1) {
        return {
          status: 'needs_repo_disambiguation',
          matches: matches.map(m => ({
            name: m.name,
            localPath: m.localPath,
            remoteUrl: m.remoteUrl,
            defaultBranch: m.defaultBranch,
          })),
          message:
            `Multiple repositories named "${repoName}" found in the index. ` +
            `Re-call forge_develop with the localPath parameter set to the desired repo's path.`,
        };
      }
      repoEntry = matches[0] ?? null;
    }
  }

  // ── Tier-2: Check managed pool ────────────────────────────────────────────
  if (!repoEntry) {
    const managedPath = path.join(managedReposPath, repoName);
    try {
      await fs.access(managedPath);
      // Found in managed pool — build a synthetic entry
      repoEntry = {
        name: repoName,
        localPath: managedPath,
        remoteUrl: null,
        defaultBranch: 'main',
        language: null,
        framework: null,
        lastCommitDate: new Date().toISOString(),
        lastScannedAt: new Date().toISOString(),
      };
      repoSource = 'managed';
      // Try to get default branch from the repo
      try {
        const branch = await runGit(['symbolic-ref', '--short', 'HEAD'], managedPath, 5000);
        if (branch) repoEntry.defaultBranch = branch;
      } catch { /* ignore */ }
      // Try to get remote URL
      try {
        const remoteUrl = await runGit(['remote', 'get-url', 'origin'], managedPath, 5000);
        if (remoteUrl) repoEntry = { ...repoEntry, remoteUrl };
      } catch { /* ignore */ }
    } catch {
      // Not in managed pool either
    }
  }

  // ── Tier-3: Clone from remote ─────────────────────────────────────────────
  if (!repoEntry) {
    // We have no local copy at all. We cannot proceed without a remote URL —
    // there's nothing to clone from. Return a clear error.
    throw new ForgeError(
      'REPO_NOT_FOUND',
      `Repository "${repoName}" was not found in the local index or managed pool.`,
      `To proceed:\n` +
      `  1. If the repo exists locally: run 'forge repo scan' to add it to the index.\n` +
      `  2. If you want to clone from a remote: call forge_develop with a remoteUrl parameter (not yet supported — coming in a future release).\n` +
      `  3. Or check the repo name spelling.`,
    );
  }

  // ── Check for existing session (resume flow) ──────────────────────────────
  const existing = await sessionStore.findByWorkItem(workItem, repoName);
  if (existing) {
    // Verify the session directory still exists
    try {
      await fs.access(existing.sessionPath);
      // Update lastModified on resume
      await sessionStore.touch(existing.sessionId);
      return {
        status: 'resumed',
        sessionId: existing.sessionId,
        sessionPath: existing.sessionPath,
        hostSessionPath: existing.hostSessionPath,
        branch: existing.branch,
        baseBranch: existing.baseBranch,
        repo: existing.repo,
        repoSource: existing.repoSource,
        workflow: existing.workflow,
        agentSlot: existing.agentSlot,
      };
    } catch {
      // Session path gone (manually deleted?) — treat as new session
    }
  }

  // ── Workflow confirmation check ───────────────────────────────────────────
  let confirmedWorkflow: RepoIndexWorkflow | null = repoEntry.workflow ?? null;

  if (!confirmedWorkflow && !inlineWorkflow) {
    // Auto-detect and ask for confirmation
    const detected = await detectWorkflow(repoEntry.localPath, repoEntry);
    return {
      status: 'needs_workflow_confirmation',
      detected,
      message:
        `Repository "${repoName}" has no confirmed workflow. ` +
        `Call forge_develop again with the 'workflow' parameter to confirm and proceed. ` +
        `The detected values above are a starting point — adjust if needed.`,
    };
  }

  // If inline workflow provided, save it to repo index for future calls
  if (inlineWorkflow && !confirmedWorkflow) {
    const now = new Date().toISOString();
    const newWorkflow: RepoIndexWorkflow = {
      type: inlineWorkflow.type,
      upstream: inlineWorkflow.upstream,
      fork: inlineWorkflow.fork,
      pushTo: inlineWorkflow.pushTo,
      prTarget: inlineWorkflow.prTarget,
      branchPattern: inlineWorkflow.branchPattern,
      commitFormat: inlineWorkflow.commitFormat,
      confirmedAt: now,
      confirmedBy: 'user',
    };
    const updatedEntry: RepoIndexEntry = { ...repoEntry, workflow: newWorkflow };
    const updatedRepos = repoIndex
      ? repoIndex.repos.map(r => r.name === repoName ? updatedEntry : r)
      : [updatedEntry];
    await saveRepoIndexFn(updatedRepos);
    repoEntry = updatedEntry;
    confirmedWorkflow = newWorkflow;
  }

  // If inline workflow provided but repo already had a saved workflow, use inline (override for this call)
  const effectiveWorkflow = inlineWorkflow ?? confirmedWorkflow!;

  // ── Determine base branch ─────────────────────────────────────────────────
  const baseBranch = effectiveWorkflow.prTarget.branch ?? repoEntry.defaultBranch;

  // ── Determine feature branch name ─────────────────────────────────────────
  const slug = toSlug(workItem);
  const featureBranch = requestedBranch ?? `feature/${slug}`;

  // ── Max sessions ceiling check (warn only, never block) ──────────────────
  const maxSessions = globalConfig.workspace.max_sessions ?? 20;
  const totalSessions = await sessionStore.count();
  let sessionCeilingWarning: string | undefined;
  if (totalSessions >= maxSessions) {
    sessionCeilingWarning =
      `Session ceiling reached: ${totalSessions}/${maxSessions} active sessions. ` +
      `Consider running forge_session_cleanup to reclaim stale sessions.`;
  }

  // ── Compute session path ──────────────────────────────────────────────────
  const sessionCount = await sessionStore.countByWorkItem(workItem, repoName);
  const agentSlot = sessionCount + 1;
  const suffix = agentSlot > 1 ? `-${agentSlot}` : '';
  const sessionDirName = `${slug}-${repoName.toLowerCase()}${suffix}`;
  const sessionPath = path.join(sessionsRoot, sessionDirName);

  // ── Ensure writable worktree base ─────────────────────────────────────────
  // User-tier repos (from scan_paths) may be mounted read-only (e.g. Docker
  // `:ro` bind mounts). Git worktree creation writes branch ref locks into
  // the base repo's .git/refs/heads/, which fails on a read-only filesystem.
  //
  // Solution: when the repo was resolved from the user tier, ensure a managed
  // clone exists at managedReposPath/<name> (which is always writable). Use
  // that clone as the worktree base instead.
  const { worktreeBasePath, effectiveSource } = await ensureWritableWorktreeBase(
    repoEntry,
    repoSource,
    managedReposPath,
  );
  repoSource = effectiveSource;

  // ── Git fetch (best-effort) ───────────────────────────────────────────────
  await fetchRemotes(worktreeBasePath);

  // ── Resolve default remote ────────────────────────────────────────────────
  // Resolution chain: Forge registry → Vault repo profile → ask user.
  // A hardcoded "origin" is not safe when multiple remotes exist (e.g. team
  // forks added for code review). The resolved remote is used both to verify
  // the tracking ref exists and as the worktree base.
  const vaultBaseUrl = globalConfig.mcp_endpoints?.vault?.url;
  let resolvedRemote = await resolveDefaultRemote(repoEntry, vaultBaseUrl, effectiveWorkflow);

  if (resolvedRemote === null) {
    if (opts.defaultRemote) {
      // User provided it inline — save to registry so future calls skip this step
      resolvedRemote = opts.defaultRemote;
      const updatedEntry: RepoIndexEntry = { ...repoEntry, default_remote: resolvedRemote };
      const updatedRepos = repoIndex
        ? repoIndex.repos.map(r => r.name === repoName ? updatedEntry : r)
        : [updatedEntry];
      await saveRepoIndexFn(updatedRepos);
      repoEntry = updatedEntry;
    } else {
      // Ask the user which remote to use
      const availableRemotes = await getAvailableRemotes(worktreeBasePath);
      return {
        status: 'needs_remote_confirmation',
        availableRemotes,
        message:
          `Repository "${repoName}" has multiple remotes or no default remote configured. ` +
          `Call forge_develop again with the 'defaultRemote' parameter set to the remote you want to fetch from ` +
          `(e.g. "origin" or "upstream"). It will be saved for future sessions.`,
      };
    }
  }

  // ── Create git worktree ───────────────────────────────────────────────────
  await fs.mkdir(sessionsRoot, { recursive: true });

  // Check if the session path already exists (partial state from a prior failed attempt)
  try {
    await fs.access(sessionPath);
    // Path exists but no session record — clean it up
    await fs.rm(sessionPath, { recursive: true, force: true });
  } catch {
    // Doesn't exist — good
  }

  // Determine the tracking ref for the worktree base.
  // Prefer <resolvedRemote>/<baseBranch> if available, else fall back to local baseBranch.
  let worktreeBase = baseBranch;
  try {
    await runGit(['rev-parse', '--verify', `${resolvedRemote}/${baseBranch}`], worktreeBasePath, 5000);
    worktreeBase = `${resolvedRemote}/${baseBranch}`;
  } catch {
    // Remote tracking ref not available — use local branch
  }

  try {
    await execFileAsync(
      'git',
      ['worktree', 'add', sessionPath, '-b', featureBranch, worktreeBase],
      { cwd: worktreeBasePath, timeout: 30000 },
    );
  } catch (err: any) {
    // If branch already exists, try to check it out instead
    if ((err.message ?? '').includes('already exists')) {
      try {
        await execFileAsync(
          'git',
          ['worktree', 'add', sessionPath, featureBranch],
          { cwd: worktreeBasePath, timeout: 30000 },
        );
      } catch (err2: any) {
        await fs.rm(sessionPath, { recursive: true, force: true }).catch(() => {});
        throw new ForgeError(
          'WORKTREE_CREATE_FAILED',
          `Failed to create git worktree at ${sessionPath}: ${err2.message}`,
          `Check that the branch '${featureBranch}' is not checked out in another worktree.`,
        );
      }
    } else {
      await fs.rm(sessionPath, { recursive: true, force: true }).catch(() => {});
      throw new ForgeError(
        'WORKTREE_CREATE_FAILED',
        `Failed to create git worktree at ${sessionPath}: ${err.message}`,
        `Ensure git is available and the base branch '${baseBranch}' exists.`,
      );
    }
  }

  // ── Install enforcement hooks and scripts ─────────────────────────────────
  // Build a RepoIndexWorkflow-shaped object for the hook installer.
  // effectiveWorkflow is WorkflowInput | RepoIndexWorkflow; both share the
  // fields we need (type, pushTo, prTarget, commitFormat).
  const workflowForHooks: RepoIndexWorkflow = {
    type: effectiveWorkflow.type,
    upstream: effectiveWorkflow.upstream,
    fork: effectiveWorkflow.fork,
    pushTo: effectiveWorkflow.pushTo,
    prTarget: effectiveWorkflow.prTarget,
    branchPattern: effectiveWorkflow.branchPattern,
    commitFormat: effectiveWorkflow.commitFormat,
    confirmedAt: ('confirmedAt' in effectiveWorkflow)
      ? (effectiveWorkflow as RepoIndexWorkflow).confirmedAt
      : new Date().toISOString(),
    confirmedBy: ('confirmedBy' in effectiveWorkflow)
      ? (effectiveWorkflow as RepoIndexWorkflow).confirmedBy
      : 'user',
  };
  await installEnforcementHooks(sessionPath, workflowForHooks, repoName, worktreeBasePath);

  // ── Configure GitHub remote on worktree ────────────────────────────────────
  // The worktree inherits remotes from the managed clone, which may point to
  // a container-internal local path. Override origin with the real GitHub URL.
  // IMPORTANT: This must run BEFORE .git path rewrite, because git commands
  // inside the container need container-internal paths to work.
  if (repoEntry.remoteUrl && !isLocalPath(repoEntry.remoteUrl)) {
    try {
      await runGit(['remote', 'set-url', 'origin', repoEntry.remoteUrl], sessionPath, 5000);
    } catch {
      // If set-url fails (no origin), add it
      try {
        await runGit(['remote', 'add', 'origin', repoEntry.remoteUrl], sessionPath, 5000);
      } catch { /* best-effort */ }
    }
  }

  // ── Compute host-side path (Docker path translation) ──────────────────────
  let hostSessionPath: string | undefined;
  let hostDataBase: string | undefined;
  if (hostWorkspacesPath && sessionsRoot.includes('/data/')) {
    // Translate /data/sessions/... → hostWorkspacesPath/../sessions/...
    const dataIdx = sessionsRoot.indexOf('/data/');
    if (dataIdx !== -1) {
      const rel = sessionsRoot.slice(dataIdx + '/data/'.length);
      hostDataBase = hostWorkspacesPath.replace(/\/workspaces\/?$/, '');
      const hostSessionsRoot = path.join(hostDataBase, rel);
      const sessionRelative = path.relative(sessionsRoot, sessionPath);
      hostSessionPath = path.join(hostSessionsRoot, sessionRelative);
    }
  }

  // ── Fix git worktree pointers for host access (Docker path translation) ───
  // When Forge runs in Docker, git worktree paths are container-internal.
  // Rewrite them so git works from the host where Claude Code runs.
  if (hostSessionPath) {
    // Resolve the host-side equivalent of worktreeBasePath.
    // Prefer the explicit host_managed_repos_path config (handles volume aliases
    // like /data/horus-repos → ${HORUS_DATA_PATH}/repos). Fall back to the
    // general /data/<rel> → hostDataBase/<rel> translation for cases where the
    // managed repos path follows the standard naming convention (no alias).
    const explicitHostManagedReposPath = globalConfig.workspace.host_managed_repos_path;
    let hostWorktreeBasePath: string | undefined;

    if (explicitHostManagedReposPath) {
      // e.g. worktreeBasePath = /data/horus-repos/Horus
      //      managedReposPath = /data/horus-repos
      //      explicitHostManagedReposPath = /Users/arkhera/Horus/data/repos
      // → hostWorktreeBasePath = /Users/arkhera/Horus/data/repos/Horus
      const repoRelative = path.relative(managedReposPath, worktreeBasePath);
      hostWorktreeBasePath = path.join(explicitHostManagedReposPath, repoRelative);
    } else if (hostDataBase && worktreeBasePath.includes('/data/')) {
      // Fallback: derive via general /data/<rel> translation.
      // Works when managed repos path uses standard naming (no volume alias).
      const dataIdx = worktreeBasePath.indexOf('/data/');
      const rel = worktreeBasePath.slice(dataIdx + '/data/'.length);
      hostWorktreeBasePath = path.join(hostDataBase, rel);
      console.warn(
        `[forge] host_managed_repos_path not configured — falling back to general path translation for worktree rewrite. ` +
        `Derived: ${hostWorktreeBasePath}. Set FORGE_HOST_MANAGED_REPOS_PATH for reliable path mapping.`,
      );
    } else {
      console.warn(
        `[forge] Cannot rewrite git worktree paths for host: host_managed_repos_path is not configured ` +
        `and worktreeBasePath "${worktreeBasePath}" does not follow /data/ convention. ` +
        `Git commands inside the session may fail from the host.`,
      );
    }

    if (hostWorktreeBasePath) {
      await fixWorktreePathsForHost(
        sessionPath,
        hostSessionPath,
        worktreeBasePath,
        hostWorktreeBasePath,
        sessionDirName,
      );
    }
  }

  // ── Build workflow snapshot ───────────────────────────────────────────────
  const sessionWorkflow: SessionWorkflow = {
    type: effectiveWorkflow.type,
    pushTo: effectiveWorkflow.pushTo,
    prTarget: effectiveWorkflow.prTarget,
  };

  // ── Save session record ───────────────────────────────────────────────────
  const sessionId = generateSessionId();
  const now = new Date().toISOString();
  const record: SessionRecord = {
    sessionId,
    workItem,
    repo: repoName,
    branch: featureBranch,
    baseBranch,
    sessionPath,
    hostSessionPath,
    repoSource,
    workflow: sessionWorkflow,
    agentSlot,
    createdAt: now,
    lastModified: now,
  };
  await sessionStore.add(record);

  return {
    status: 'created',
    sessionId,
    sessionPath,
    hostSessionPath,
    branch: featureBranch,
    baseBranch,
    repo: repoName,
    repoSource,
    workflow: sessionWorkflow,
    agentSlot,
    ...(sessionCeilingWarning ? { warning: sessionCeilingWarning } : {}),
  };
}
