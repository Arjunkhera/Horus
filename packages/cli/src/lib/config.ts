import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join as pathJoin, relative } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  HORUS_DIR,
  LEGACY_HORUS_DIR,
  CONFIG_PATH,
  ENV_PATH,
  DEFAULT_PORTS,
  DEFAULT_DATA_DIR,
  CONFIG_VERSION,
} from './constants.js';

// ── Config types ─────────────────────────────────────────────────────────────

export interface VaultConfig {
  repo: string;
  default?: boolean;
}

export interface GitHubHost {
  host: string;
  token: string;
}

export interface Config {
  version: string;
  data_dir: string;
  runtime: 'docker' | 'podman';
  ports: {
    anvil: number;
    vault_rest: number;
    vault_mcp: number;
    vault_router: number;
    ui: number;
    forge: number;
    typesense: number;
    neo4j_http: number;
    neo4j_bolt: number;
  };
  repos: {
    anvil_notes: string;
    forge_registry: string;
  };
  search: {
    api_key: string;
  };
  vaults: Record<string, VaultConfig>;
  github_hosts: Record<string, GitHubHost>;
  host_repos_path: string;
  host_repos_extra_scan_dirs: string[];
  enable_ui: boolean;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    data_dir: DEFAULT_DATA_DIR,
    runtime: 'docker',
    ports: { ...DEFAULT_PORTS },
    repos: {
      anvil_notes: '',
      forge_registry: '',
    },
    search: {
      api_key: 'horus-local-key',
    },
    vaults: {},
    github_hosts: {},
    host_repos_path: '',
    host_repos_extra_scan_dirs: [],
    enable_ui: true,
  };
}

// ── Horus directory management ──────────────────────────────────────────────

export function getHorusDir(): string {
  return HORUS_DIR;
}

export function ensureHorusDir(): void {
  mkdirSync(HORUS_DIR, { recursive: true });
}

// ── Config I/O ──────────────────────────────────────────────────────────────

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    const legacyConfigPath = pathJoin(LEGACY_HORUS_DIR, 'config.yaml');
    if (existsSync(legacyConfigPath)) {
      console.warn(
        `\nWarning: Horus config found at ~/.horus/config.yaml (legacy location).\n` +
        `The new default is ~/Horus. Run \`horus setup\` to migrate.\n`
      );
      const raw = readFileSync(legacyConfigPath, 'utf-8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      return buildConfigFromParsed(parsed);
    }
    return defaultConfig();
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;
  return buildConfigFromParsed(parsed);
}

function buildConfigFromParsed(parsed: Record<string, unknown>): Config {
  // Guard against old single-vault format
  const repos = parsed.repos as Record<string, unknown> | undefined;
  if (repos && 'vault_knowledge' in repos) {
    throw new Error(
      'config.yaml uses the old single-vault format (repos.vault_knowledge). ' +
      'This version requires the new multi-vault format. ' +
      'Please delete ~/Horus/config.yaml and run `horus setup` to reconfigure.'
    );
  }

  const defaults = defaultConfig();

  const parsedPorts = parsed.ports as Record<string, number> | undefined;

  return {
    version: (parsed.version as string | undefined) ?? defaults.version,
    data_dir: (parsed.data_dir as string | undefined) ?? defaults.data_dir,
    runtime: (parsed.runtime as 'docker' | 'podman' | undefined) ?? defaults.runtime,
    ports: {
      anvil: parsedPorts?.anvil ?? defaults.ports.anvil,
      vault_rest: parsedPorts?.vault_rest ?? defaults.ports.vault_rest,
      vault_mcp: parsedPorts?.vault_mcp ?? defaults.ports.vault_mcp,
      vault_router: parsedPorts?.vault_router ?? defaults.ports.vault_router,
      ui: parsedPorts?.ui ?? defaults.ports.ui,
      forge: parsedPorts?.forge ?? defaults.ports.forge,
      typesense: parsedPorts?.typesense ?? defaults.ports.typesense,
      neo4j_http: parsedPorts?.neo4j_http ?? defaults.ports.neo4j_http,
      neo4j_bolt: parsedPorts?.neo4j_bolt ?? defaults.ports.neo4j_bolt,
    },
    repos: {
      anvil_notes: (repos?.anvil_notes as string | undefined) ?? defaults.repos.anvil_notes,
      forge_registry: (repos?.forge_registry as string | undefined) ?? defaults.repos.forge_registry,
    },
    search: {
      api_key: ((parsed.search as Record<string, unknown> | undefined)?.api_key as string | undefined) ?? defaults.search.api_key,
    },
    vaults: (parsed.vaults as Record<string, VaultConfig> | undefined) ?? defaults.vaults,
    github_hosts: (parsed.github_hosts as Record<string, GitHubHost> | undefined) ?? defaults.github_hosts,
    host_repos_path: (parsed.host_repos_path as string | undefined) ?? defaults.host_repos_path,
    host_repos_extra_scan_dirs: (parsed.host_repos_extra_scan_dirs as string[] | undefined) ?? defaults.host_repos_extra_scan_dirs,
    enable_ui: (parsed.enable_ui as boolean | undefined) ?? defaults.enable_ui,
  };
}

export function saveConfig(config: Config): void {
  ensureHorusDir();
  const yaml = stringifyYaml(config, { lineWidth: 0 });
  writeFileSync(CONFIG_PATH, yaml, 'utf-8');
}

// ── Config validation ────────────────────────────────────────────────────────

export function validateConfig(config: Config): void {
  if (!config.vaults || Object.keys(config.vaults).length === 0) {
    throw new Error('config.yaml must have at least one vault in the vaults: section.');
  }
  const defaults = Object.entries(config.vaults).filter(([, v]) => v.default);
  if (defaults.length !== 1) {
    throw new Error(`Exactly one vault must have default: true. Found ${defaults.length}.`);
  }
  if (!config.github_hosts || Object.keys(config.github_hosts).length === 0) {
    throw new Error('config.yaml must have at least one entry in github_hosts:.');
  }
}

// ── GitHub host resolution ───────────────────────────────────────────────────

export function resolveGitHubHost(repoUrl: string, github_hosts: Record<string, GitHubHost>): GitHubHost | undefined {
  try {
    const hostname = new URL(repoUrl).hostname;
    return Object.values(github_hosts).find(h => h.host === hostname);
  } catch {
    return undefined;
  }
}

// ── .env generation ─────────────────────────────────────────────────────────

/**
 * Resolve a path that may contain ~ to an absolute path.
 */
export { resolvePath as resolveConfigPath };
function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

/**
 * Recursively discover directories containing a .git folder under `rootDir`.
 * Returns the set of unique *parent* directories that contain repos — these
 * are the directories Forge should scan.
 *
 * Limits recursion depth to avoid traversing enormous trees.
 */
export function discoverRepoDirs(rootDir: string, maxDepth = 4): string[] {
  const repoDirs = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // Permission denied or not a directory
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const full = pathJoin(dir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      // If this directory contains a .git, record its parent as a scan dir
      if (existsSync(pathJoin(full, '.git'))) {
        repoDirs.add(dir);
      }
      walk(full, depth + 1);
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir, 0);
  }
  return [...repoDirs];
}

/**
 * Generate the .env file content from the config object.
 * Maps config fields to the environment variables expected by docker-compose.yml.
 */
export function generateEnv(config: Config): string {
  const dataDir = resolvePath(config.data_dir);
  const hostReposPath = config.host_repos_path
    ? resolvePath(config.host_repos_path)
    : '';

  // Build FORGE_SCAN_PATHS by auto-discovering repos under host_repos_path,
  // with manual overrides from host_repos_extra_scan_dirs as a fallback.
  const baseScanPath = '/data/repos';

  let forgeScanPaths: string;
  if (hostReposPath) {
    // Auto-discover directories containing git repos
    const discoveredDirs = discoverRepoDirs(hostReposPath);
    const containerPaths = discoveredDirs.map((dir) => {
      const rel = relative(hostReposPath, dir);
      return rel ? `${baseScanPath}/${rel}` : baseScanPath;
    });
    // Always include the base path; dedupe
    const allPaths = [baseScanPath, ...containerPaths];
    // Also include manually configured extra dirs (backward compat)
    const extraScanPaths = (config.host_repos_extra_scan_dirs ?? [])
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => `${baseScanPath}/${d}`);
    const uniquePaths = [...new Set([...allPaths, ...extraScanPaths])];
    forgeScanPaths = uniquePaths.join(':');
  } else {
    // No host repos path — use manual config only
    const extraScanPaths = (config.host_repos_extra_scan_dirs ?? [])
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => `${baseScanPath}/${d}`);
    forgeScanPaths = [baseScanPath, ...extraScanPaths].join(':');
  }

  const lines: string[] = [
    '# ─────────────────────────────────────────────────────────────────────────────',
    '# Horus — Generated .env file',
    '# Do not edit manually. Use `horus config set <key> <value>` instead.',
    '# ─────────────────────────────────────────────────────────────────────────────',
    '',
    `HORUS_RUNTIME=${config.runtime}`,
    `HORUS_DATA_PATH=${dataDir}`,
    `HOST_REPOS_PATH=${hostReposPath}`,
    `FORGE_SCAN_PATHS=${forgeScanPaths}`,
    '',
    '# Ports',
    `ANVIL_PORT=${config.ports.anvil}`,
    `VAULT_PORT=${config.ports.vault_rest}`,
    `VAULT_MCP_PORT=${config.ports.vault_mcp}`,
    `VAULT_ROUTER_PORT=${config.ports.vault_router}`,
    `FORGE_PORT=${config.ports.forge}`,
    `TYPESENSE_PORT=${config.ports.typesense}`,
    `NEO4J_HTTP_PORT=${config.ports.neo4j_http}`,
    `NEO4J_BOLT_PORT=${config.ports.neo4j_bolt}`,
    '',
    '# Search',
    `TYPESENSE_API_KEY=${config.search.api_key}`,
    '',
    '# Repository URLs (must be HTTPS — container services do not have SSH keys)',
    `ANVIL_REPO_URL=${config.repos.anvil_notes}`,
    `FORGE_REGISTRY_REPO_URL=${config.repos.forge_registry}`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Write the generated .env file to ~/Horus/.env.
 */
export function writeEnvFile(config: Config): void {
  ensureHorusDir();
  const content = generateEnv(config);
  writeFileSync(ENV_PATH, content, 'utf-8');
}

// ── Config key helpers ──────────────────────────────────────────────────────

/**
 * Supported config keys for `horus config get/set`.
 */
export const CONFIG_KEYS = [
  'data-dir',
  'host-repos-path',
  'host-repos-extra-scan-dirs',
  'runtime',
  'port.anvil',
  'port.vault-rest',
  'port.vault-mcp',
  'port.vault-router',
  'port.forge',
  'port.typesense',
  'repo.anvil-notes',
  'repo.forge-registry',
  'search.api-key',
  'enable-ui',
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * Get a config value by its CLI key name.
 */
export function getConfigValue(config: Config, key: ConfigKey): string {
  switch (key) {
    case 'data-dir':
      return config.data_dir;
    case 'host-repos-path':
      return config.host_repos_path;
    case 'host-repos-extra-scan-dirs':
      return (config.host_repos_extra_scan_dirs ?? []).join(', ');
    case 'runtime':
      return config.runtime;
    case 'port.anvil':
      return String(config.ports.anvil);
    case 'port.vault-rest':
      return String(config.ports.vault_rest);
    case 'port.vault-mcp':
      return String(config.ports.vault_mcp);
    case 'port.vault-router':
      return String(config.ports.vault_router);
    case 'port.forge':
      return String(config.ports.forge);
    case 'port.typesense':
      return String(config.ports.typesense);
    case 'repo.anvil-notes':
      return config.repos.anvil_notes;
    case 'repo.forge-registry':
      return config.repos.forge_registry;
    case 'search.api-key':
      return config.search.api_key;
    case 'enable-ui':
      return String(config.enable_ui);
  }
}

/**
 * Set a config value by its CLI key name.
 */
export function setConfigValue(config: Config, key: ConfigKey, value: string): Config {
  const updated = { ...config };

  switch (key) {
    case 'data-dir':
      updated.data_dir = value;
      break;
    case 'host-repos-path':
      updated.host_repos_path = value;
      break;
    case 'host-repos-extra-scan-dirs':
      updated.host_repos_extra_scan_dirs = value
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      break;
    case 'runtime':
      if (value !== 'docker' && value !== 'podman') {
        throw new Error(`Invalid runtime: ${value}. Must be "docker" or "podman".`);
      }
      updated.runtime = value;
      break;
    case 'port.anvil':
      updated.ports = { ...updated.ports, anvil: parseInt(value, 10) };
      break;
    case 'port.vault-rest':
      updated.ports = { ...updated.ports, vault_rest: parseInt(value, 10) };
      break;
    case 'port.vault-mcp':
      updated.ports = { ...updated.ports, vault_mcp: parseInt(value, 10) };
      break;
    case 'port.vault-router':
      updated.ports = { ...updated.ports, vault_router: parseInt(value, 10) };
      break;
    case 'port.forge':
      updated.ports = { ...updated.ports, forge: parseInt(value, 10) };
      break;
    case 'port.typesense':
      updated.ports = { ...updated.ports, typesense: parseInt(value, 10) };
      break;
    case 'repo.anvil-notes':
      updated.repos = { ...updated.repos, anvil_notes: value };
      break;
    case 'repo.forge-registry':
      updated.repos = { ...updated.repos, forge_registry: value };
      break;
    case 'search.api-key':
      updated.search = { ...updated.search, api_key: value };
      break;
    case 'enable-ui':
      if (value !== 'true' && value !== 'false') {
        throw new Error(`Invalid value for enable-ui: ${value}. Must be "true" or "false".`);
      }
      updated.enable_ui = value === 'true';
      break;
  }

  return updated;
}

/**
 * Mask an API key for display: show first 7 chars + last 4, mask the rest.
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? '****' : '(not set)';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}
