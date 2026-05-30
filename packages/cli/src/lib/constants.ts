import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── CLI version (from package.json) ─────────────────────────────────────────
function findPackageJson(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
      if (pkg.name === '@arkhera30/cli') return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error('Could not find @arkhera30/cli package.json');
}
const pkg = JSON.parse(readFileSync(findPackageJson(), 'utf-8'));
export const CLI_VERSION: string = pkg.version;

// ── Horus directory paths ───────────────────────────────────────────────────
export const HORUS_DIR = join(homedir(), 'Horus');
export const LEGACY_HORUS_DIR = join(homedir(), '.horus');
export const CONFIG_PATH = join(HORUS_DIR, 'config.yaml');
export const ENV_PATH = join(HORUS_DIR, '.env');
export const COMPOSE_PATH = join(HORUS_DIR, 'docker-compose.yml');
export const COMPOSE_TEST_PATH = join(HORUS_DIR, 'docker-compose.test.yml');

// ── Default port assignments ────────────────────────────────────────────────
export const DEFAULT_PORTS = {
  anvil: 8100,
  vault_rest: 8000,   // keep for individual vault instances
  vault_mcp: 8300,
  vault_router: 8050, // internal routing layer
  ui: 8400,          // horus-ui — Horus unified UI
  forge: 8200,
  typesense: 8108,   // Typesense search engine
  neo4j_http: 7474,  // Neo4j Browser / HTTP API
  neo4j_bolt: 7687,  // Neo4j Bolt protocol
} as const;

// ── Default repository URLs ─────────────────────────────────────────────────
// All repo URLs default to empty — setup prompts the user for their own repos.
export const DEFAULT_REPOS = {
  anvil_notes: '',
  forge_registry: '',
} as const;

// ── Default data directory ──────────────────────────────────────────────────
export const DEFAULT_DATA_DIR = join(homedir(), 'Horus', 'data');

// ── Service names (as they appear in docker-compose.yml) ────────────────────
// Alpha client topology (§C): four local containers. Vault and Forge are
// remote behind the control plane and are not part of the local service set.
export const SERVICES = [
  'anvil',
  'horus-ui',
  'typesense',
  'neo4j',
] as const;

export type ServiceName = (typeof SERVICES)[number];

// ── Health check endpoints ──────────────────────────────────────────────────
export const HEALTH_ENDPOINTS: Record<ServiceName, { port: number; path: string }> = {
  'anvil': { port: 8100, path: '/health' },
  'horus-ui': { port: 8400, path: '/health' },
  'typesense': { port: 8108, path: '/health' },
  'neo4j': { port: 7474, path: '/' },
};

// ── Config version ──────────────────────────────────────────────────────────
export const CONFIG_VERSION = '1.0';
