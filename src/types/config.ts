// Configuration types for vault and server settings

/** Vault-specific settings stored in .anvil/config.yaml */
export type VaultConfig = {
  /** Git remote name for sync (default: "origin") */
  git_remote?: string;
  /** Sync interval in seconds (Phase 3, deferred) */
  sync_interval?: number;
  /** Additional ignore patterns beyond defaults */
  ignore_patterns?: string[];
};

/**
 * Server configuration — from ~/.anvil/server.yaml or CLI args.
 * Tells the server where the vault lives and how to communicate.
 */
export type ServerConfig = {
  vault_path: string;
  transport: 'stdio' | 'http';
  port?: number;
  host?: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  additional_type_dirs?: string[];
};

/** Default ignore patterns for the file watcher and vault scanner */
export const DEFAULT_IGNORE_PATTERNS = [
  '.anvil/.local',
  '.git',
  'node_modules',
  '**/*~',
  '**/.#*',
  '**/*.tmp',
  '**/*.swp',
];
