import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calcPorts,
  findFreeSlot,
  readLock,
  writeLock,
  removeLock,
  isLockExpired,
  getAllSlotStatuses,
  loadTestEnvConfig,
  getSlotDataPath,
  projectName,
  createSlotDirs,
  removeSlotDirs,
  getTestEnvRoot,
  preSeedNotesDir,
  type SlotLock,
  type TestEnvConfig,
} from '../lib/test-env.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `horus-test-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeLock(slot: number, overrides: Partial<SlotLock> = {}): SlotLock {
  return {
    slot,
    pid: 12345,
    acquiredAt: new Date().toISOString(),
    ports: calcPorts(slot, 9100),
    dataPath: getSlotDataPath(testDir, slot),
    ...overrides,
  };
}

// ── calcPorts ────────────────────────────────────────────────────────────────

describe('calcPorts', () => {
  it('slot 0 with base 9100 returns expected ports', () => {
    const ports = calcPorts(0, 9100);
    expect(ports.anvil).toBe(9100);
    expect(ports.typesense).toBe(9108);
    expect(ports.vault_svc).toBe(9101);
    expect(ports.vault_router).toBe(9150);
    expect(ports.vault_mcp).toBe(9200);
    expect(ports.forge).toBe(9250);
    expect(ports.ui).toBe(9260);
  });

  it('slot 1 is offset by 300', () => {
    const p0 = calcPorts(0, 9100);
    const p1 = calcPorts(1, 9100);
    expect(p1.anvil).toBe(p0.anvil + 300);
    expect(p1.forge).toBe(p0.forge + 300);
    expect(p1.typesense).toBe(p0.typesense + 300);
  });

  it('custom base port is respected', () => {
    const ports = calcPorts(0, 10000);
    expect(ports.anvil).toBe(10000);
    expect(ports.typesense).toBe(10008);
  });
});

// ── projectName ──────────────────────────────────────────────────────────────

describe('projectName', () => {
  it('returns horus-test-N', () => {
    expect(projectName(0)).toBe('horus-test-0');
    expect(projectName(1)).toBe('horus-test-1');
    expect(projectName(3)).toBe('horus-test-3');
  });
});

// ── Lock file management ─────────────────────────────────────────────────────

describe('lock files', () => {
  it('readLock returns null when no lock exists', () => {
    expect(readLock(testDir, 0)).toBeNull();
  });

  it('writeLock + readLock round-trips correctly', () => {
    const lock = makeLock(0);
    writeLock(testDir, lock);
    const read = readLock(testDir, 0);
    expect(read).toEqual(lock);
  });

  it('removeLock deletes the file', () => {
    writeLock(testDir, makeLock(0));
    removeLock(testDir, 0);
    expect(readLock(testDir, 0)).toBeNull();
  });

  it('removeLock is a no-op when lock does not exist', () => {
    expect(() => removeLock(testDir, 99)).not.toThrow();
  });

  it('writeLock creates parent dirs if needed', () => {
    rmSync(getTestEnvRoot(testDir), { recursive: true, force: true });
    expect(() => writeLock(testDir, makeLock(0))).not.toThrow();
    expect(readLock(testDir, 0)).not.toBeNull();
  });
});

// ── isLockExpired ────────────────────────────────────────────────────────────

describe('isLockExpired', () => {
  it('fresh lock is not expired', () => {
    const lock = makeLock(0); // acquiredAt = now
    expect(isLockExpired(lock, 10)).toBe(false);
  });

  it('old lock is expired', () => {
    const old = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago
    const lock = makeLock(0, { acquiredAt: old });
    expect(isLockExpired(lock, 10)).toBe(true);
  });

  it('lock at exactly timeout boundary is expired', () => {
    const exact = new Date(Date.now() - 10 * 60 * 1000 - 1).toISOString();
    const lock = makeLock(0, { acquiredAt: exact });
    expect(isLockExpired(lock, 10)).toBe(true);
  });
});

// ── findFreeSlot ─────────────────────────────────────────────────────────────

describe('findFreeSlot', () => {
  const cfg: TestEnvConfig = { max_slots: 2, timeout_minutes: 10, base_port: 9100 };

  it('returns 0 when no locks exist', () => {
    expect(findFreeSlot(testDir, cfg)).toBe(0);
  });

  it('returns next free slot when slot 0 is occupied', () => {
    writeLock(testDir, makeLock(0));
    expect(findFreeSlot(testDir, cfg)).toBe(1);
  });

  it('returns null when all slots are occupied', () => {
    writeLock(testDir, makeLock(0));
    writeLock(testDir, makeLock(1));
    expect(findFreeSlot(testDir, cfg)).toBeNull();
  });

  it('auto-releases an expired lock and returns that slot', () => {
    const expiredLock = makeLock(0, {
      acquiredAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    writeLock(testDir, expiredLock);
    writeLock(testDir, makeLock(1));

    const slot = findFreeSlot(testDir, cfg);
    expect(slot).toBe(0);
    // Expired lock should have been removed
    expect(readLock(testDir, 0)).toBeNull();
  });
});

// ── getAllSlotStatuses ───────────────────────────────────────────────────────

describe('getAllSlotStatuses', () => {
  const cfg: TestEnvConfig = { max_slots: 3, timeout_minutes: 10, base_port: 9100 };

  it('all free when no locks', () => {
    const statuses = getAllSlotStatuses(testDir, cfg);
    expect(statuses).toHaveLength(3);
    expect(statuses.every((s) => s.state === 'free')).toBe(true);
  });

  it('shows acquired state for active lock', () => {
    writeLock(testDir, makeLock(1));
    const statuses = getAllSlotStatuses(testDir, cfg);
    expect(statuses[0].state).toBe('free');
    expect(statuses[1].state).toBe('acquired');
    expect(statuses[2].state).toBe('free');
  });

  it('shows expired state for timed-out lock', () => {
    const expiredLock = makeLock(0, {
      acquiredAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    writeLock(testDir, expiredLock);
    const statuses = getAllSlotStatuses(testDir, cfg);
    expect(statuses[0].state).toBe('expired');
  });

  it('includes elapsed minutes', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    writeLock(testDir, makeLock(0, { acquiredAt: fiveMinAgo }));
    const statuses = getAllSlotStatuses(testDir, cfg);
    expect(statuses[0].elapsedMinutes).toBeGreaterThanOrEqual(4);
    expect(statuses[0].elapsedMinutes).toBeLessThanOrEqual(6);
  });
});

// ── loadTestEnvConfig ────────────────────────────────────────────────────────

describe('loadTestEnvConfig', () => {
  it('returns defaults when no config file exists', () => {
    const cfg = loadTestEnvConfig(testDir);
    expect(cfg.max_slots).toBe(1);
    expect(cfg.timeout_minutes).toBe(10);
    expect(cfg.base_port).toBe(9100);
  });

  it('loads config from test-env.yaml', () => {
    const configDir = join(testDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'test-env.yaml'),
      `test_env:\n  max_slots: 4\n  timeout_minutes: 30\n  base_port: 10000\n`,
      'utf-8',
    );
    const cfg = loadTestEnvConfig(testDir);
    expect(cfg.max_slots).toBe(4);
    expect(cfg.timeout_minutes).toBe(30);
    expect(cfg.base_port).toBe(10000);
  });

  it('merges partial config with defaults', () => {
    const configDir = join(testDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'test-env.yaml'),
      `test_env:\n  max_slots: 3\n`,
      'utf-8',
    );
    const cfg = loadTestEnvConfig(testDir);
    expect(cfg.max_slots).toBe(3);
    expect(cfg.timeout_minutes).toBe(10); // default preserved
    expect(cfg.base_port).toBe(9100);     // default preserved
  });

  it('returns defaults when config file is malformed', () => {
    const configDir = join(testDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'test-env.yaml'), `: not valid yaml ::`, 'utf-8');
    // Should not throw
    const cfg = loadTestEnvConfig(testDir);
    expect(cfg.max_slots).toBe(1);
  });
});

// ── createSlotDirs / removeSlotDirs ─────────────────────────────────────────

describe('slot data directory management', () => {
  it('createSlotDirs creates expected subdirectories with default vault name', () => {
    const slotPath = getSlotDataPath(testDir, 0);
    createSlotDirs(slotPath);
    const expectedDirs = ['notes', 'registry', 'workspaces', 'sessions', 'typesense-data'];
    for (const dir of expectedDirs) {
      expect(existsSync(join(slotPath, dir))).toBe(true);
    }
    // Default vault dir
    expect(existsSync(join(slotPath, 'vaults', 'default'))).toBe(true);
  });

  it('createSlotDirs creates vault dirs from provided vault names', () => {
    const slotPath = getSlotDataPath(testDir, 0);
    createSlotDirs(slotPath, ['personal', 'work']);
    expect(existsSync(join(slotPath, 'vaults', 'personal'))).toBe(true);
    expect(existsSync(join(slotPath, 'vaults', 'work'))).toBe(true);
  });

  it('removeSlotDirs removes directory recursively', () => {
    const slotPath = getSlotDataPath(testDir, 0);
    createSlotDirs(slotPath);
    expect(existsSync(slotPath)).toBe(true);
    removeSlotDirs(slotPath);
    expect(existsSync(slotPath)).toBe(false);
  });

  it('removeSlotDirs is a no-op when path does not exist', () => {
    expect(() => removeSlotDirs(join(testDir, 'nonexistent'))).not.toThrow();
  });
});

// ── preSeedNotesDir ──────────────────────────────────────────────────────────

describe('preSeedNotesDir', () => {
  it('clones from production notes when src is a valid git repo', async () => {
    // Set up a minimal git repo as the "production" notes source
    const srcDataDir = join(testDir, 'src-data');
    const srcNotesPath = join(srcDataDir, 'notes');
    mkdirSync(srcNotesPath, { recursive: true });
    const { execa } = await import('execa');
    await execa('git', ['-C', srcNotesPath, 'init']);
    await execa('git', [
      '-C', srcNotesPath,
      '-c', 'user.email=test@local', '-c', 'user.name=Test',
      'commit', '--allow-empty', '-m', 'init',
    ]);

    const slotPath = getSlotDataPath(testDir, 0);
    createSlotDirs(slotPath);

    await preSeedNotesDir(srcDataDir, slotPath);

    const destNotesPath = join(slotPath, 'notes');
    expect(existsSync(destNotesPath)).toBe(true);
    expect(existsSync(join(destNotesPath, '.git'))).toBe(true);
  });

  it('falls back to git init when src has no git repo', async () => {
    const srcDataDir = join(testDir, 'src-no-git');
    // notes dir exists but is not a git repo
    mkdirSync(join(srcDataDir, 'notes'), { recursive: true });

    const slotPath = getSlotDataPath(testDir, 1);
    createSlotDirs(slotPath);

    await preSeedNotesDir(srcDataDir, slotPath);

    const destNotesPath = join(slotPath, 'notes');
    expect(existsSync(join(destNotesPath, '.git'))).toBe(true);
  });

  it('falls back to git init when src notes dir is missing entirely', async () => {
    const srcDataDir = join(testDir, 'src-missing');
    mkdirSync(srcDataDir, { recursive: true });
    // no notes subdir

    const slotPath = getSlotDataPath(testDir, 2);
    createSlotDirs(slotPath);

    await preSeedNotesDir(srcDataDir, slotPath);

    const destNotesPath = join(slotPath, 'notes');
    expect(existsSync(join(destNotesPath, '.git'))).toBe(true);
  });
});
