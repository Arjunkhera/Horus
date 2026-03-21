import { type WorkspaceCreateOptions } from './workspace/workspace-creator.js';
import type { ArtifactSummary, ArtifactType, InstallReport, SearchResult, ResolvedArtifact, WorkspaceRecord } from './models/index.js';
import type { ForgeConfig } from './models/forge-config.js';
import type { RepoIndex, RepoIndexEntry } from './models/repo-index.js';
import type { RepoWorkflow } from './models/repo-workflow.js';
import { type RepoCloneResult } from './repo/repo-clone.js';
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
    /** Override the global config path (default: ~/.forge/config.yaml). Useful for testing. */
    globalConfigPath?: string;
}
export declare class ForgeCore {
    private readonly workspaceRoot;
    private readonly workspaceManager;
    private readonly compiler;
    private readonly globalConfigPath;
    private _metadataStore?;
    private _lifecycleManager?;
    constructor(workspaceRoot?: string, options?: ForgeCoreOptions);
    private getMetadataStore;
    private getLifecycleManager;
    /**
     * Initialize a new Forge workspace.
     * Creates forge.yaml and forge.lock.
     */
    init(name: string): Promise<void>;
    /**
     * Search the registry for artifacts matching a query.
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
     */
    repoScan(): Promise<RepoIndex>;
    /**
     * List repositories from the index, optionally filtered by query.
     */
    repoList(query?: string): Promise<RepoIndexEntry[]>;
    /**
     * Resolve a repository by name or remote URL.
     */
    repoResolve(opts: {
        name?: string;
        remoteUrl?: string;
    }): Promise<RepoIndexEntry | null>;
    /**
     * Resolve the git workflow configuration for a repository.
     *
     * Resolution order:
     *   1. Vault repo profile  — shared, team-wide knowledge (hosting + workflow fields)
     *   2. Auto-detect         — inspect local git remotes (upstream → fork, else direct)
     *   3. Default fallback    — direct strategy, main branch
     */
    repoWorkflow(repoName: string): Promise<RepoWorkflow>;
    /**
     * Create an isolated reference clone of a repository.
     *
     * Looks up the repo in the local index, creates a reference clone at
     * destPath (default: <workspaceRoot>/<repoName> when inside a workspace,
     * or <mountPath>/<repoName> otherwise), optionally creates a feature
     * branch, and returns paths in host-translated form.
     */
    repoClone(opts: {
        repoName: string;
        branchName?: string;
        destPath?: string;
        workspacePath?: string;
    }): Promise<RepoCloneResult>;
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
     * 5. Tracks installed files in ~/.forge/config.yaml global_plugins
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
     * Detect git workflow strategy from a repo's local remotes.
     *
     * - Has an 'upstream' remote → fork strategy (push to origin fork, PR against upstream)
     * - Otherwise              → direct strategy (push feature branch to shared origin)
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