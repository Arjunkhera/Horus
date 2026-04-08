import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { GlobalConfigSchema, type GlobalConfig } from '../models/global-config.js';
import type { RegistryConfig } from '../models/forge-config.js';
import { normalizeRegistryConfig } from '../models/forge-config.js';
import { expandPath } from './path-utils.js';

/**
 * Default location for the global Forge configuration.
 * Config lives under ~/Horus/data/config/ alongside other Horus data.
 * Legacy path (~/.forge/config.yaml) is auto-migrated by the entrypoint on first run.
 *
 * In Docker, FORGE_CONFIG_PATH is exported by the entrypoint so the container path
 * (/data/config) takes precedence over the host-style os.homedir() path.
 */
export const GLOBAL_CONFIG_DIR = process.env.FORGE_CONFIG_PATH
  ?? path.join(os.homedir(), 'Horus', 'data', 'config');
export const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'forge.yaml');

/**
 * The default local filesystem registry. Always present at the front of
 * the registry list so local artifacts take priority (local-first resolution).
 */
export const DEFAULT_LOCAL_REGISTRY: RegistryConfig = {
  type: 'filesystem' as const,
  name: 'local',
  path: '~/.Horus/data/registry',
  writable: true,
};

/**
 * The default global Git registry. Always present at the end of the
 * registry list as the last-resort read-only source for community artifacts.
 */
export const DEFAULT_GLOBAL_REGISTRY: RegistryConfig = {
  type: 'git' as const,
  name: 'global',
  url: 'https://github.com/Arjunkhera/Forge-Registry.git',
  ref: 'master',
  path: 'registry',
  writable: false,
};

/**
 * Ensure the registry list includes the required local (first) and global
 * (last) registries. User-defined registries are sandwiched between them.
 *
 * Rules:
 * - If no registry named 'local' exists, prepend the default local registry.
 * - If no registry named 'global' exists, append the default global registry.
 * - Ordering: local always first, global always last, user registries in the middle.
 */
export function ensureDefaultRegistries(registries: RegistryConfig[]): RegistryConfig[] {
  const hasLocal = registries.some(r => r.name === 'local');
  const hasGlobal = registries.some(r => r.name === 'global');

  // Separate out local and global from user registries to enforce ordering
  const localReg = hasLocal
    ? registries.find(r => r.name === 'local')!
    : DEFAULT_LOCAL_REGISTRY;
  const globalReg = hasGlobal
    ? registries.find(r => r.name === 'global')!
    : DEFAULT_GLOBAL_REGISTRY;
  const userRegistries = registries.filter(r => r.name !== 'local' && r.name !== 'global');

  return [localReg, ...userRegistries, globalReg];
}

/**
 * Load the global Forge configuration from ~/Horus/data/config/forge.yaml.
 * Returns an empty config (no registries) if the file doesn't exist.
 * Expands all tilde paths to absolute paths.
 * Ensures default local and global registries are always present.
 *
 * @param configPath - Override the default path (useful for testing).
 */
export async function loadGlobalConfig(
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<GlobalConfig> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = parseYaml(raw);
    const config = GlobalConfigSchema.parse(parsed);

    // Normalize git registries (resolve legacy 'branch' -> 'ref')
    config.registries = config.registries.map(normalizeRegistryConfig);

    // Ensure default registries are present
    config.registries = ensureDefaultRegistries(config.registries);

    // Expand all tilde paths to absolute paths
    if (config.workspace.mount_path) {
      config.workspace.mount_path = expandPath(config.workspace.mount_path);
    }
    if (config.workspace.store_path) {
      config.workspace.store_path = expandPath(config.workspace.store_path);
    }
    if (config.workspace.sessions_path) {
      config.workspace.sessions_path = expandPath(config.workspace.sessions_path);
    }
    if (config.workspace.managed_repos_path) {
      config.workspace.managed_repos_path = expandPath(config.workspace.managed_repos_path);
    }
    if (config.workspace.sessions_root) {
      config.workspace.sessions_root = expandPath(config.workspace.sessions_root);
    }
    if (config.repos.index_path) {
      config.repos.index_path = expandPath(config.repos.index_path);
    }
    config.repos.scan_paths = config.repos.scan_paths.map(expandPath);

    // Expand registry paths for filesystem registries
    for (const registry of config.registries) {
      if (registry.type === 'filesystem') {
        (registry as any).path = expandPath((registry as any).path);
      }
    }

    return config;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      // No global config — return defaults with default registries
      const config = GlobalConfigSchema.parse({});
      config.registries = ensureDefaultRegistries(config.registries);
      // Expand local registry path
      for (const registry of config.registries) {
        if (registry.type === 'filesystem') {
          (registry as any).path = expandPath((registry as any).path);
        }
      }
      return config;
    }
    // File exists but is malformed — warn and return defaults
    console.warn(
      `[Forge] Warning: Could not parse global config at ${configPath}: ${err.message}. Using defaults.`,
    );
    const config = GlobalConfigSchema.parse({});
    config.registries = ensureDefaultRegistries(config.registries);
    for (const registry of config.registries) {
      if (registry.type === 'filesystem') {
        (registry as any).path = expandPath((registry as any).path);
      }
    }
    return config;
  }
}

/**
 * Save a global config to ~/Horus/data/config/forge.yaml.
 * Creates the config directory if it doesn't exist.
 * Does NOT expand paths — stores them as-is (tilde format is fine).
 *
 * @param config - The global config to write (can be partial, will be validated).
 * @param configPath - Override the default path (useful for testing).
 */
export async function saveGlobalConfig(
  config: Partial<GlobalConfig>,
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<void> {
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  // Parse to ensure it's valid and fill in defaults
  const validated = GlobalConfigSchema.parse(config);
  const yaml = stringifyYaml(validated);
  await fs.writeFile(configPath, yaml, 'utf-8');
}

/**
 * Add a registry to the global config. Deduplicates by name.
 *
 * @param registry - The registry config to add.
 * @param configPath - Override the default path (useful for testing).
 */
export async function addGlobalRegistry(
  registry: RegistryConfig,
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<GlobalConfig> {
  const config = await loadGlobalConfig(configPath);
  // Remove any existing registry with the same name
  config.registries = config.registries.filter(r => r.name !== registry.name);
  config.registries.push(registry);
  await saveGlobalConfig(config, configPath);
  return config;
}

/**
 * Remove a registry from the global config by name.
 *
 * @param registryName - The name of the registry to remove.
 * @param configPath - Override the default path (useful for testing).
 */
export async function removeGlobalRegistry(
  registryName: string,
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<GlobalConfig> {
  const config = await loadGlobalConfig(configPath);
  config.registries = config.registries.filter(r => r.name !== registryName);
  await saveGlobalConfig(config, configPath);
  return config;
}
