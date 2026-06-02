import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { GlobalConfigSchema, type GlobalConfig, type GlobalConfigInput } from '../models/global-config.js';
import type { RegistryConfig, RegistryConfigInput } from '../models/forge-config.js';
import { RegistryConfigSchema } from '../models/forge-config.js';
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
 * Resolve the default Forge registry URL — the in-cluster forge-registry behind
 * the Horus control-plane gateway. Both the injected `local` and `global`
 * defaults resolve to this same gateway; there is no standalone localhost
 * registry-service in the current architecture.
 *
 * Resolution order:
 *   FORGE_REGISTRY_GATEWAY_URL — if set, used directly.
 *   HORUS_CONTROL_PLANE_URL    — otherwise derived as ${HORUS_CONTROL_PLANE_URL}/api/v1/forge.
 *   (fallback)                 — the public Horus control plane.
 *
 * Never returns a dead host (the retired localhost:8744 registry-service or the
 * decommissioned CloudFront distribution).
 */
export function resolveDefaultRegistryUrl(): string {
  const explicit = process.env.FORGE_REGISTRY_GATEWAY_URL;
  if (explicit) return explicit;
  const cpUrl = process.env.HORUS_CONTROL_PLANE_URL;
  if (cpUrl) return `${cpUrl.replace(/\/$/, '')}/api/v1/forge`;
  return 'https://horus.arjunkhera.io/api/v1/forge';
}

/**
 * The default writable registry. Always present at the front of the registry
 * list so it wins under local-first artifact resolution.
 *
 * In the current architecture there is no standalone localhost registry-service;
 * the writable registry is the control-plane Forge gateway, so this default
 * resolves to the same URL as DEFAULT_GLOBAL_REGISTRY. It is only the fallback
 * used when forge.yaml is absent — the normal path is the CLI-written forge.yaml,
 * whose `local` entry carries the publisher token (tokenEnv) for authenticated
 * publishes (a tokenless entry can read but not write).
 */
export const DEFAULT_LOCAL_REGISTRY: RegistryConfig = {
  type: 'http',
  name: 'local',
  url: resolveDefaultRegistryUrl(),
  writable: true,
};

/**
 * The default public Forge registry. Always present at the end of the
 * registry list as the last-resort read-only source for community artifacts.
 *
 * Served by the in-cluster forge-registry behind the Horus control-plane
 * gateway (horus-service). Anonymous GET/HEAD reads are public (community-read
 * model); no token is required, so this entry stays read-only.
 * Writes (publish) require an authenticated, writable registry entry pointing
 * at the same gateway with a publisher token — the gateway gates non-read
 * methods, so a tokenless 'global' entry cannot publish.
 */
export const DEFAULT_GLOBAL_REGISTRY: RegistryConfig = {
  type: 'http',
  name: 'global',
  url: resolveDefaultRegistryUrl(),
  writable: false,
};

/**
 * Ensure the registry list includes the required local (first) and global
 * (last) registries. User-defined registries are sandwiched between them.
 *
 * Rules (solo-dev mode — no enterpriseRegistryUrl):
 * - If no registry named 'local' exists, prepend the default local registry.
 * - If no registry named 'global' exists, append the default global registry.
 * - Ordering: local always first, global always last, user registries in the middle.
 *
 * Enterprise / air-gapped mode (enterpriseRegistryUrl provided):
 * - Skips DEFAULT_LOCAL_REGISTRY and DEFAULT_GLOBAL_REGISTRY entirely.
 * - Adds a single writable registry entry for the company URL (name: 'enterprise').
 * - Any explicitly user-configured 'local' or 'global' entries are preserved if
 *   they already exist in the list, but defaults are not injected.
 */
export function ensureDefaultRegistries(
  registries: RegistryConfig[],
  enterpriseRegistryUrl?: string,
): RegistryConfig[] {
  if (enterpriseRegistryUrl) {
    // Enterprise / air-gapped path: use only the company registry.
    const hasEnterprise = registries.some(r => r.name === 'enterprise');
    if (hasEnterprise) {
      // Already configured — return as-is (user may have customised it)
      return registries;
    }
    const enterpriseReg: RegistryConfig = {
      type: 'http',
      name: 'enterprise',
      url: enterpriseRegistryUrl,
      writable: true,
    };
    // Prepend enterprise registry; keep any other user-defined entries after it
    const others = registries.filter(r => r.name !== 'enterprise');
    return [enterpriseReg, ...others];
  }

  // Solo-dev path: inject default local + global registries if absent
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
 * Select the registry that backs the SHARED repo registry.
 *
 * Unlike artifacts (local-first resolution), repo metadata is shared and lives
 * in the deployed Forge registry, so repo operations must target the shared
 * endpoint — never the writable `local` entry. The same client
 * serves reads AND writes, so a WRITABLE shared registry must win over the
 * read-only public `global` CDN (which blocks POST/PATCH/DELETE). Preference:
 *   1. `enterprise` — the deployed registry in enterprise/air-gapped mode (writable).
 *   2. any writable non-`local` http registry — a user-configured shared registry.
 *   3. `global`     — the default public/shared CDN (DEFAULT_GLOBAL_REGISTRY, read-only).
 *   4. any non-`local` http registry.
 *   5. `local`      — last-resort fallback (solo-dev with no shared registry).
 *
 * Returns undefined when no http registry is configured at all.
 */
export function selectSharedRepoRegistry(
  registries: RegistryConfig[],
): RegistryConfig | undefined {
  const http = registries.filter(r => r.type === 'http');
  if (http.length === 0) return undefined;
  return (
    http.find(r => r.name === 'enterprise') ??
    http.find(r => r.name !== 'local' && r.name !== 'global' && r.writable) ??
    http.find(r => r.name === 'global') ??
    http.find(r => r.name !== 'local') ??
    http[0]
  );
}

/**
 * Load the global Forge configuration from ~/Horus/data/config/forge.yaml.
 * Returns an empty config (no registries) if the file doesn't exist.
 * Expands all tilde paths to absolute paths.
 * Ensures default local and global registries are always present, unless
 * ENTERPRISE_REGISTRY_URL is set in the environment (air-gapped mode).
 *
 * @param configPath - Override the default path (useful for testing).
 */
export async function loadGlobalConfig(
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<GlobalConfig> {
  // In enterprise / air-gapped mode, Forge is told about the company registry
  // via the ENTERPRISE_REGISTRY_URL environment variable (written to .env by
  // `horus setup --registry <url>`). When set, the default local and global
  // registries are not injected.
  const enterpriseRegistryUrl = process.env.ENTERPRISE_REGISTRY_URL || undefined;

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = parseYaml(raw);
    const config = GlobalConfigSchema.parse(parsed);

    // Normalize registry configs
    config.registries = config.registries.map(normalizeRegistryConfig);

    // Ensure default registries are present (enterprise-aware)
    config.registries = ensureDefaultRegistries(config.registries, enterpriseRegistryUrl);

    // Re-resolve the 'global' registry URL in case FORGE_REGISTRY_GATEWAY_URL or
    // HORUS_CONTROL_PLANE_URL is set at runtime (horus-ui in-process mode).
    const globalRegistryUrl = resolveDefaultRegistryUrl();
    if (globalRegistryUrl !== 'https://horus.arjunkhera.io/api/v1/forge') {
      const globalEntry = config.registries.find(r => r.name === 'global');
      if (globalEntry) {
        globalEntry.url = globalRegistryUrl;
      }
    }

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

    // Apply runtime env overrides for in-process (horus-ui) use.
    // These allow the host to wire container-volume paths without modifying forge.yaml.
    if (process.env.FORGE_SESSIONS_ROOT) {
      config.workspace.sessions_root = process.env.FORGE_SESSIONS_ROOT;
    }
    if (process.env.FORGE_MANAGED_REPOS_PATH) {
      config.workspace.managed_repos_path = process.env.FORGE_MANAGED_REPOS_PATH;
    }

    return config;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      // No global config — return defaults with default registries
      const config = GlobalConfigSchema.parse({});
      config.registries = ensureDefaultRegistries(config.registries, enterpriseRegistryUrl);
      if (process.env.FORGE_SESSIONS_ROOT) config.workspace.sessions_root = process.env.FORGE_SESSIONS_ROOT;
      if (process.env.FORGE_MANAGED_REPOS_PATH) config.workspace.managed_repos_path = process.env.FORGE_MANAGED_REPOS_PATH;
      return config;
    }
    // File exists but is malformed — warn and return defaults
    console.warn(
      `[Forge] Warning: Could not parse global config at ${configPath}: ${err.message}. Using defaults.`,
    );
    const config = GlobalConfigSchema.parse({});
    config.registries = ensureDefaultRegistries(config.registries, enterpriseRegistryUrl);
    if (process.env.FORGE_SESSIONS_ROOT) config.workspace.sessions_root = process.env.FORGE_SESSIONS_ROOT;
    if (process.env.FORGE_MANAGED_REPOS_PATH) config.workspace.managed_repos_path = process.env.FORGE_MANAGED_REPOS_PATH;
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
  config: Partial<GlobalConfig> | Partial<GlobalConfigInput>,
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
  registry: RegistryConfigInput,
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<GlobalConfig> {
  const config = await loadGlobalConfig(configPath);
  // Parse to fill in defaults (e.g. writable, ref)
  const parsed = RegistryConfigSchema.parse(registry);
  // Remove any existing registry with the same name
  config.registries = config.registries.filter(r => r.name !== parsed.name);
  config.registries.push(parsed);
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
