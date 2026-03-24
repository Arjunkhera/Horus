import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  cpSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { execa } from 'execa';
import type { Runtime } from './runtime.js';
import { HORUS_DIR } from './constants.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TestEnvConfig {
  max_slots: number;
  timeout_minutes: number;
  base_port: number;
}

export interface SlotLock {
  slot: number;
  pid: number;
  acquiredAt: string; // ISO timestamp
  ports: SlotPorts;
  dataPath: string;
}

export interface SlotPorts {
  anvil: number;
  vault_svc: number;
  vault_router: number;
  vault_mcp: number;
  forge: number;
  typesense: number;
  ui: number;
}

export interface SlotStatus {
  slot: number;
  state: 'acquired' | 'free' | 'expired';
  lock?: SlotLock;
  ports?: SlotPorts;
  dataPath?: string;
  acquiredAt?: string;
  elapsedMinutes?: number;
}

// ── Paths ────────────────────────────────────────────────────────────────────

export function getTestEnvRoot(dataDir: string): string {
  return join(dataDir, 'test-env');
}

export function getLockPath(dataDir: string, slot: number): string {
  return join(getTestEnvRoot(dataDir), `slot-${slot}.lock`);
}

export function getSlotDataPath(dataDir: string, slot: number): string {
  return join(getTestEnvRoot(dataDir), `slot-${slot}`);
}

export function getTestEnvConfigPath(dataDir: string): string {
  return join(dataDir, 'config', 'test-env.yaml');
}

// ── Config loading ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TestEnvConfig = {
  max_slots: 1,
  timeout_minutes: 10,
  base_port: 9100,
};

// Port offsets within a 300-port slot range
const PORT_OFFSETS = {
  anvil: 0,
  typesense: 8,
  vault_svc: 1,
  vault_router: 50,
  vault_mcp: 100,
  forge: 150,
  ui: 160,
} as const;

export function loadTestEnvConfig(dataDir: string): TestEnvConfig {
  const configPath = getTestEnvConfigPath(dataDir);
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw) as { test_env?: Partial<TestEnvConfig> };
    const cfg = parsed?.test_env ?? {};
    return {
      max_slots: cfg.max_slots ?? DEFAULT_CONFIG.max_slots,
      timeout_minutes: cfg.timeout_minutes ?? DEFAULT_CONFIG.timeout_minutes,
      base_port: cfg.base_port ?? DEFAULT_CONFIG.base_port,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── Port calculation ─────────────────────────────────────────────────────────

export function calcPorts(slot: number, basePort: number): SlotPorts {
  const base = basePort + slot * 300;
  return {
    anvil:        base + PORT_OFFSETS.anvil,
    typesense:    base + PORT_OFFSETS.typesense,
    vault_svc:    base + PORT_OFFSETS.vault_svc,
    vault_router: base + PORT_OFFSETS.vault_router,
    vault_mcp:    base + PORT_OFFSETS.vault_mcp,
    forge:        base + PORT_OFFSETS.forge,
    ui:           base + PORT_OFFSETS.ui,
  };
}

// ── Lock file management ─────────────────────────────────────────────────────

export function readLock(dataDir: string, slot: number): SlotLock | null {
  const lockPath = getLockPath(dataDir, slot);
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8')) as SlotLock;
  } catch {
    return null;
  }
}

export function writeLock(dataDir: string, lock: SlotLock): void {
  mkdirSync(getTestEnvRoot(dataDir), { recursive: true });
  writeFileSync(getLockPath(dataDir, lock.slot), JSON.stringify(lock, null, 2), 'utf-8');
}

export function removeLock(dataDir: string, slot: number): void {
  const lockPath = getLockPath(dataDir, slot);
  if (existsSync(lockPath)) {
    rmSync(lockPath);
  }
}

export function isLockExpired(lock: SlotLock, timeoutMinutes: number): boolean {
  const acquired = new Date(lock.acquiredAt).getTime();
  return Date.now() - acquired > timeoutMinutes * 60 * 1000;
}

// ── Slot discovery ───────────────────────────────────────────────────────────

export function getAllSlotStatuses(dataDir: string, cfg: TestEnvConfig): SlotStatus[] {
  return Array.from({ length: cfg.max_slots }, (_, slot) => {
    const lock = readLock(dataDir, slot);
    if (!lock) {
      return { slot, state: 'free' as const };
    }
    const expired = isLockExpired(lock, cfg.timeout_minutes);
    const elapsed = (Date.now() - new Date(lock.acquiredAt).getTime()) / 60_000;
    return {
      slot,
      state: expired ? ('expired' as const) : ('acquired' as const),
      lock,
      ports: lock.ports,
      dataPath: lock.dataPath,
      acquiredAt: lock.acquiredAt,
      elapsedMinutes: Math.round(elapsed),
    };
  });
}

/**
 * Find a free slot. Auto-releases expired locks.
 * Returns the slot number, or null if all slots are occupied.
 */
export function findFreeSlot(
  dataDir: string,
  cfg: TestEnvConfig,
): number | null {
  for (let slot = 0; slot < cfg.max_slots; slot++) {
    const lock = readLock(dataDir, slot);
    if (!lock) return slot;
    if (isLockExpired(lock, cfg.timeout_minutes)) {
      // Auto-release the expired lock (best-effort)
      removeLock(dataDir, slot);
      return slot;
    }
  }
  return null;
}

// ── Data directory management ────────────────────────────────────────────────

export function createSlotDirs(slotDataPath: string): void {
  const dirs = [
    'notes',
    join('vaults', 'personal'),
    'registry',
    'workspaces',
    'sessions',
    'typesense-data',
  ];
  for (const dir of dirs) {
    mkdirSync(join(slotDataPath, dir), { recursive: true });
  }
}

export function removeSlotDirs(slotDataPath: string): void {
  if (existsSync(slotDataPath)) {
    rmSync(slotDataPath, { recursive: true, force: true });
  }
}

/**
 * Pre-seed the slot's notes directory so Anvil starts with a valid git repo
 * instead of attempting an HTTPS clone on startup.
 *
 * Happy path: local clone of production notes (instant, no network).
 * Fallback: git init + empty commit (Anvil healthy, notes empty — safe for testing).
 */
export async function preSeedNotesDir(dataDir: string, slotDataPath: string): Promise<void> {
  const srcNotesPath = join(dataDir, 'notes');
  const destNotesPath = join(slotDataPath, 'notes');

  if (existsSync(join(srcNotesPath, '.git'))) {
    // Remove the empty dir createSlotDirs made so git clone can recreate it
    if (existsSync(destNotesPath)) {
      rmSync(destNotesPath, { recursive: true });
    }
    await execa('git', ['clone', '--local', srcNotesPath, destNotesPath]);
  } else {
    // Fallback: init a minimal git repo so Anvil doesn't try to HTTPS-clone
    await execa('git', ['-C', destNotesPath, 'init']);
    await execa('git', [
      '-C', destNotesPath,
      '-c', 'user.email=horus@local',
      '-c', 'user.name=Horus',
      'commit', '--allow-empty', '-m', 'init',
    ]);
  }
}

// ── Compose operations ───────────────────────────────────────────────────────

export function buildComposeEnv(
  runtime: Runtime,
  ports: SlotPorts,
  slotDataPath: string,
): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    HORUS_RUNTIME: runtime.name,
    TEST_DATA_PATH: slotDataPath,
    // Override base compose port variables so the base file binds to test ports.
    // Without these, Docker Compose merges (appends) the ports lists from both
    // files, causing both the production port (e.g. 8100) and the test port
    // (e.g. 9100) to be bound — failing if the production stack is already up.
    ANVIL_PORT:               String(ports.anvil),
    FORGE_PORT:               String(ports.forge),
    VAULT_MCP_PORT:           String(ports.vault_mcp),
    VAULT_ROUTER_PORT:        String(ports.vault_router),
    VAULT_REST_PORT_PERSONAL: String(ports.vault_svc),
    TYPESENSE_PORT:           String(ports.typesense),
    UI_PORT:                  String(ports.ui),
    // TEST_PORT_* vars for overlay reference (harmless duplicates after above fix)
    TEST_PORT_ANVIL:        String(ports.anvil),
    TEST_PORT_TYPESENSE:    String(ports.typesense),
    TEST_PORT_VAULT_SVC:    String(ports.vault_svc),
    TEST_PORT_VAULT_ROUTER: String(ports.vault_router),
    TEST_PORT_VAULT_MCP:    String(ports.vault_mcp),
    TEST_PORT_FORGE:        String(ports.forge),
    TEST_PORT_UI:           String(ports.ui),
  };
}

export async function composeUp(
  runtime: Runtime,
  projectName: string,
  ports: SlotPorts,
  slotDataPath: string,
): Promise<void> {
  const env = buildComposeEnv(runtime, ports, slotDataPath);
  const result = await execa(
    runtime.name,
    [
      'compose',
      '-p', projectName,
      '-f', join(HORUS_DIR, 'docker-compose.yml'),
      '-f', join(HORUS_DIR, 'docker-compose.test.yml'),
      'up', '-d',
    ],
    { cwd: HORUS_DIR, env, reject: false },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to start shadow stack (project ${projectName}):\n${result.stderr}`,
    );
  }
}

export async function composeDown(
  runtime: Runtime,
  projectName: string,
  ports: SlotPorts,
  slotDataPath: string,
): Promise<void> {
  const env = buildComposeEnv(runtime, ports, slotDataPath);
  await execa(
    runtime.name,
    ['compose', '-p', projectName, 'down', '--volumes', '--remove-orphans'],
    { cwd: HORUS_DIR, env, reject: false },
  );
}

// ── Health polling ───────────────────────────────────────────────────────────

const HEALTH_SERVICES = ['anvil', 'forge', 'vault-mcp', 'typesense'] as const;

async function checkContainerHealthByProject(
  runtime: Runtime,
  projectName: string,
  service: string,
): Promise<'healthy' | 'starting' | 'unhealthy'> {
  const candidates = [
    `${projectName}-${service}-1`,
    `${projectName}_${service}_1`,
  ];
  for (const name of candidates) {
    try {
      const result = await execa(
        runtime.name,
        ['inspect', '--format', '{{.State.Health.Status}}', name],
        { reject: false },
      );
      if (result.exitCode === 0) {
        const status = result.stdout.toString().trim().toLowerCase();
        if (status === 'healthy') return 'healthy';
        if (status === 'unhealthy') return 'unhealthy';
        return 'starting';
      }
    } catch {
      continue;
    }
  }
  return 'starting';
}

export async function waitForShadowStackHealthy(
  runtime: Runtime,
  projectName: string,
  timeoutMs = 120_000,
  intervalMs = 3_000,
  onUpdate?: (statuses: Record<string, string>) => void,
): Promise<void> {
  const start = Date.now();
  while (true) {
    const statuses: Record<string, string> = {};
    await Promise.all(
      HEALTH_SERVICES.map(async (svc) => {
        statuses[svc] = await checkContainerHealthByProject(runtime, projectName, svc);
      }),
    );

    if (onUpdate) onUpdate(statuses);

    const allHealthy = Object.values(statuses).every((s) => s === 'healthy');
    if (allHealthy) return;

    const anyUnhealthy = Object.values(statuses).some((s) => s === 'unhealthy');
    if (anyUnhealthy) {
      const failed = Object.entries(statuses)
        .filter(([, s]) => s === 'unhealthy')
        .map(([n]) => n)
        .join(', ');
      throw new Error(`Shadow stack services failed health check: ${failed}`);
    }

    if (Date.now() - start >= timeoutMs) {
      const notReady = Object.entries(statuses)
        .filter(([, s]) => s !== 'healthy')
        .map(([n, s]) => `${n}(${s})`)
        .join(', ');
      throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for: ${notReady}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Seeding ──────────────────────────────────────────────────────────────────

export function seedFromFixtures(fixturesPath: string, slotDataPath: string): void {
  if (!existsSync(fixturesPath)) {
    throw new Error(`Fixtures not found at ${fixturesPath}. Run from the Horus repo root.`);
  }
  const dirs = readdirSync(fixturesPath);
  for (const dir of dirs) {
    const src = join(fixturesPath, dir);
    const dest = join(slotDataPath, dir);
    cpSync(src, dest, { recursive: true });
  }
}

export function seedFromLive(dataDir: string, slotDataPath: string): void {
  const liveDirs = ['notes', 'vaults', 'registry'];
  for (const dir of liveDirs) {
    const src = join(dataDir, dir);
    const dest = join(slotDataPath, dir);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
    }
  }
}

// ── Project name ─────────────────────────────────────────────────────────────

export function projectName(slot: number): string {
  return `horus-test-${slot}`;
}
