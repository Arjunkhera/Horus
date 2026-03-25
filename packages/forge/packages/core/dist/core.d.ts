import { type WorkspaceCreateOptions } from './workspace/workspace-creator.js';
import type { ArtifactSummary, ArtifactType, InstallReport, SearchResult, ResolvedArtifact, WorkspaceRecord } from './models/index.js';
import type { ForgeConfig } from './models/forge-config.js';
import type { RepoIndex, RepoIndexEntry, RepoIndexWorkflow } from './models/repo-index.js';
import type { RepoWorkflow } from './models/repo-workflow.js';
import { type RepoDevelopOptions, type RepoDevelopResponse } from './repo/repo-develop.js';
import { type SessionListOptions, type SessionListResult } from './session/session-list.js';
import { type SessionCleanupOptions, type SessionCleanupResult } from './session/session-cleanup.js';
/**
 * Translate a Docker-internal repo localPath to the equivalent host path.
 * Returns the entry unchanged if host_repos_path is not configured or
 * the localPath doesn't start with any of the configured scan_paths.
 */
export declare function translateRepoPath(entry: RepoIndexEntry, scanPaths: string[], hostReposPath: string | undefined): RepoIndexEntry;
export interface InstallOptions {
    target?: ForgeConfig['target'];
    conflictStrategy?: 'overwrite' | 'skip' | 'backup';
    dryRun?: boolean;
}
/**
 * Report returned after a global plugin install.
 */
export interface GlobalInstallReport {
    pluginId: string;
    version: string;
    filesWritten: string[];
    claudeMdUpdated: boolean;
}
/**
 * Info about a globally installed plugin.
 */
export interface GlobalPluginInfo {
    id: string;
    version: string;
    installedAt: string;
    files: string[];
}
/**
 * Auto-detected workflow values returned when user confirmation is needed.
 */
export interface AutoDetectedWorkflow {
    type: 'owner' | 'fork' | 'contributor';
    upstream?: string;
    fork?: string;
    pushTo: string;
    prTarget: {
        repo: string;
        branch: string;
    };
    branchPattern?: string;
    commitFormat?: string;
    remotesSnapshot?: Record<string, string>;
}
/**
 * Result returned by `repoWorkflow()`.
 *
 * When `needsConfirmation` is true, the agent should present `autoDetected`
 * values to the user for confirmation, then call `repoWorkflowSave()`.
 *
 * When `source` is 'index', the workflow was previously confirmed and saved.
 * A `stalenessWarning` may be present if remotes changed since confirmation.
 */
export interface RepoWorkflowResult extends RepoWorkflow {
    /** True when workflow has not been confirmed and user should verify */
    needsConfirmation?: boolean;
    /** Auto-detected values to present to the user for confirmation */
    autoDetected?: AutoDetectedWorkflow;
    /** ISO timestamp when workflow was last confirmed (index source only) */
    confirmedAt?: string;
    /** Who confirmed the workflow (index source only) */
    confirmedBy?: 'user' | 'auto';
    /** Warning if remotes have changed since confirmation (index source only) */
    stalenessWarning?: string;
}
/**
 * Main orchestration class for Forge. Wires together Registry, Resolver,
 * Compiler, and WorkspaceManager. Both the CLI and MCP server call this.
 *
 * @example
 * const forge = new ForgeCore('./my-workspace');
 * await forge.init('my-workspace');
 * await forge.add('skill:developer@1.0.0');
 * const report = await forge.install();
 */
export interface ForgeCoreOptions {
    /** Override the global config path (default: ~/Horus/data/config/forge.yaml). Useful for testing. */
    globalConfigPath?: string;
}
export declare class ForgeCore {
    private readonly workspaceRoot;
    private readonly workspaceManager;
    private readonly compiler;
    private readonly globalConfigPath;
    private _metadataStore?;
    private _lifecycleManager?;
    /** Lazily initialized — null when Typesense is not configured. */
    private _searchClient?;
    constructor(workspaceRoot?: string, options?: ForgeCoreOptions);
    /**
     * Return the ForgeSearchClient if Typesense is configured, or null otherwise.
     * Initialised once and cached.
     */
    private getSearchClient;
    private getMetadataStore;
    private getLifecycleManager;
    /**
     * Initialize a new Forge workspace.
     * Creates forge.yaml and forge.lock.
     */
    init(name: string): Promise<void>;
    /**
     * Search the registry for artifacts matching a query.
     * Tries Typesense fuzzy search first; falls back to in-memory scoring when unavailable.
     */
    search(query: string, type?: ArtifactType): Promise<SearchResult[]>;
    /**
     * Add artifact ref(s) to forge.yaml.
     * Validates the artifact exists in the registry before adding.
     */
    add(refStrings: string | string[]): Promise<ForgeConfig>;
    /**
     * Run the full install pipeline:
     * readConfig → resolveAll → emitAll → mergeFiles → writeLock
     */
    install(options?: InstallOptions): Promise<InstallReport>;
    /**
     * Remove artifacts from forge.yaml and clean lockfile-tracked files.
     */
    remove(refStrings: string | string[]): Promise<void>;
    /**
     * Resolve a single artifact ref (for forge_resolve MCP tool).
     */
    resolve(refString: string): Promise<ResolvedArtifact>;
    /**
     * List installed (from lock) or available (from registry) artifacts.
     */
    list(scope?: 'installed' | 'available', type?: ArtifactType): Promise<ArtifactSummary[]>;
    /**
     * Read the current forge.yaml config.
     */
    getConfig(): Promise<ForgeConfig>;
    /**
     * Scan configured directories for git repositories and update the index.
     * After scanning, upserts all repos into Typesense (when available).
     */
    repoScan(): Promise<RepoIndex>;
    /**
     * List repositories from the index, optionally filtered by query.
     */
    repoList(query?: string): Promise<RepoIndexEntry[]>;
    /**
     * Resolve a repository by name or remote URL.
     * When resolving by name, tries Typesense fuzzy search first for typo tolerance,
     * then falls back to exact/substring matching in the local index.
     */
    repoResolve(opts: {
        name?: string;
        remoteUrl?: string;
    }): Promise<RepoIndexEntry | null>;
    /**
     * Resolve the git workflow configuration for a repository.
     *
     * Resolution order:
     *   0. Repo index confirmed workflow — previously saved to repos.json
     *   1. Vault repo profile  — shared, team-wide knowledge (hosting + workflow fields)
     *   2. Auto-detect         — inspect local git remotes (upstream → fork/contributor, else owner)
     *   3. Default fallback    — direct strategy, main branch
     *
     * When no confirmed workflow exists in the index and Vault has no profile,
     * returns a result with `needsConfirmation: true` and `autoDetected` values
     * so the caller (agent) can present them to the user for confirmation.
     * Once confirmed, call `repoWorkflowSave()` to persist the workflow.
     */
    repoWorkflow(repoName: string): Promise<RepoWorkflowResult>;
    /**
     * Save confirmed workflow metadata for a repository to the repo index.
     *
     * Called after the user confirms (or accepts) the auto-detected workflow
     * values returned by `repoWorkflow()` with `needsConfirmation: true`.
     *
     * @param repoName - Repository name in the index
     * @param workflow - Confirmed workflow values (agent passes user-confirmed or auto-detected)
     * @param confirmedBy - "user" if user explicitly confirmed, "auto" if accepted without edits
     */
    repoWorkflowSave(repoName: string, workflow: Omit<RepoIndexWorkflow, 'confirmedAt' | 'confirmedBy'>, confirmedBy?: 'user' | 'auto'): Promise<RepoIndexWorkflow>;
    /**
     * Start or resume a code session for a work item on a repository.
     *
     * Implements the 3-tier repo resolution strategy:
     *   Tier 1 — repo index (user's local scan_paths)
     *   Tier 2 — managed pool (~/Horus/data/repos/<name>/)
     *   Tier 3 — not found → error with actionable message
     *
     * Creates a git worktree at ~/Horus/data/sessions/<workItem>-<slug>/.
     * If a session already exists for the same workItem+repo, it is resumed.
     * A second concurrent agent gets a separate slot with a "-2" suffix.
     *
     * Returns `needs_workflow_confirmation` when the repo has no saved workflow
     * and no `workflow` parameter is provided.
     */
    repoDevelop(opts: RepoDevelopOptions): Promise<RepoDevelopResponse>;
    /**
     * List active code sessions, optionally filtered by repo and/or workItem.
     */
    sessionList(opts?: SessionListOptions): Promise<SessionListResult>;
    /**
     * Clean up sessions based on workItem, age threshold, or auto-policy.
     *
     * Auto-policy queries Anvil for work item status:
     *   - done (7+ days ago) → eligible
     *   - cancelled → eligible immediately
     *   - in_progress / in_review → skip
     *   - not found → warn, skip
     */
    sessionCleanup(opts: SessionCleanupOptions): Promise<SessionCleanupResult>;
    /**
     * Create a new workspace from a workspace config artifact.
     * Resolves the workspace config, sets up folders, installs plugins,
     * creates git worktrees, and registers in metadata store.
     */
    workspaceCreate(options: WorkspaceCreateOptions): Promise<WorkspaceRecord>;
    /**
     * List workspaces, optionally filtered by status.
     */
    workspaceList(filter?: {
        status?: string;
    }): Promise<WorkspaceRecord[]>;
    /**
     * Find the first workspace linked to a story ID. Returns null if not found.
     */
    workspaceFindByStory(storyId: string): Promise<WorkspaceRecord | null>;
    /**
     * Get status of a workspace.
     */
    workspaceStatus(id: string): Promise<WorkspaceRecord | null>;
    /**
     * Pause a workspace.
     */
    workspacePause(id: string): Promise<WorkspaceRecord>;
    /**
     * Complete a workspace.
     */
    workspaceComplete(id: string): Promise<WorkspaceRecord>;
    /**
     * Delete a workspace.
     */
    workspaceDelete(id: string, opts?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Archive a workspace.
     */
    workspaceArchive(id: string): Promise<WorkspaceRecord>;
    /**
     * Clean workspaces based on retention policy.
     */
    workspaceClean(opts?: {
        dryRun?: boolean;
    }): Promise<{
        cleaned: string[];
        skipped: string[];
    }>;
    /**
     * Install a plugin globally to ~/.claude/.
     *
     * 1. Resolves the plugin via the registry
     * 2. Emits skills to ~/.claude/skills/ using GlobalClaudeCodeStrategy
     * 3. Reads plugin's resources/rules/global-rules.md
     * 4. Upserts a managed section in ~/.claude/CLAUDE.md
     * 5. Tracks installed files in ~/Horus/data/config/forge.yaml global_plugins
     */
    installGlobal(ref: string): Promise<GlobalInstallReport>;
    /**
     * Uninstall a globally installed plugin.
     *
     * 1. Reads tracked files from global_plugins
     * 2. Deletes skill/agent files from ~/.claude/
     * 3. Removes managed section from ~/.claude/CLAUDE.md
     * 4. Removes entry from global config
     */
    uninstallGlobal(pluginId: string): Promise<void>;
    /**
     * List all globally installed plugins.
     */
    listGlobal(): Promise<GlobalPluginInfo[]>;
    /**
     * Find an adapter in the registry that supports readResourceFile for a given artifact.
     */
    private findAdapterWithResource;
    /**
     * Fetch all remotes and their fetch URLs from a local git repository.
     * Returns a map of { remoteName → fetchUrl }.
     * Returns empty map on any error.
     */
    private _listRemotes;
    /**
     * Full workflow detection from a repo's local remotes.
     *
     * Strategy:
     *   - Has 'upstream' remote  → fork  (origin = personal fork, upstream = canonical)
     *   - No 'upstream'          → owner (sole maintainer, push directly to origin)
     *
     * Note: "contributor" (external collaborator, no fork, only branch) is rare
     * in local git setups. We detect it when origin URL does not match the
     * authenticated user's account, but since we can't check that without a
     * GitHub API call, we default to "owner" for the auto-detect path.
     * Users can correct this during confirmation.
     */
    private _detectWorkflowFull;
    /**
     * Check whether the workflow metadata may be stale by comparing the current
     * remote URLs to the snapshot taken at confirmation time.
     *
     * Returns a warning string if remotes have changed, null if unchanged.
     * On any git error, returns null (fail silently).
     */
    private _checkWorkflowStaleness;
    /**
     * @deprecated Use _detectWorkflowFull instead.
     * Kept for backward compatibility with any callers that only need the strategy string.
     */
    private _detectWorkflowStrategy;
    private buildRegistry;
    /**
     * Instantiate the correct DataAdapter for a registry config entry.
     */
    private buildAdapter;
    private parseRef;
}
export { Registry } from './registry/registry.js';
//# sourceMappingURL=core.d.ts.map