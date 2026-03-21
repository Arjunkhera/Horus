// Core
export { ForgeCore, type InstallOptions, type GlobalInstallReport, type GlobalPluginInfo } from './core.js';
export { Registry } from './registry/registry.js';

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
export { normalizeGitUrl } from './repo/url-utils.js';
export { createReferenceClone, RepoCloneError, type RepoCloneOptions, type RepoCloneResult } from './repo/repo-clone.js';
