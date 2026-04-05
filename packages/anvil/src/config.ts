// Configuration loader for Anvil server
// Loads from CLI args, environment variables, or config files

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ServerConfig, VaultConfig } from './types/index.js';

const DEFAULT_CONFIG: ServerConfig = {
  vault_path: '',
  transport: 'stdio',
  log_level: 'info',
};

/**
 * Load server config from CLI args, env var, or ~/.anvil/server.yaml.
 * Priority: CLI args > env vars > config file > defaults
 */
export function loadServerConfig(cliArgs?: string[]): ServerConfig {
  let config: ServerConfig = { ...DEFAULT_CONFIG };

  // Try to load from config file first
  const configHome = path.join(os.homedir(), '.anvil', 'server.yaml');
  if (fs.existsSync(configHome)) {
    try {
      // Dynamically import js-yaml (optional, for file-based config)
      const yaml = require('js-yaml');
      const content = fs.readFileSync(configHome, 'utf-8');
      const fileConfig = yaml.load(content) as Partial<ServerConfig>;
      config = { ...config, ...fileConfig };
    } catch {
      // Silently ignore config file errors
    }
  }

  // Check environment variable for vault path
  const envVaultPath = process.env.ANVIL_VAULT_PATH;
  if (envVaultPath) {
    config.vault_path = envVaultPath;
  }

  // Check environment variables for transport and port
  const envTransport = process.env.ANVIL_TRANSPORT;
  if (envTransport === 'http' || envTransport === 'stdio') {
    config.transport = envTransport;
  }

  const envPort = parseInt(process.env.ANVIL_PORT || '', 10);
  if (!isNaN(envPort)) {
    config.port = envPort;
  }

  const envHost = process.env.ANVIL_HOST;
  if (envHost) {
    config.host = envHost;
  }

  // Check environment variable for additional type dirs
  const envAdditionalTypeDirs = process.env.ANVIL_ADDITIONAL_TYPE_DIRS;
  if (envAdditionalTypeDirs) {
    config.additional_type_dirs = envAdditionalTypeDirs.split(',').map((dir) => dir.trim());
  }

  // Check CLI args
  if (cliArgs) {
    const vaultIndex = cliArgs.indexOf('--vault');
    if (vaultIndex !== -1 && vaultIndex + 1 < cliArgs.length) {
      config.vault_path = cliArgs[vaultIndex + 1];
    }

    // Check for shorthand transport flags
    if (cliArgs.includes('--http')) {
      config.transport = 'http';
    }
    if (cliArgs.includes('--stdio')) {
      config.transport = 'stdio';
    }

    // Check for --transport flag (can override shorthand)
    const transportIndex = cliArgs.indexOf('--transport');
    if (transportIndex !== -1 && transportIndex + 1 < cliArgs.length) {
      const transport = cliArgs[transportIndex + 1];
      if (transport === 'stdio' || transport === 'http') {
        config.transport = transport;
      }
    }

    const logIndex = cliArgs.indexOf('--log-level');
    if (logIndex !== -1 && logIndex + 1 < cliArgs.length) {
      const level = cliArgs[logIndex + 1];
      if (['debug', 'info', 'warn', 'error'].includes(level)) {
        config.log_level = level as 'debug' | 'info' | 'warn' | 'error';
      }
    }

    const portIndex = cliArgs.indexOf('--port');
    if (portIndex !== -1 && portIndex + 1 < cliArgs.length) {
      const port = parseInt(cliArgs[portIndex + 1], 10);
      if (!isNaN(port)) {
        config.port = port;
      }
    }

    const hostIndex = cliArgs.indexOf('--host');
    if (hostIndex !== -1 && hostIndex + 1 < cliArgs.length) {
      config.host = cliArgs[hostIndex + 1];
    }
  }

  return config;
}

/**
 * Load vault-specific config from .anvil/config.yaml
 */
export function loadVaultConfig(vaultPath: string): VaultConfig {
  const configPath = path.join(vaultPath, '.anvil', 'config.yaml');

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const yaml = require('js-yaml');
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(content) as VaultConfig;
    return config || {};
  } catch {
    // Return empty config if parsing fails
    return {};
  }
}

/**
 * Get standard paths relative to the vault
 */
export function vaultPaths(vaultPath: string) {
  return {
    typesDir: path.join(vaultPath, '.anvil', 'types'),
    pluginsDir: path.join(vaultPath, '.anvil', 'plugins'),
    localDir: path.join(vaultPath, '.anvil', '.local'),
    indexDb: path.join(vaultPath, '.anvil', '.local', 'index.db'),
    stateJson: path.join(vaultPath, '.anvil', '.local', 'state.json'),
    configYaml: path.join(vaultPath, '.anvil', 'config.yaml'),
  };
}
