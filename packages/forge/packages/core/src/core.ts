import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WorkspaceManager } from './workspace/workspace-manager.js';
import { WorkspaceCreator, type WorkspaceCreateOptions } from './workspace/workspace-creator.js';
import { WorkspaceLifecycleManager } from './workspace/workspace-lifecycle.js';
import { WorkspaceMetadataStore } from './workspace/workspace-metadata-store.js';
import { Registry, type PublishResult } from './registry/registry.js';
import { Resolver } from './resolver/resolver.js';
import { Compiler } from './compiler/compiler.js';
import { ClaudeCodeStrategy } from './compiler/claude-code-strategy.js';
import { CursorStrategy } from './compiler/cursor-strategy.js';
import { GlobalClaudeCodeStrategy } from './compiler/global-claude-code-strategy.js';
import { upsertManagedSection, removeManagedSection } from './compiler/claude-md-writer.js';
import { FilesystemAdapter } from './adapters/filesystem-adapter.js';
import { CompositeAdapter } from './adapters/composite-adapter.js';
import { GitAdapter } from './adapters/git-adapter.js';
import type { DataAdapter } from './adapters/types.js';
import type {
  ArtifactRef,
  ArtifactSummary,
  ArtifactBundle,
  ArtifactType,
  InstallReport,
  SearchResult,
  ResolvedArtifact,
  LockFile,
  WorkspaceRecord,
} from './models/index.js';
import type { GlobalPluginEntry } from './models/global-config.js';
import type { ForgeConfig, RegistryConfig } from './models/forge-config.js';
import type { RepoIndex, RepoIndexEntry, RepoIndexWorkflow } from './models/repo-index.js';
import type { RepoWorkflow, WorkflowStrategy } from './models/repo-workflow.js';
import { ForgeError } from './adapters/errors.js';
import { loadGlobalConfig, saveGlobalConfig } from './config/global-config-loader.js';
import { scan as repoScannerScan } from './repo/repo-scanner.js';
import { loadRepoIndex, saveRepoIndex } from './repo/repo-index-store.js';
import { RepoIndexQuery } from './repo/repo-index-query.js';
import { VaultClient, extractHostingFromUrl } from './vault/vault-client.js';
import { repoDevelop, type RepoDevelopOptions, type RepoDevelopResponse } from './repo/repo-develop.js';
import { sessionList, type SessionListOptions, type SessionListResult } from './session/session-list.js';
import { sessionCleanup, type SessionCleanupOptions, type SessionCleanupResult } from './session/session-cleanup.js';
import { ForgeSearchClient } from './search/forge-search-client.js';

const execFileAsync = promisify(execFile);

/**
 * Translate a Docker-internal repo localPath to the equivalent host path.
 * Returns the entry unchanged if host_repos_path is not configured or
 * the localPath doesn't start with any of the configured scan_paths.
 */
export function translateRepoPath(
  entry: RepoIndexEntry,
  scanPaths: string[],
  hostReposPath: string | undefined
): RepoIndexEntry {
  if (!hostReposPath) return entry;

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
  prTarget: { repo: string; branch: string };
  branchPattern?: string;
  commitFormat?: string;
  remotesSnapshot?: Record<string, string>;
}

export interface RepoResolveResult {
  /** The resolved repo entry, or null if not found or ambiguous. */
  match: RepoIndexEntry | null;
  /** True when multiple repos share the same name and disambiguation is needed. */
  ambiguous: boolean;
  /** All matching entries (>1 when ambiguous, 0-1 otherwise). */
  allMatches: RepoIndexEntry[];
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

export class ForgeCore {
  private readonly workspaceManager: WorkspaceManager;
  private readonly compiler: Compiler;
  private readonly globalConfigPath: string | undefined;
  private _metadataStore?: WorkspaceMetadataStore;
  private _lifecycleManager?: WorkspaceLifecycleManager;
  /** Lazily initialized — null when Typesense is not configured. */
  private _searchClient?: ForgeSearchClient | null;

  constructor(
    private readonly workspaceRoot: string = process.cwd(),
    options?: ForgeCoreOptions,
  ) {
    this.workspaceManager = new WorkspaceManager(workspaceRoot);
    this.compiler = new Compiler();
    this.compiler.register(new ClaudeCodeStrategy());
    this.compiler.register(new CursorStrategy());
    this.globalConfigPath = options?.globalConfigPath;
  }

  /**
   * Return the ForgeSearchClient if Typesense is configured, or null otherwise.
   * Initialised once and cached.
   */
  private getSearchClient(): ForgeSearchClient | null {
    if (this._searchClient === undefined) {
      this._searchClient = ForgeSearchClient.create();
    }
    return this._searchClient;
  }

  private async getMetadataStore(): Promise<WorkspaceMetadataStore> {
    if (!this._metadataStore) {
      const globalConfig = await loadGlobalConfig(this.globalConfigPath);
      this._metadataStore = new WorkspaceMetadataStore(globalConfig.workspace.store_path);
    }
    return this._metadataStore;
  }

  private async getLifecycleManager(): Promise<WorkspaceLifecycleManager> {
    if (!this._lifecycleManager) {
      const store = await this.getMetadataStore();
      this._lifecycleManager = new WorkspaceLifecycleManager(undefined, store);
    }
    return this._lifecycleManager;
  }

  /**
   * Initialize a new Forge workspace.
   * Creates forge.yaml and forge.lock.
   */
  async init(name: string): Promise<void> {
    await this.workspaceManager.scaffoldWorkspace(name);
  }

  /**
   * Search the registry for artifacts matching a query.
   * Uses in-memory scoring via the Registry adapter.
   *
   * TODO: When a registry-level "scan" or "sync" hook exists, call
   * searchClient.indexArtifact() for each entry so Typesense fuzzy search
   * can be used here (similar to how repoScan() indexes repos).
   */
  async search(query: string, type?: ArtifactType): Promise<SearchResult[]> {
    const registry = await this.buildRegistry();
    return registry.search(query, type);
  }

  /**
   * Add artifact ref(s) to forge.yaml.
   * Validates the artifact exists in the registry before adding.
   */
  async add(refStrings: string | string[]): Promise<ForgeConfig> {
    const refs = Array.isArray(refStrings) ? refStrings : [refStrings];
    const config = await this.workspaceManager.readConfig();
    const registry = await this.buildRegistry();

    for (const refStr of refs) {
      const ref = this.parseRef(refStr);

      // Best-effort check: warn if artifact not found in any registry
      if (config.registries.length > 0) {
        try {
          await registry.get(ref);
        } catch {
          console.warn(`[ForgeCore] Warning: '${refStr}' not found in any registry. Adding anyway.`);
        }
      }

      // Add to config
      if (ref.type === 'skill') {
        config.artifacts.skills[ref.id] = ref.version;
      } else if (ref.type === 'agent') {
        config.artifacts.agents[ref.id] = ref.version;
      } else if (ref.type === 'plugin') {
        config.artifacts.plugins[ref.id] = ref.version;
      } else if (ref.type === 'persona') {
        config.artifacts.personas[ref.id] = ref.version;
      }
    }

    await this.workspaceManager.writeConfig(config);
    return config;
  }

  /**
   * Run the full install pipeline:
   * readConfig → resolveAll → emitAll → mergeFiles → writeLock
   */
  async install(options: InstallOptions = {}): Promise<InstallReport> {
    const startTime = Date.now();
    const config = await this.workspaceManager.readConfig();
    const lock = await this.workspaceManager.readLock();
    const registry = await this.buildRegistry();
    const resolver = new Resolver(registry);

    // Build ref list from config artifacts
    const refs: ArtifactRef[] = [
      ...Object.entries(config.artifacts.skills).map(([id, version]) => ({
        type: 'skill' as const, id, version,
      })),
      ...Object.entries(config.artifacts.agents).map(([id, version]) => ({
        type: 'agent' as const, id, version,
      })),
      ...Object.entries(config.artifacts.plugins).map(([id, version]) => ({
        type: 'plugin' as const, id, version,
      })),
      ...Object.entries(config.artifacts.personas).map(([id, version]) => ({
        type: 'persona' as const, id, version,
      })),
    ];

    // Resolve all artifacts
    resolver.reset();
    const resolved = await resolver.resolveAll(refs);

    // Compile to file operations
    const target = options.target ?? config.target;
    const fileOps = this.compiler.emitAll(resolved, target);

    const report: InstallReport = {
      installed: resolved.map(r => r.ref),
      filesWritten: [],
      conflicts: [],
      duration: 0,
    };

    if (!options.dryRun) {
      // Merge files into workspace
      const mergeReport = await this.workspaceManager.mergeFiles(
        fileOps,
        lock,
        options.conflictStrategy ?? 'backup',
      );

      report.filesWritten = mergeReport.written;
      report.conflicts = mergeReport.conflicts;

      // Update lockfile
      const newLock: LockFile = {
        version: '1',
        lockedAt: new Date().toISOString(),
        artifacts: {},
      };

      for (const artifact of resolved) {
        // Skip workspace-config artifacts — only skill|agent|plugin|persona go in the lock file
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
          type: artifact.ref.type as 'skill' | 'agent' | 'plugin' | 'persona',
          version: artifact.bundle.meta.version,
          registry: 'local',
          sha256: sha,
          files,
          resolvedAt: new Date().toISOString(),
        };
      }

      await this.workspaceManager.writeLock(newLock);
    } else {
      report.filesWritten = fileOps.map(op => op.path);
    }

    report.duration = Date.now() - startTime;
    return report;
  }

  /**
   * Remove artifacts from forge.yaml and clean lockfile-tracked files.
   */
  async remove(refStrings: string | string[]): Promise<void> {
    const refs = Array.isArray(refStrings) ? refStrings : [refStrings];
    const config = await this.workspaceManager.readConfig();

    for (const refStr of refs) {
      const ref = this.parseRef(refStr);
      if (ref.type === 'skill') delete config.artifacts.skills[ref.id];
      else if (ref.type === 'agent') delete config.artifacts.agents[ref.id];
      else if (ref.type === 'plugin') delete config.artifacts.plugins[ref.id];
      else if (ref.type === 'persona') delete config.artifacts.personas[ref.id];
    }

    await this.workspaceManager.writeConfig(config);
  }

  /**
   * Resolve a single artifact ref (for forge_resolve MCP tool).
   */
  async resolve(refString: string): Promise<ResolvedArtifact> {
    const ref = this.parseRef(refString);
    const registry = await this.buildRegistry();
    const resolver = new Resolver(registry);
    resolver.reset();
    return resolver.resolve(ref);
  }

  /**
   * List installed (from lock) or available (from registry) artifacts.
   */
  async list(scope: 'installed' | 'available' = 'available', type?: ArtifactType): Promise<ArtifactSummary[]> {
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
   * Publish an artifact to a writable registry.
   */
  async publish(
    type: ArtifactType,
    id: string,
    bundle: ArtifactBundle,
    registryName?: string,
  ): Promise<PublishResult> {
    let config: ForgeConfig | null = null;
    try {
      config = await this.workspaceManager.readConfig();
    } catch {
      // No workspace config
    }
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);

    const workspaceRegs = config?.registries ?? [];
    const workspaceNames = new Set(workspaceRegs.map(r => r.name));
    const globalFallbacks = globalConfig.registries.filter(r => !workspaceNames.has(r.name));
    const allRegistries = [...workspaceRegs, ...globalFallbacks];

    const writableConfigs = allRegistries.filter(r => (r.type === 'filesystem' || r.type === 'git') && r.writable !== false);

    if (writableConfigs.length === 0) {
      throw new ForgeError(
        'NO_WRITABLE_REGISTRY',
        'No writable registry configured. Run Horus setup to add a private registry.',
        'Add a filesystem or git registry to forge.yaml or the global config.',
      );
    }

    let targetConfig: RegistryConfig;
    if (registryName) {
      const found = writableConfigs.find(r => r.name === registryName);
      if (!found) {
        const available = writableConfigs.map(r => r.name).join(', ');
        throw new ForgeError(
          'REGISTRY_NOT_FOUND',
          `Registry '${registryName}' not found or is not writable. Writable registries: ${available}`,
          `Use one of: ${available}`,
        );
      }
      targetConfig = found;
    } else {
      targetConfig = writableConfigs[0];
    }

    const adapter = this.buildAdapter(targetConfig);
    const registry = new Registry(adapter, targetConfig.name);

    return registry.publish(type, id, bundle);
  }

  /**
   * Read the current forge.yaml config.
   */
  async getConfig(): Promise<ForgeConfig> {
    return this.workspaceManager.readConfig();
  }

  /**
   * Scan configured directories for git repositories and update the index.
   * After scanning, upserts all repos into Typesense (when available).
   */
  async repoScan(): Promise<RepoIndex> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    const { scan_paths, index_path } = globalConfig.repos;

    if (scan_paths.length === 0) {
      throw new Error('No scan paths configured. Run: forge config set repos.scan_paths ~/Repositories');
    }

    const existing = await loadRepoIndex(index_path);
    const index = await repoScannerScan(scan_paths, existing ?? undefined);
    await saveRepoIndex(index, index_path);

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
  async repoList(query?: string): Promise<RepoIndexEntry[]> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    const { index_path, scan_paths, host_repos_path } = globalConfig.repos;

    let index = await loadRepoIndex(index_path);

    // Auto-scan if no index exists and scan_paths configured
    if (!index && scan_paths.length > 0) {
      console.log('[Forge] No repo index found. Running initial scan...');
      index = await this.repoScan();
    }

    if (!index) return [];

    const query_obj = new RepoIndexQuery(index.repos);
    const results = query ? query_obj.search(query) : query_obj.listAll();
    return results.map(r => translateRepoPath(r, scan_paths, host_repos_path));
  }

  /**
   * Resolve a repository by name or remote URL.
   * When resolving by name, tries Typesense fuzzy search first for typo tolerance,
   * then falls back to exact/substring matching in the local index.
   */
  async repoResolve(opts: { name?: string; remoteUrl?: string }): Promise<RepoResolveResult> {
    if (!opts.name && !opts.remoteUrl) {
      throw new Error('Either name or remoteUrl must be provided');
    }

    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    const { index_path, scan_paths, host_repos_path } = globalConfig.repos;

    let index = await loadRepoIndex(index_path);

    // Auto-scan if no index exists
    if (!index && scan_paths.length > 0) {
      console.log('[Forge] No repo index found. Running initial scan...');
      index = await this.repoScan();
    }

    if (!index) return { match: null, ambiguous: false, allMatches: [] };

    const q = new RepoIndexQuery(index.repos);
    let entry: RepoIndexEntry | null = null;

    if (opts.name) {
      const allByName = q.findAllByName(opts.name);
      if (allByName.length > 1) {
        return {
          match: null,
          ambiguous: true,
          allMatches: allByName.map(e => translateRepoPath(e, scan_paths, host_repos_path)),
        };
      }

      // Try Typesense fuzzy search first (handles typos and partial matches)
      const searchClient = this.getSearchClient();
      if (searchClient) {
        const hits = await searchClient.searchRepos(opts.name);
        if (hits !== null && hits.length > 0) {
          entry = q.findByName(hits[0]);
        }
      }
      if (!entry) {
        entry = allByName[0] ?? null;
      }
    } else if (opts.remoteUrl) {
      entry = q.findByRemoteUrl(opts.remoteUrl);
    }

    return {
      match: entry ? translateRepoPath(entry, scan_paths, host_repos_path) : null,
      ambiguous: false,
      allMatches: entry ? [translateRepoPath(entry, scan_paths, host_repos_path)] : [],
    };
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
  async repoWorkflow(repoName: string): Promise<RepoWorkflowResult> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    const indexPath = globalConfig.repos.index_path;

    // --- Tier 0: Confirmed workflow in repo index ---
    const repoIndex = await loadRepoIndex(indexPath);
    if (repoIndex) {
      const q = new RepoIndexQuery(repoIndex.repos);
      const entry = q.findByName(repoName);
      if (entry?.workflow) {
        // Check for staleness: compare current remotes to the snapshot at confirmation time
        const stalenessWarning = await this._checkWorkflowStaleness(
          entry.localPath,
          entry.workflow,
        );
        const hosting = extractHostingFromUrl(entry.remoteUrl);
        return {
          repoName,
          hosting,
          workflow: {
            strategy: entry.workflow.type as WorkflowStrategy,
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
        const client = new VaultClient(vaultEndpoint.url);
        const profile = await client.fetchRepoProfile(repoName);
        if (profile?.workflow?.strategy) {
          const strategy = profile.workflow.strategy as WorkflowStrategy;
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
      } catch {
        // Vault unreachable — fall through to auto-detect
      }
    }

    // --- Tier 2: Auto-detect from local git remotes ---
    const resolveResult = await this.repoResolve({ name: repoName });
    const repo = resolveResult.match;
    if (repo) {
      const detected = await this._detectWorkflowFull(repo.localPath, repo.remoteUrl);
      const hosting = extractHostingFromUrl(repo.remoteUrl);
      return {
        repoName,
        hosting,
        workflow: {
          strategy: detected.type as WorkflowStrategy,
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
  async repoWorkflowSave(
    repoName: string,
    workflow: Omit<RepoIndexWorkflow, 'confirmedAt' | 'confirmedBy'>,
    confirmedBy: 'user' | 'auto' = 'user',
  ): Promise<RepoIndexWorkflow> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    const indexPath = globalConfig.repos.index_path;

    let repoIndex = await loadRepoIndex(indexPath);
    if (!repoIndex) {
      if (globalConfig.repos.scan_paths.length > 0) {
        repoIndex = await this.repoScan();
      } else {
        throw new ForgeError(
          'REPO_INDEX_NOT_FOUND',
          'Repository index not found.',
          'Run: forge repo scan',
        );
      }
    }

    const q = new RepoIndexQuery(repoIndex.repos);
    const entry = q.findByName(repoName);
    if (!entry) {
      throw new ForgeError(
        'REPO_NOT_FOUND',
        `Repository "${repoName}" not found in index.`,
        'Run: forge repo scan',
      );
    }

    const confirmedAt = new Date().toISOString();
    const savedWorkflow: RepoIndexWorkflow = {
      ...workflow,
      confirmedAt,
      confirmedBy,
    };

    const updatedRepos = repoIndex.repos.map(r =>
      r.name === repoName ? { ...r, workflow: savedWorkflow } : r,
    );
    await saveRepoIndex({ ...repoIndex, repos: updatedRepos }, indexPath);

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
  async repoDevelop(opts: RepoDevelopOptions): Promise<RepoDevelopResponse> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    let repoIndex = await loadRepoIndex(globalConfig.repos.index_path);

    // Auto-scan if no index exists
    if (!repoIndex && globalConfig.repos.scan_paths.length > 0) {
      repoIndex = await this.repoScan();
    }

    // Provide a saveRepoIndex callback so repoDevelop can persist workflow saves
    const saveRepoIndexFn = async (repos: RepoIndexEntry[]): Promise<void> => {
      const currentIndex = await loadRepoIndex(globalConfig.repos.index_path);
      if (currentIndex) {
        await saveRepoIndex({ ...currentIndex, repos }, globalConfig.repos.index_path);
      }
    };

    return repoDevelop(opts, globalConfig, repoIndex, saveRepoIndexFn);
  }

  /**
   * List active code sessions, optionally filtered by repo and/or workItem.
   */
  async sessionList(opts: SessionListOptions = {}): Promise<SessionListResult> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    return sessionList(opts, globalConfig);
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
  async sessionCleanup(opts: SessionCleanupOptions): Promise<SessionCleanupResult> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    return sessionCleanup(opts, globalConfig);
  }

  /**
   * Create a new workspace from a workspace config artifact.
   * Resolves the workspace config, sets up folders, installs plugins,
   * creates git worktrees, and registers in metadata store.
   */
  async workspaceCreate(options: WorkspaceCreateOptions): Promise<WorkspaceRecord> {
    const creator = new WorkspaceCreator(this);
    return creator.create(options);
  }

  /**
   * List workspaces, optionally filtered by status.
   */
  async workspaceList(filter?: { status?: string }): Promise<WorkspaceRecord[]> {
    const store = await this.getMetadataStore();
    const filterObj = filter?.status ? { status: filter.status as any } : undefined;
    return store.list(filterObj);
  }

  /**
   * Find a workspace by its name. Returns null if not found.
   */
  async workspaceFindByName(name: string): Promise<WorkspaceRecord | null> {
    const store = await this.getMetadataStore();
    return store.findByName(name);
  }

  /**
   * Get status of a workspace.
   */
  async workspaceStatus(id: string): Promise<WorkspaceRecord | null> {
    const store = await this.getMetadataStore();
    return store.get(id);
  }

  /**
   * Pause a workspace.
   */
  async workspacePause(id: string): Promise<WorkspaceRecord> {
    return (await this.getLifecycleManager()).pause(id);
  }

  /**
   * Complete a workspace.
   */
  async workspaceComplete(id: string): Promise<WorkspaceRecord> {
    return (await this.getLifecycleManager()).complete(id);
  }

  /**
   * Delete a workspace.
   */
  async workspaceDelete(id: string, opts?: { force?: boolean }): Promise<void> {
    return (await this.getLifecycleManager()).delete(id, opts);
  }

  /**
   * Archive a workspace.
   */
  async workspaceArchive(id: string): Promise<WorkspaceRecord> {
    return (await this.getLifecycleManager()).archive(id);
  }

  /**
   * Clean workspaces based on retention policy.
   */
  async workspaceClean(opts?: { dryRun?: boolean }): Promise<{ cleaned: string[]; skipped: string[] }> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
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
  async installGlobal(ref: string): Promise<GlobalInstallReport> {
    const parsed = this.parseRef(ref);
    if (parsed.type !== 'plugin') {
      throw new ForgeError('INVALID_REF', `Global install only supports plugins, got '${parsed.type}'`, 'Use format: plugin:my-plugin@1.0.0');
    }

    const registry = await this.buildRegistry();
    const resolver = new Resolver(registry);
    resolver.reset();
    const resolved = await resolver.resolve(parsed);

    // Emit skills/agents to ~/.claude/ using global strategy
    const claudeDir = path.join(os.homedir(), '.claude');
    const globalStrategy = new GlobalClaudeCodeStrategy(claudeDir);
    const output = globalStrategy.emit(resolved);
    const filesWritten: string[] = [];

    for (const op of output.operations) {
      const dir = path.dirname(op.path);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(op.path, op.content, 'utf-8');
      filesWritten.push(op.path);
    }

    // Read plugin's global-rules.md resource file
    let claudeMdUpdated = false;
    const adapter = await this.findAdapterWithResource(registry, parsed);
    if (adapter) {
      const rulesContent = await adapter.readResourceFile!('plugin', parsed.id, 'resources/rules/global-rules.md');
      if (rulesContent) {
        const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
        let existing: string | undefined;
        try {
          existing = await fs.readFile(claudeMdPath, 'utf-8');
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
        }

        const updated = upsertManagedSection(existing, parsed.id, rulesContent);
        await fs.mkdir(claudeDir, { recursive: true });
        await fs.writeFile(claudeMdPath, updated, 'utf-8');
        claudeMdUpdated = true;
      }
    }

    // Track in global config
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    globalConfig.global_plugins[parsed.id] = {
      version: resolved.bundle.meta.version,
      installed_at: new Date().toISOString(),
      files: filesWritten,
    };
    await saveGlobalConfig(globalConfig, this.globalConfigPath);

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
  async uninstallGlobal(pluginId: string): Promise<void> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
    const entry = globalConfig.global_plugins[pluginId];

    if (!entry) {
      throw new ForgeError('NOT_FOUND', `Plugin '${pluginId}' is not globally installed`, 'Run: forge global list');
    }

    // Delete tracked files
    for (const filePath of entry.files) {
      try {
        await fs.unlink(filePath);
        // Try to remove empty parent directories
        const dir = path.dirname(filePath);
        try {
          await fs.rmdir(dir);
        } catch {
          // Directory not empty — fine
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`[ForgeCore] Could not delete ${filePath}: ${err.message}`);
        }
      }
    }

    // Remove managed section from CLAUDE.md
    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    try {
      const existing = await fs.readFile(claudeMdPath, 'utf-8');
      const updated = removeManagedSection(existing, pluginId);
      await fs.writeFile(claudeMdPath, updated, 'utf-8');
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`[ForgeCore] Could not update CLAUDE.md: ${err.message}`);
      }
    }

    // Remove from global config
    delete globalConfig.global_plugins[pluginId];
    await saveGlobalConfig(globalConfig, this.globalConfigPath);
  }

  /**
   * List all globally installed plugins.
   */
  async listGlobal(): Promise<GlobalPluginInfo[]> {
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);
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
  private async findAdapterWithResource(registry: Registry, ref: ArtifactRef): Promise<DataAdapter | null> {
    // Build adapters directly to access readResourceFile
    let config: ForgeConfig | null = null;
    try {
      config = await this.workspaceManager.readConfig();
    } catch {
      // No workspace config
    }
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);

    const registries = config
      ? [...config.registries, ...globalConfig.registries.filter(r => !config!.registries.some(cr => cr.name === r.name))]
      : globalConfig.registries;

    for (const reg of registries) {
      try {
        const adapter = this.buildAdapter(reg);
        if (adapter.readResourceFile && await adapter.exists(ref.type, ref.id)) {
          return adapter;
        }
      } catch {
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
  private async _listRemotes(localPath: string): Promise<Record<string, string>> {
    try {
      const { stdout } = await execFileAsync(
        'git', ['remote', '-v'],
        { cwd: localPath, timeout: 3000 },
      );
      const result: Record<string, string> = {};
      for (const line of stdout.trim().split('\n')) {
        // Each line: "remoteName\turl (fetch)" or "remoteName\turl (push)"
        const fetchMatch = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
        if (fetchMatch) {
          result[fetchMatch[1]] = fetchMatch[2];
        }
      }
      return result;
    } catch {
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
  private async _detectWorkflowFull(
    localPath: string,
    remoteUrl: string | null,
  ): Promise<{
    type: 'owner' | 'fork' | 'contributor';
    upstream?: string;
    fork?: string;
    pushTo: string;
    remotesSnapshot: Record<string, string>;
  }> {
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
  private async _checkWorkflowStaleness(
    localPath: string,
    workflow: RepoIndexWorkflow,
  ): Promise<string | null> {
    if (!workflow.remotesSnapshot) return null;

    const currentRemotes = await this._listRemotes(localPath);
    const snapshot = workflow.remotesSnapshot;

    // Check for any additions, removals, or URL changes
    const snapshotKeys = Object.keys(snapshot);
    const currentKeys = Object.keys(currentRemotes);

    const added = currentKeys.filter(k => !snapshot[k]);
    const removed = snapshotKeys.filter(k => !currentRemotes[k]);
    const changed = snapshotKeys.filter(
      k => currentRemotes[k] && currentRemotes[k] !== snapshot[k],
    );

    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      const parts: string[] = [];
      if (added.length > 0) parts.push(`added: ${added.join(', ')}`);
      if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`);
      if (changed.length > 0) parts.push(`changed: ${changed.join(', ')}`);
      return `Workflow may be stale — remotes have changed since confirmation (${parts.join('; ')}). Consider re-confirming via forge_repo_workflow.`;
    }

    return null;
  }

  /**
   * @deprecated Use _detectWorkflowFull instead.
   * Kept for backward compatibility with any callers that only need the strategy string.
   */
  private async _detectWorkflowStrategy(localPath: string): Promise<WorkflowStrategy> {
    const detected = await this._detectWorkflowFull(localPath, null);
    return detected.type as WorkflowStrategy;
  }

  private async buildRegistry(): Promise<Registry> {
    let config: ForgeConfig | null = null;
    try {
      config = await this.workspaceManager.readConfig();
    } catch {
      // No workspace config — fall through to global config below
    }

    // Load global config (~/Horus/data/config/forge.yaml) for fallback registries
    const globalConfig = await loadGlobalConfig(this.globalConfigPath);

    if (!config) {
      // No workspace forge.yaml — use global config registries only
      const adapters: DataAdapter[] = [];
      for (const reg of globalConfig.registries) {
        try {
          adapters.push(this.buildAdapter(reg));
        } catch (err) {
          console.warn(`[ForgeCore] Skipping registry '${reg.name}': ${(err as Error).message}`);
        }
      }
      if (adapters.length === 0) {
        return new Registry(new FilesystemAdapter(path.join(this.workspaceRoot, 'registry')));
      }
      const adapter = adapters.length === 1 ? adapters[0] : new CompositeAdapter({ adapters });
      return new Registry(adapter);
    }

    // Workspace registries first (higher priority), then global as fallbacks.
    // Deduplicate by name — workspace overrides global.
    const workspaceNames = new Set(config.registries.map(r => r.name));
    const globalFallbacks = globalConfig.registries.filter(r => !workspaceNames.has(r.name));
    const allRegistries = [...config.registries, ...globalFallbacks];

    if (allRegistries.length === 0) {
      return new Registry(new FilesystemAdapter(path.join(this.workspaceRoot, 'registry')));
    }

    // Build an adapter for each configured registry
    const adapters: DataAdapter[] = [];
    for (const reg of allRegistries) {
      try {
        adapters.push(this.buildAdapter(reg));
      } catch (err) {
        console.warn(`[ForgeCore] Skipping registry '${reg.name}': ${(err as Error).message}`);
      }
    }

    if (adapters.length === 0) {
      // All registries failed to construct — fall back to local default
      return new Registry(new FilesystemAdapter(path.join(this.workspaceRoot, 'registry')));
    }

    // Single adapter → use directly; multiple → compose with priority ordering
    const adapter = adapters.length === 1
      ? adapters[0]
      : new CompositeAdapter({ adapters });

    return new Registry(adapter);
  }

  /**
   * Instantiate the correct DataAdapter for a registry config entry.
   */
  private buildAdapter(reg: RegistryConfig): DataAdapter {
    switch (reg.type) {
      case 'filesystem': {
        const registryPath = path.isAbsolute(reg.path)
          ? reg.path
          : path.join(this.workspaceRoot, reg.path);
        return new FilesystemAdapter(registryPath);
      }
      case 'git': {
        return new GitAdapter({
          url: reg.url,
          ref: reg.ref ?? reg.branch ?? 'main',
          registryPath: reg.path,
        });
      }
      case 'http':
        throw new ForgeError(
          'UNSUPPORTED',
          `HTTP registries are not yet implemented (registry: '${reg.name}')`,
          'Use a filesystem or git registry instead.',
        );
      default:
        throw new ForgeError(
          'INVALID_CONFIG',
          `Unknown registry type in config`,
          'Supported types: filesystem, git',
        );
    }
  }

  private parseRef(refStr: string): ArtifactRef {
    // Format: "type:id@version" or "type:id" or "id@version" or "id"
    let type: ArtifactRef['type'] = 'skill';
    let id: string;
    let version = '*';

    let remaining = refStr;

    // Extract type prefix
    if (remaining.startsWith('skill:')) { type = 'skill'; remaining = remaining.slice(6); }
    else if (remaining.startsWith('agent:')) { type = 'agent'; remaining = remaining.slice(6); }
    else if (remaining.startsWith('plugin:')) { type = 'plugin'; remaining = remaining.slice(7); }
    else if (remaining.startsWith('persona:')) { type = 'persona'; remaining = remaining.slice(8); }
    else if (remaining.startsWith('workspace-config:')) { type = 'workspace-config'; remaining = remaining.slice(17); }

    // Extract version suffix
    const atIdx = remaining.indexOf('@');
    if (atIdx !== -1) {
      id = remaining.slice(0, atIdx);
      version = remaining.slice(atIdx + 1);
    } else {
      id = remaining;
    }

    if (!id) {
      throw new ForgeError('INVALID_REF', `Invalid artifact ref: '${refStr}'`, `Use format: skill:my-skill@1.0.0`);
    }

    return { type, id, version };
  }
}

// Re-export Registry for convenience
export { Registry } from './registry/registry.js';
