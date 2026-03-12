import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── CLI version (from package.json) ─────────────────────────────────────────
const __pkg_dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__pkg_dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
export const CLI_VERSION: string = pkg.version;

// ── Horus directory paths ───────────────────────────────────────────────────
export const HORUS_DIR = join(homedir(), '.horus');
export const CONFIG_PATH = join(HORUS_DIR, 'config.yaml');
export const ENV_PATH = join(HORUS_DIR, '.env');
export const COMPOSE_PATH = join(HORUS_DIR, 'docker-compose.yml');

// ── Default port assignments ────────────────────────────────────────────────
export const DEFAULT_PORTS = {
  anvil: 8100,
  vault_rest: 8000,
  vault_mcp: 8300,
  forge: 8200,
} as const;

// ── Default repository URLs ─────────────────────────────────────────────────
// All repo URLs default to empty — setup prompts the user for their own repos.
export const DEFAULT_REPOS = {
  anvil_notes: '',
  vault_knowledge: '',
  forge_registry: '',
} as const;

// ── Default data directory ──────────────────────────────────────────────────
export const DEFAULT_DATA_DIR = join(homedir(), '.horus', 'data');

// ── Service names (as they appear in docker-compose.yml) ────────────────────
export const SERVICES = [
  'qmd-daemon',
  'anvil',
  'vault',
  'vault-mcp',
  'forge',
] as const;

export type ServiceName = (typeof SERVICES)[number];

// ── Health check endpoints ──────────────────────────────────────────────────
export const HEALTH_ENDPOINTS: Record<ServiceName, { port: number; path: string }> = {
  'qmd-daemon': { port: 8181, path: '/health' },
  'anvil': { port: 8100, path: '/health' },
  'vault': { port: 8000, path: '/health' },
  'vault-mcp': { port: 8300, path: '/health' },
  'forge': { port: 8200, path: '/health' },
};

// ── Config version ──────────────────────────────────────────────────────────
export const CONFIG_VERSION = '1.0';
