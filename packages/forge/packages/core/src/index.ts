// Core
export {
  ForgeCore,
  type InstallOptions,
  type GlobalInstallReport,
  type GlobalPluginInfo,
  type AutoDetectedWorkflow,
  type RepoWorkflowResult,
  type RepoResolveResult,
} from './core.js';
export { Registry, type PublishResult } from './registry/registry.js';

// Models
export * from './models/index.js';

// Adapters
export * from './adapters/index.js';

// Resolver
export * from './resolver/index.js';

// Workspace
export * from './workspace/index.js';

// Compiler
export * from './compiler/index.js';

// Global Config
export * from './config/index.js';

// Repo Scanner & Index
export { scan } from './repo/repo-scanner.js';
export { saveRepoIndex, loadRepoIndex } from './repo/repo-index-store.js';
export { RepoIndexQuery } from './repo/repo-index-query.js';
export { normalizeGitUrl, normalizeHost, deriveRepoCoordinate, type RepoCoordinate } from './repo/url-utils.js';
export {
  horusDataPath,
  horusReposRoot,
  repoClonePath,
  repoClonePathFromCoordinate,
  repoWorktreesDir,
  worktreePath,
  ensureHorusIgnored,
} from './repo/clone-layout.js';
export {
  isCloneStale,
  cloneTtlMs,
  DEFAULT_CLONE_TTL_MS,
  ensureClone,
  refreshIfStale,
  createSessionWorktree,
  type CloneSemanticsOptions,
} from './repo/clone-semantics.js';
export {
  LocalRepoStateStoreManager,
  repoStatePath,
} from './repo/local-repo-state-store.js';
export { repoDevelop, type RepoDevelopOptions, type RepoDevelopResponse, type RepoDevelopResult, type RepoDevelopNeedsConfirmation, type RepoDevelopNeedsRepoDisambiguation, type WorkflowInput } from './repo/repo-develop.js';

// Repo Registry
export { RepoRegistryClient, type RepoRegistryClientOptions, type RepoMetadataRecord, type CreateRepoInput, type PatchRepoInput, type SearchParams, type SearchResult, type ResolveResult, type RepoHost, type RepoCredential, type RepoWorkflowMeta, type RepoVaultScope } from './repo/repo-registry-client.js';
export { RepoNotFoundError, RepoExistsError, RepoAmbiguousError } from './repo/repo-errors.js';

// Search
export { ForgeSearchClient, type ForgeSearchHit } from './search/forge-search-client.js';

// Session
export { SessionStoreManager } from './session/session-store.js';
export { sessionList, type SessionListOptions, type SessionListItem, type SessionListResult } from './session/session-list.js';
export { sessionCleanup, type SessionCleanupOptions, type SessionCleanupResult } from './session/session-cleanup.js';
