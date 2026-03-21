// Types
export type { DataAdapter } from './types.js';

// Errors
export {
  ForgeError,
  ArtifactNotFoundError,
  InvalidMetadataError,
  CircularDependencyError,
  VersionMismatchError,
  UnsupportedTargetError,
  AdapterError,
  AllAdaptersFailedError,
} from './errors.js';

// Implementations
export { FilesystemAdapter } from './filesystem-adapter.js';
export { CompositeAdapter } from './composite-adapter.js';
export { GitAdapter, type GitAdapterConfig } from './git-adapter.js';
