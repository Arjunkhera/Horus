import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join as pathJoin, relative } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  HORUS_DIR,
  CONFIG_PATH,
  ENV_PATH,
  DEFAULT_PORTS,
  DEFAULT_REPOS,
  DEFAULT_DATA_DIR,
  CONFIG_VERSION,
} from './constants.js';

// ── Config type ─────────────────────────────────────────────────────────────

export interface Config {
  version: string;
  data_dir: string;
  runtime: 'docker' | 'podman';
  ports: {
    anvil: number;
    vault_rest: number;
    vault_mcp: number;
    forge: number;
  };
  git_host: string;
  repos: {
    anvil_notes: string;
    vault_knowledge: string;
    forge_registry: string;
  };
  host_repos_path: string;
  host_repos_extra_scan_dirs: string[];
  github_token: string;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    data_dir: DEFAULT_DATA_DIR,
    runtime: 'docker',
    ports: { ...DEFAULT_PORTS },
    git_host: 'github.com',
    repos: { ...DEFAULT_REPOS },
    host_repos_path: '',
    host_repos_extra_scan_dirs: [],
    github_token: '',
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
    return defaultConfig();
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = parseYaml(raw) as Partial<Config>;
  const defaults = defaultConfig();

  return {
    version: parsed.version ?? defaults.version,
    data_dir: parsed.data_dir ?? defaults.data_dir,
    runtime: parsed.runtime ?? defaults.runtime,
    ports: {
      anvil: parsed.ports?.anvil ?? defaults.ports.anvil,
      vault_rest: parsed.ports?.vault_rest ?? defaults.ports.vault_rest,
      vault_mcp: parsed.ports?.vault_mcp ?? defaults.ports.vault_mcp,
      forge: parsed.ports?.forge ?? defaults.ports.forge,
    },
    git_host: parsed.git_host ?? defaults.git_host,
    repos: {
      anvil_notes: parsed.repos?.anvil_notes ?? defaults.repos.anvil_notes,
      vault_knowledge: parsed.repos?.vault_knowledge ?? defaults.repos.vault_knowledge,
      forge_registry: parsed.repos?.forge_registry ?? defaults.repos.forge_registry,
    },
    host_repos_path: parsed.host_repos_path ?? defaults.host_repos_path,
    host_repos_extra_scan_dirs: parsed.host_repos_extra_scan_dirs ?? defaults.host_repos_extra_scan_dirs,
    github_token: parsed.github_token ?? defaults.github_token,
  };
}

export function saveConfig(config: Config): void {
  ensureHorusDir();
  const yaml = stringifyYaml(config, { lineWidth: 0 });
  writeFileSync(CONFIG_PATH, yaml, 'utf-8');
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
    `FORGE_PORT=${config.ports.forge}`,
    '',
    '# Repository URLs (must be HTTPS — container services do not have SSH keys)',
    `ANVIL_REPO_URL=${config.repos.anvil_notes}`,
    `VAULT_KNOWLEDGE_REPO_URL=${config.repos.vault_knowledge}`,
    `FORGE_REGISTRY_REPO_URL=${config.repos.forge_registry}`,
    '',
    '# Authentication',
    `GITHUB_TOKEN=${config.github_token}`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Write the generated .env file to ~/.horus/.env.
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
  'port.forge',
  'github-token',
  'git-host',
  'repo.anvil-notes',
  'repo.vault-knowledge',
  'repo.forge-registry',
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
    case 'port.forge':
      return String(config.ports.forge);
    case 'github-token':
      return config.github_token;
    case 'git-host':
      return config.git_host;
    case 'repo.anvil-notes':
      return config.repos.anvil_notes;
    case 'repo.vault-knowledge':
      return config.repos.vault_knowledge;
    case 'repo.forge-registry':
      return config.repos.forge_registry;
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
    case 'port.forge':
      updated.ports = { ...updated.ports, forge: parseInt(value, 10) };
      break;
    case 'github-token':
      updated.github_token = value;
      break;
    case 'git-host':
      updated.git_host = value;
      break;
    case 'repo.anvil-notes':
      updated.repos = { ...updated.repos, anvil_notes: value };
      break;
    case 'repo.vault-knowledge':
      updated.repos = { ...updated.repos, vault_knowledge: value };
      break;
    case 'repo.forge-registry':
      updated.repos = { ...updated.repos, forge_registry: value };
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
