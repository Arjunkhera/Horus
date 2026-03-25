"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = exports.ForgeCore = void 0;
exports.translateRepoPath = translateRepoPath;
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const workspace_manager_js_1 = require("./workspace/workspace-manager.js");
const workspace_creator_js_1 = require("./workspace/workspace-creator.js");
const workspace_lifecycle_js_1 = require("./workspace/workspace-lifecycle.js");
const workspace_metadata_store_js_1 = require("./workspace/workspace-metadata-store.js");
const registry_js_1 = require("./registry/registry.js");
const resolver_js_1 = require("./resolver/resolver.js");
const compiler_js_1 = require("./compiler/compiler.js");
const claude_code_strategy_js_1 = require("./compiler/claude-code-strategy.js");
const cursor_strategy_js_1 = require("./compiler/cursor-strategy.js");
const global_claude_code_strategy_js_1 = require("./compiler/global-claude-code-strategy.js");
const claude_md_writer_js_1 = require("./compiler/claude-md-writer.js");
const filesystem_adapter_js_1 = require("./adapters/filesystem-adapter.js");
const composite_adapter_js_1 = require("./adapters/composite-adapter.js");
const git_adapter_js_1 = require("./adapters/git-adapter.js");
const errors_js_1 = require("./adapters/errors.js");
const global_config_loader_js_1 = require("./config/global-config-loader.js");
const repo_scanner_js_1 = require("./repo/repo-scanner.js");
const repo_index_store_js_1 = require("./repo/repo-index-store.js");
const repo_index_query_js_1 = require("./repo/repo-index-query.js");
const vault_client_js_1 = require("./vault/vault-client.js");
const repo_develop_js_1 = require("./repo/repo-develop.js");
const session_list_js_1 = require("./session/session-list.js");
const session_cleanup_js_1 = require("./session/session-cleanup.js");
const forge_search_client_js_1 = require("./search/forge-search-client.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Translate a Docker-internal repo localPath to the equivalent host path.
 * Returns the entry unchanged if host_repos_path is not configured or
 * the localPath doesn't start with any of the configured scan_paths.
 */
function translateRepoPath(entry, scanPaths, hostReposPath) {
    if (!hostReposPath)
        return entry;
    for (const scanPath of scanPaths) {
        const prefix = scanPath.endsWith('/') ? scanPath : scanPath + '/';
        if (entry.localPath === scanPath || entry.localPath.startsWith(prefix)) {
            const relative = entry.localPath.slice(scanPath.length);
            const hostBase = hostReposPath.endsWith('/') ? hostReposPath.slice(0, -1) : hostReposPath;
            return { ...entry, localPath: hostBase + relative };
        }
    }
    return entry;
}
class ForgeCore {
    workspaceRoot;
    workspaceManager;
    compiler;
    globalConfigPath;
    _metadataStore;
    _lifecycleManager;
    /** Lazily initialized — null when Typesense is not configured. */
    _searchClient;
    constructor(workspaceRoot = process.cwd(), options) {
        this.workspaceRoot = workspaceRoot;
        this.workspaceManager = new workspace_manager_js_1.WorkspaceManager(workspaceRoot);
        this.compiler = new compiler_js_1.Compiler();
        this.compiler.register(new claude_code_strategy_js_1.ClaudeCodeStrategy());
        this.compiler.register(new cursor_strategy_js_1.CursorStrategy());
        this.globalConfigPath = options?.globalConfigPath;
    }
    /**
     * Return the ForgeSearchClient if Typesense is configured, or null otherwise.
     * Initialised once and cached.
     */
    getSearchClient() {
        if (this._searchClient === undefined) {
            this._searchClient = forge_search_client_js_1.ForgeSearchClient.create();
        }
        return this._searchClient;
    }
    async getMetadataStore() {
        if (!this._metadataStore) {
            const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
            this._metadataStore = new workspace_metadata_store_js_1.WorkspaceMetadataStore(globalConfig.workspace.store_path);
        }
        return this._metadataStore;
    }
    async getLifecycleManager() {
        if (!this._lifecycleManager) {
            const store = await this.getMetadataStore();
            this._lifecycleManager = new workspace_lifecycle_js_1.WorkspaceLifecycleManager(undefined, store);
        }
        return this._lifecycleManager;
    }
    /**
     * Initialize a new Forge workspace.
     * Creates forge.yaml and forge.lock.
     */
    async init(name) {
        await this.workspaceManager.scaffoldWorkspace(name);
    }
    /**
     * Search the registry for artifacts matching a query.
     * Tries Typesense fuzzy search first; falls back to in-memory scoring when unavailable.
     */
    async search(query, type) {
        const searchClient = this.getSearchClient();
        if (searchClient) {
            const hits = await searchClient.searchArtifacts(query, type);
            if (hits !== null && hits.length > 0) {
                // Map Typesense hits to SearchResult shape — fetch full meta from registry for each hit
                const registry = await this.buildRegistry();
                const results = [];
                for (const hit of hits) {
                    const hitType = hit.source_type;
                    const hitId = hit.id.replace(`forge-${hitType}-`, '');
                    try {
                        const bundle = await registry.get({ type: hitType, id: hitId, version: '' });
                        results.push({
                            ref: { type: hitType, id: hitId, version: bundle.meta.version },
                            meta: bundle.meta,
                            score: 100, // Typesense already ranked — treat all hits as high score
                            matchedOn: ['name'],
                        });
                    }
                    catch {
                        // Artifact in Typesense but not in local registry — skip
                    }
                }
                if (results.length > 0)
                    return results;
            }
        }
        // Fallback: in-memory scoring
        const registry = await this.buildRegistry();
        return registry.search(query, type);
    }
    /**
     * Add artifact ref(s) to forge.yaml.
     * Validates the artifact exists in the registry before adding.
     */
    async add(refStrings) {
        const refs = Array.isArray(refStrings) ? refStrings : [refStrings];
        const config = await this.workspaceManager.readConfig();
        const registry = await this.buildRegistry();
        for (const refStr of refs) {
            const ref = this.parseRef(refStr);
            // Best-effort check: warn if artifact not found in any registry
            if (config.registries.length > 0) {
                try {
                    await registry.get(ref);
                }
                catch {
                    console.warn(`[ForgeCore] Warning: '${refStr}' not found in any registry. Adding anyway.`);
                }
            }
            // Add to config
            if (ref.type === 'skill') {
                config.artifacts.skills[ref.id] = ref.version;
            }
            else if (ref.type === 'agent') {
                config.artifacts.agents[ref.id] = ref.version;
            }
            else if (ref.type === 'plugin') {
                config.artifacts.plugins[ref.id] = ref.version;
            }
        }
        await this.workspaceManager.writeConfig(config);
        return config;
    }
    /**
     * Run the full install pipeline:
     * readConfig → resolveAll → emitAll → mergeFiles → writeLock
     */
    async install(options = {}) {
        const startTime = Date.now();
        const config = await this.workspaceManager.readConfig();
        const lock = await this.workspaceManager.readLock();
        const registry = await this.buildRegistry();
        const resolver = new resolver_js_1.Resolver(registry);
        // Build ref list from config artifacts
        const refs = [
            ...Object.entries(config.artifacts.skills).map(([id, version]) => ({
                type: 'skill', id, version,
            })),
            ...Object.entries(config.artifacts.agents).map(([id, version]) => ({
                type: 'agent', id, version,
            })),
            ...Object.entries(config.artifacts.plugins).map(([id, version]) => ({
                type: 'plugin', id, version,
            })),
        ];
        // Resolve all artifacts
        resolver.reset();
        const resolved = await resolver.resolveAll(refs);
        // Compile to file operations
        const target = options.target ?? config.target;
        const fileOps = this.compiler.emitAll(resolved, target);
        const report = {
            installed: resolved.map(r => r.ref),
            filesWritten: [],
            conflicts: [],
            duration: 0,
        };
        if (!options.dryRun) {
            // Merge files into workspace
            const mergeReport = await this.workspaceManager.mergeFiles(fileOps, lock, options.conflictStrategy ?? 'backup');
            report.filesWritten = mergeReport.written;
            report.conflicts = mergeReport.conflicts;
            // Update lockfile
            const newLock = {
                version: '1',
                lockedAt: new Date().toISOString(),
                artifacts: {},
            };
            for (const artifact of resolved) {
                // Skip workspace-config artifacts — only skill|agent|plugin go in the lock file
                if (artifact.ref.type === 'workspace-config') {
                    continue;
                }
                const files = fileOps
                    .filter(op => op.sourceRef.id === artifact.ref.id && op.sourceRef.type === artifact.ref.type)
                    .map(op => op.path);
                const sha = this.workspaceManager.computeSha256(artifact.bundle.content);
                const lockKey = `${artifact.ref.type}:${artifact.ref.id}`;
                newLock.artifacts[lockKey] = {
                    id: artifact.ref.id,
                    type: artifact.ref.type,
                    version: artifact.bundle.meta.version,
                    registry: 'local',
                    sha256: sha,
                    files,
                    resolvedAt: new Date().toISOString(),
                };
            }
            await this.workspaceManager.writeLock(newLock);
        }
        else {
            report.filesWritten = fileOps.map(op => op.path);
        }
        report.duration = Date.now() - startTime;
        return report;
    }
    /**
     * Remove artifacts from forge.yaml and clean lockfile-tracked files.
     */
    async remove(refStrings) {
        const refs = Array.isArray(refStrings) ? refStrings : [refStrings];
        const config = await this.workspaceManager.readConfig();
        for (const refStr of refs) {
            const ref = this.parseRef(refStr);
            if (ref.type === 'skill')
                delete config.artifacts.skills[ref.id];
            else if (ref.type === 'agent')
                delete config.artifacts.agents[ref.id];
            else if (ref.type === 'plugin')
                delete config.artifacts.plugins[ref.id];
        }
        await this.workspaceManager.writeConfig(config);
    }
    /**
     * Resolve a single artifact ref (for forge_resolve MCP tool).
     */
    async resolve(refString) {
        const ref = this.parseRef(refString);
        const registry = await this.buildRegistry();
        const resolver = new resolver_js_1.Resolver(registry);
        resolver.reset();
        return resolver.resolve(ref);
    }
    /**
     * List installed (from lock) or available (from registry) artifacts.
     */
    async list(scope = 'available', type) {
        if (scope === 'installed') {
            const lock = await this.workspaceManager.readLock();
            let artifacts = Object.values(lock.artifacts).map(a => ({
                ref: { type: a.type, id: a.id, version: a.version },
                name: a.id,
                description: '',
                tags: [],
            }));
            if (type) {
                artifacts = artifacts.filter(a => a.ref.type === type);
            }
            return artifacts;
        }
        const registry = await this.buildRegistry();
        return registry.list(type);
    }
    /**
     * Read the current forge.yaml config.
     */
    async getConfig() {
        return this.workspaceManager.readConfig();
    }
    /**
     * Scan configured directories for git repositories and update the index.
     * After scanning, upserts all repos into Typesense (when available).
     */
    async repoScan() {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const { scan_paths, index_path } = globalConfig.repos;
        if (scan_paths.length === 0) {
            throw new Error('No scan paths configured. Run: forge config set repos.scan_paths ~/Repositories');
        }
        const existing = await (0, repo_index_store_js_1.loadRepoIndex)(index_path);
        const index = await (0, repo_scanner_js_1.scan)(scan_paths, existing ?? undefined);
        await (0, repo_index_store_js_1.saveRepoIndex)(index, index_path);
        // Index all repos into Typesense (graceful — errors are swallowed inside indexRepos)
        const searchClient = this.getSearchClient();
        if (searchClient) {
            await searchClient.indexRepos(index.repos);
        }
        return index;
    }
    /**
     * List repositories from the index, optionally filtered by query.
     */
    async repoList(query) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const { index_path, scan_paths, host_repos_path } = globalConfig.repos;
        let index = await (0, repo_index_store_js_1.loadRepoIndex)(index_path);
        // Auto-scan if no index exists and scan_paths configured
        if (!index && scan_paths.length > 0) {
            console.log('[Forge] No repo index found. Running initial scan...');
            index = await this.repoScan();
        }
        if (!index)
            return [];
        const query_obj = new repo_index_query_js_1.RepoIndexQuery(index.repos);
        const results = query ? query_obj.search(query) : query_obj.listAll();
        return results.map(r => translateRepoPath(r, scan_paths, host_repos_path));
    }
    /**
     * Resolve a repository by name or remote URL.
     * When resolving by name, tries Typesense fuzzy search first for typo tolerance,
     * then falls back to exact/substring matching in the local index.
     */
    async repoResolve(opts) {
        if (!opts.name && !opts.remoteUrl) {
            throw new Error('Either name or remoteUrl must be provided');
        }
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const { index_path, scan_paths, host_repos_path } = globalConfig.repos;
        let index = await (0, repo_index_store_js_1.loadRepoIndex)(index_path);
        // Auto-scan if no index exists
        if (!index && scan_paths.length > 0) {
            console.log('[Forge] No repo index found. Running initial scan...');
            index = await this.repoScan();
        }
        if (!index)
            return null;
        const q = new repo_index_query_js_1.RepoIndexQuery(index.repos);
        let entry = null;
        if (opts.name) {
            // Try Typesense fuzzy search first (handles typos and partial matches)
            const searchClient = this.getSearchClient();
            if (searchClient) {
                const hits = await searchClient.searchRepos(opts.name);
                if (hits !== null && hits.length > 0) {
                    // Take the top result and look it up in the local index for full data
                    entry = q.findByName(hits[0]);
                }
            }
            // Fallback: exact name match in the local index
            if (!entry) {
                entry = q.findByName(opts.name);
            }
        }
        else if (opts.remoteUrl) {
            entry = q.findByRemoteUrl(opts.remoteUrl);
        }
        return entry ? translateRepoPath(entry, scan_paths, host_repos_path) : null;
    }
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
    async repoWorkflow(repoName) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const indexPath = globalConfig.repos.index_path;
        // --- Tier 0: Confirmed workflow in repo index ---
        const repoIndex = await (0, repo_index_store_js_1.loadRepoIndex)(indexPath);
        if (repoIndex) {
            const q = new repo_index_query_js_1.RepoIndexQuery(repoIndex.repos);
            const entry = q.findByName(repoName);
            if (entry?.workflow) {
                // Check for staleness: compare current remotes to the snapshot at confirmation time
                const stalenessWarning = await this._checkWorkflowStaleness(entry.localPath, entry.workflow);
                const hosting = (0, vault_client_js_1.extractHostingFromUrl)(entry.remoteUrl);
                return {
                    repoName,
                    hosting,
                    workflow: {
                        strategy: entry.workflow.type,
                        defaultBranch: entry.defaultBranch,
                        prTarget: entry.workflow.prTarget.branch,
                        branchConvention: entry.workflow.branchPattern,
                    },
                    source: 'index',
                    confirmedAt: entry.workflow.confirmedAt,
                    confirmedBy: entry.workflow.confirmedBy,
                    stalenessWarning: stalenessWarning ?? undefined,
                };
            }
        }
        const vaultEndpoint = globalConfig.mcp_endpoints.vault;
        // --- Tier 1: Vault repo profile ---
        if (vaultEndpoint) {
            try {
                const client = new vault_client_js_1.VaultClient(vaultEndpoint.url);
                const profile = await client.fetchRepoProfile(repoName);
                if (profile?.workflow?.strategy) {
                    const strategy = profile.workflow.strategy;
                    const defaultBranch = profile.workflow['default-branch'] ?? 'main';
                    return {
                        repoName,
                        hosting: {
                            hostname: profile.hosting?.hostname ?? 'github.com',
                            org: profile.hosting?.org ?? '',
                        },
                        workflow: {
                            strategy,
                            defaultBranch,
                            prTarget: profile.workflow['pr-target'] ?? defaultBranch,
                            branchConvention: profile.workflow['branch-convention'],
                        },
                        source: 'vault',
                    };
                }
            }
            catch {
                // Vault unreachable — fall through to auto-detect
            }
        }
        // --- Tier 2: Auto-detect from local git remotes ---
        const repo = await this.repoResolve({ name: repoName });
        if (repo) {
            const detected = await this._detectWorkflowFull(repo.localPath, repo.remoteUrl);
            const hosting = (0, vault_client_js_1.extractHostingFromUrl)(repo.remoteUrl);
            return {
                repoName,
                hosting,
                workflow: {
                    strategy: detected.type,
                    defaultBranch: repo.defaultBranch,
                    prTarget: repo.defaultBranch,
                },
                source: 'auto-detect',
                needsConfirmation: true,
                autoDetected: {
                    type: detected.type,
                    upstream: detected.upstream,
                    fork: detected.fork,
                    pushTo: detected.pushTo,
                    prTarget: {
                        repo: hosting.org ? `${hosting.org}/${repoName}` : repoName,
                        branch: repo.defaultBranch,
                    },
                    remotesSnapshot: detected.remotesSnapshot,
                },
            };
        }
        // --- Tier 3: Default fallback ---
        return {
            repoName,
            hosting: { hostname: 'github.com', org: '' },
            workflow: { strategy: 'direct', defaultBranch: 'main', prTarget: 'main' },
            source: 'default',
            needsConfirmation: true,
            autoDetected: {
                type: 'owner',
                pushTo: 'origin',
                prTarget: { repo: repoName, branch: 'main' },
            },
        };
    }
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
    async repoWorkflowSave(repoName, workflow, confirmedBy = 'user') {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const indexPath = globalConfig.repos.index_path;
        let repoIndex = await (0, repo_index_store_js_1.loadRepoIndex)(indexPath);
        if (!repoIndex) {
            if (globalConfig.repos.scan_paths.length > 0) {
                repoIndex = await this.repoScan();
            }
            else {
                throw new errors_js_1.ForgeError('REPO_INDEX_NOT_FOUND', 'Repository index not found.', 'Run: forge repo scan');
            }
        }
        const q = new repo_index_query_js_1.RepoIndexQuery(repoIndex.repos);
        const entry = q.findByName(repoName);
        if (!entry) {
            throw new errors_js_1.ForgeError('REPO_NOT_FOUND', `Repository "${repoName}" not found in index.`, 'Run: forge repo scan');
        }
        const confirmedAt = new Date().toISOString();
        const savedWorkflow = {
            ...workflow,
            confirmedAt,
            confirmedBy,
        };
        const updatedRepos = repoIndex.repos.map(r => r.name === repoName ? { ...r, workflow: savedWorkflow } : r);
        await (0, repo_index_store_js_1.saveRepoIndex)({ ...repoIndex, repos: updatedRepos }, indexPath);
        return savedWorkflow;
    }
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
    async repoDevelop(opts) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        let repoIndex = await (0, repo_index_store_js_1.loadRepoIndex)(globalConfig.repos.index_path);
        // Auto-scan if no index exists
        if (!repoIndex && globalConfig.repos.scan_paths.length > 0) {
            repoIndex = await this.repoScan();
        }
        // Provide a saveRepoIndex callback so repoDevelop can persist workflow saves
        const saveRepoIndexFn = async (repos) => {
            const currentIndex = await (0, repo_index_store_js_1.loadRepoIndex)(globalConfig.repos.index_path);
            if (currentIndex) {
                await (0, repo_index_store_js_1.saveRepoIndex)({ ...currentIndex, repos }, globalConfig.repos.index_path);
            }
        };
        return (0, repo_develop_js_1.repoDevelop)(opts, globalConfig, repoIndex, saveRepoIndexFn);
    }
    /**
     * List active code sessions, optionally filtered by repo and/or workItem.
     */
    async sessionList(opts = {}) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        return (0, session_list_js_1.sessionList)(opts, globalConfig);
    }
    /**
     * Clean up sessions based on workItem, age threshold, or auto-policy.
     *
     * Auto-policy queries Anvil for work item status:
     *   - done (7+ days ago) → eligible
     *   - cancelled → eligible immediately
     *   - in_progress / in_review → skip
     *   - not found → warn, skip
     */
    async sessionCleanup(opts) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        return (0, session_cleanup_js_1.sessionCleanup)(opts, globalConfig);
    }
    /**
     * Create a new workspace from a workspace config artifact.
     * Resolves the workspace config, sets up folders, installs plugins,
     * creates git worktrees, and registers in metadata store.
     */
    async workspaceCreate(options) {
        const creator = new workspace_creator_js_1.WorkspaceCreator(this);
        return creator.create(options);
    }
    /**
     * List workspaces, optionally filtered by status.
     */
    async workspaceList(filter) {
        const store = await this.getMetadataStore();
        const filterObj = filter?.status ? { status: filter.status } : undefined;
        return store.list(filterObj);
    }
    /**
     * Find the first workspace linked to a story ID. Returns null if not found.
     */
    async workspaceFindByStory(storyId) {
        const store = await this.getMetadataStore();
        return store.findByStoryId(storyId);
    }
    /**
     * Get status of a workspace.
     */
    async workspaceStatus(id) {
        const store = await this.getMetadataStore();
        return store.get(id);
    }
    /**
     * Pause a workspace.
     */
    async workspacePause(id) {
        return (await this.getLifecycleManager()).pause(id);
    }
    /**
     * Complete a workspace.
     */
    async workspaceComplete(id) {
        return (await this.getLifecycleManager()).complete(id);
    }
    /**
     * Delete a workspace.
     */
    async workspaceDelete(id, opts) {
        return (await this.getLifecycleManager()).delete(id, opts);
    }
    /**
     * Archive a workspace.
     */
    async workspaceArchive(id) {
        return (await this.getLifecycleManager()).archive(id);
    }
    /**
     * Clean workspaces based on retention policy.
     */
    async workspaceClean(opts) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const retentionDays = globalConfig.workspace.retention_days;
        return (await this.getLifecycleManager()).clean(retentionDays, opts);
    }
    // ─── Global Plugin Management ───
    /**
     * Install a plugin globally to ~/.claude/.
     *
     * 1. Resolves the plugin via the registry
     * 2. Emits skills to ~/.claude/skills/ using GlobalClaudeCodeStrategy
     * 3. Reads plugin's resources/rules/global-rules.md
     * 4. Upserts a managed section in ~/.claude/CLAUDE.md
     * 5. Tracks installed files in ~/Horus/data/config/forge.yaml global_plugins
     */
    async installGlobal(ref) {
        const parsed = this.parseRef(ref);
        if (parsed.type !== 'plugin') {
            throw new errors_js_1.ForgeError('INVALID_REF', `Global install only supports plugins, got '${parsed.type}'`, 'Use format: plugin:my-plugin@1.0.0');
        }
        const registry = await this.buildRegistry();
        const resolver = new resolver_js_1.Resolver(registry);
        resolver.reset();
        const resolved = await resolver.resolve(parsed);
        // Emit skills/agents to ~/.claude/ using global strategy
        const claudeDir = path_1.default.join(os_1.default.homedir(), '.claude');
        const globalStrategy = new global_claude_code_strategy_js_1.GlobalClaudeCodeStrategy(claudeDir);
        const output = globalStrategy.emit(resolved);
        const filesWritten = [];
        for (const op of output.operations) {
            const dir = path_1.default.dirname(op.path);
            await fs_1.promises.mkdir(dir, { recursive: true });
            await fs_1.promises.writeFile(op.path, op.content, 'utf-8');
            filesWritten.push(op.path);
        }
        // Read plugin's global-rules.md resource file
        let claudeMdUpdated = false;
        const adapter = await this.findAdapterWithResource(registry, parsed);
        if (adapter) {
            const rulesContent = await adapter.readResourceFile('plugin', parsed.id, 'resources/rules/global-rules.md');
            if (rulesContent) {
                const claudeMdPath = path_1.default.join(claudeDir, 'CLAUDE.md');
                let existing;
                try {
                    existing = await fs_1.promises.readFile(claudeMdPath, 'utf-8');
                }
                catch (err) {
                    if (err.code !== 'ENOENT')
                        throw err;
                }
                const updated = (0, claude_md_writer_js_1.upsertManagedSection)(existing, parsed.id, rulesContent);
                await fs_1.promises.mkdir(claudeDir, { recursive: true });
                await fs_1.promises.writeFile(claudeMdPath, updated, 'utf-8');
                claudeMdUpdated = true;
            }
        }
        // Track in global config
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        globalConfig.global_plugins[parsed.id] = {
            version: resolved.bundle.meta.version,
            installed_at: new Date().toISOString(),
            files: filesWritten,
        };
        await (0, global_config_loader_js_1.saveGlobalConfig)(globalConfig, this.globalConfigPath);
        return {
            pluginId: parsed.id,
            version: resolved.bundle.meta.version,
            filesWritten,
            claudeMdUpdated,
        };
    }
    /**
     * Uninstall a globally installed plugin.
     *
     * 1. Reads tracked files from global_plugins
     * 2. Deletes skill/agent files from ~/.claude/
     * 3. Removes managed section from ~/.claude/CLAUDE.md
     * 4. Removes entry from global config
     */
    async uninstallGlobal(pluginId) {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const entry = globalConfig.global_plugins[pluginId];
        if (!entry) {
            throw new errors_js_1.ForgeError('NOT_FOUND', `Plugin '${pluginId}' is not globally installed`, 'Run: forge global list');
        }
        // Delete tracked files
        for (const filePath of entry.files) {
            try {
                await fs_1.promises.unlink(filePath);
                // Try to remove empty parent directories
                const dir = path_1.default.dirname(filePath);
                try {
                    await fs_1.promises.rmdir(dir);
                }
                catch {
                    // Directory not empty — fine
                }
            }
            catch (err) {
                if (err.code !== 'ENOENT') {
                    console.warn(`[ForgeCore] Could not delete ${filePath}: ${err.message}`);
                }
            }
        }
        // Remove managed section from CLAUDE.md
        const claudeMdPath = path_1.default.join(os_1.default.homedir(), '.claude', 'CLAUDE.md');
        try {
            const existing = await fs_1.promises.readFile(claudeMdPath, 'utf-8');
            const updated = (0, claude_md_writer_js_1.removeManagedSection)(existing, pluginId);
            await fs_1.promises.writeFile(claudeMdPath, updated, 'utf-8');
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`[ForgeCore] Could not update CLAUDE.md: ${err.message}`);
            }
        }
        // Remove from global config
        delete globalConfig.global_plugins[pluginId];
        await (0, global_config_loader_js_1.saveGlobalConfig)(globalConfig, this.globalConfigPath);
    }
    /**
     * List all globally installed plugins.
     */
    async listGlobal() {
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        return Object.entries(globalConfig.global_plugins).map(([id, entry]) => ({
            id,
            version: entry.version,
            installedAt: entry.installed_at,
            files: entry.files,
        }));
    }
    /**
     * Find an adapter in the registry that supports readResourceFile for a given artifact.
     */
    async findAdapterWithResource(registry, ref) {
        // Build adapters directly to access readResourceFile
        let config = null;
        try {
            config = await this.workspaceManager.readConfig();
        }
        catch {
            // No workspace config
        }
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        const registries = config
            ? [...config.registries, ...globalConfig.registries.filter(r => !config.registries.some(cr => cr.name === r.name))]
            : globalConfig.registries;
        for (const reg of registries) {
            try {
                const adapter = this.buildAdapter(reg);
                if (adapter.readResourceFile && await adapter.exists(ref.type, ref.id)) {
                    return adapter;
                }
            }
            catch {
                // Skip failed adapters
            }
        }
        return null;
    }
    // Internal helpers
    /**
     * Fetch all remotes and their fetch URLs from a local git repository.
     * Returns a map of { remoteName → fetchUrl }.
     * Returns empty map on any error.
     */
    async _listRemotes(localPath) {
        try {
            const { stdout } = await execFileAsync('git', ['remote', '-v'], { cwd: localPath, timeout: 3000 });
            const result = {};
            for (const line of stdout.trim().split('\n')) {
                // Each line: "remoteName\turl (fetch)" or "remoteName\turl (push)"
                const fetchMatch = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
                if (fetchMatch) {
                    result[fetchMatch[1]] = fetchMatch[2];
                }
            }
            return result;
        }
        catch {
            return {};
        }
    }
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
    async _detectWorkflowFull(localPath, remoteUrl) {
        const remotes = await this._listRemotes(localPath);
        if (remotes['upstream']) {
            // Fork workflow: origin is the user's fork, upstream is the canonical repo
            return {
                type: 'fork',
                upstream: remotes['upstream'],
                fork: remotes['origin'],
                pushTo: 'origin',
                remotesSnapshot: remotes,
            };
        }
        // Default: owner workflow (user has full commit access to origin)
        return {
            type: 'owner',
            pushTo: 'origin',
            remotesSnapshot: remotes,
        };
    }
    /**
     * Check whether the workflow metadata may be stale by comparing the current
     * remote URLs to the snapshot taken at confirmation time.
     *
     * Returns a warning string if remotes have changed, null if unchanged.
     * On any git error, returns null (fail silently).
     */
    async _checkWorkflowStaleness(localPath, workflow) {
        if (!workflow.remotesSnapshot)
            return null;
        const currentRemotes = await this._listRemotes(localPath);
        const snapshot = workflow.remotesSnapshot;
        // Check for any additions, removals, or URL changes
        const snapshotKeys = Object.keys(snapshot);
        const currentKeys = Object.keys(currentRemotes);
        const added = currentKeys.filter(k => !snapshot[k]);
        const removed = snapshotKeys.filter(k => !currentRemotes[k]);
        const changed = snapshotKeys.filter(k => currentRemotes[k] && currentRemotes[k] !== snapshot[k]);
        if (added.length > 0 || removed.length > 0 || changed.length > 0) {
            const parts = [];
            if (added.length > 0)
                parts.push(`added: ${added.join(', ')}`);
            if (removed.length > 0)
                parts.push(`removed: ${removed.join(', ')}`);
            if (changed.length > 0)
                parts.push(`changed: ${changed.join(', ')}`);
            return `Workflow may be stale — remotes have changed since confirmation (${parts.join('; ')}). Consider re-confirming via forge_repo_workflow.`;
        }
        return null;
    }
    /**
     * @deprecated Use _detectWorkflowFull instead.
     * Kept for backward compatibility with any callers that only need the strategy string.
     */
    async _detectWorkflowStrategy(localPath) {
        const detected = await this._detectWorkflowFull(localPath, null);
        return detected.type;
    }
    async buildRegistry() {
        let config = null;
        try {
            config = await this.workspaceManager.readConfig();
        }
        catch {
            // No workspace config — fall through to global config below
        }
        // Load global config (~/Horus/data/config/forge.yaml) for fallback registries
        const globalConfig = await (0, global_config_loader_js_1.loadGlobalConfig)(this.globalConfigPath);
        if (!config) {
            // No workspace forge.yaml — use global config registries only
            const adapters = [];
            for (const reg of globalConfig.registries) {
                try {
                    adapters.push(this.buildAdapter(reg));
                }
                catch (err) {
                    console.warn(`[ForgeCore] Skipping registry '${reg.name}': ${err.message}`);
                }
            }
            if (adapters.length === 0) {
                return new registry_js_1.Registry(new filesystem_adapter_js_1.FilesystemAdapter(path_1.default.join(this.workspaceRoot, 'registry')));
            }
            const adapter = adapters.length === 1 ? adapters[0] : new composite_adapter_js_1.CompositeAdapter({ adapters });
            return new registry_js_1.Registry(adapter);
        }
        // Workspace registries first (higher priority), then global as fallbacks.
        // Deduplicate by name — workspace overrides global.
        const workspaceNames = new Set(config.registries.map(r => r.name));
        const globalFallbacks = globalConfig.registries.filter(r => !workspaceNames.has(r.name));
        const allRegistries = [...config.registries, ...globalFallbacks];
        if (allRegistries.length === 0) {
            return new registry_js_1.Registry(new filesystem_adapter_js_1.FilesystemAdapter(path_1.default.join(this.workspaceRoot, 'registry')));
        }
        // Build an adapter for each configured registry
        const adapters = [];
        for (const reg of allRegistries) {
            try {
                adapters.push(this.buildAdapter(reg));
            }
            catch (err) {
                console.warn(`[ForgeCore] Skipping registry '${reg.name}': ${err.message}`);
            }
        }
        if (adapters.length === 0) {
            // All registries failed to construct — fall back to local default
            return new registry_js_1.Registry(new filesystem_adapter_js_1.FilesystemAdapter(path_1.default.join(this.workspaceRoot, 'registry')));
        }
        // Single adapter → use directly; multiple → compose with priority ordering
        const adapter = adapters.length === 1
            ? adapters[0]
            : new composite_adapter_js_1.CompositeAdapter({ adapters });
        return new registry_js_1.Registry(adapter);
    }
    /**
     * Instantiate the correct DataAdapter for a registry config entry.
     */
    buildAdapter(reg) {
        switch (reg.type) {
            case 'filesystem': {
                const registryPath = path_1.default.isAbsolute(reg.path)
                    ? reg.path
                    : path_1.default.join(this.workspaceRoot, reg.path);
                return new filesystem_adapter_js_1.FilesystemAdapter(registryPath);
            }
            case 'git': {
                return new git_adapter_js_1.GitAdapter({
                    url: reg.url,
                    ref: reg.branch,
                    registryPath: reg.path,
                });
            }
            case 'http':
                throw new errors_js_1.ForgeError('UNSUPPORTED', `HTTP registries are not yet implemented (registry: '${reg.name}')`, 'Use a filesystem or git registry instead.');
            default:
                throw new errors_js_1.ForgeError('INVALID_CONFIG', `Unknown registry type in config`, 'Supported types: filesystem, git');
        }
    }
    parseRef(refStr) {
        // Format: "type:id@version" or "type:id" or "id@version" or "id"
        let type = 'skill';
        let id;
        let version = '*';
        let remaining = refStr;
        // Extract type prefix
        if (remaining.startsWith('skill:')) {
            type = 'skill';
            remaining = remaining.slice(6);
        }
        else if (remaining.startsWith('agent:')) {
            type = 'agent';
            remaining = remaining.slice(6);
        }
        else if (remaining.startsWith('plugin:')) {
            type = 'plugin';
            remaining = remaining.slice(7);
        }
        else if (remaining.startsWith('workspace-config:')) {
            type = 'workspace-config';
            remaining = remaining.slice(17);
        }
        // Extract version suffix
        const atIdx = remaining.indexOf('@');
        if (atIdx !== -1) {
            id = remaining.slice(0, atIdx);
            version = remaining.slice(atIdx + 1);
        }
        else {
            id = remaining;
        }
        if (!id) {
            throw new errors_js_1.ForgeError('INVALID_REF', `Invalid artifact ref: '${refStr}'`, `Use format: skill:my-skill@1.0.0`);
        }
        return { type, id, version };
    }
}
exports.ForgeCore = ForgeCore;
// Re-export Registry for convenience
var registry_js_2 = require("./registry/registry.js");
Object.defineProperty(exports, "Registry", { enumerable: true, get: function () { return registry_js_2.Registry; } });
//# sourceMappingURL=core.js.map