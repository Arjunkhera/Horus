import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceManager } from '../workspace-manager.js';
import { ForgeError } from '../../adapters/errors.js';

describe('WorkspaceManager', () => {
  let tmpDir: string;
  let wm: WorkspaceManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-wm-test-'));
    wm = new WorkspaceManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('scaffoldWorkspace()', () => {
    it('creates forge.yaml and forge.lock', async () => {
      await wm.scaffoldWorkspace('test-workspace');
      const configExists = await fs
        .access(path.join(tmpDir, 'forge.yaml'))
        .then(() => true)
        .catch(() => false);
      const lockExists = await fs
        .access(path.join(tmpDir, 'forge.lock'))
        .then(() => true)
        .catch(() => false);
      expect(configExists).toBe(true);
      expect(lockExists).toBe(true);
    });

    it('throws if forge.yaml already exists', async () => {
      await wm.scaffoldWorkspace('first');
      await expect(wm.scaffoldWorkspace('second')).rejects.toThrow(ForgeError);
    });
  });

  describe('readConfig() / writeConfig()', () => {
    it('round-trips forge.yaml correctly', async () => {
      await wm.scaffoldWorkspace('my-workspace');
      const config = await wm.readConfig();
      expect(config.name).toBe('my-workspace');
      config.name = 'updated';
      await wm.writeConfig(config);
      const re = await wm.readConfig();
      expect(re.name).toBe('updated');
    });

    it('throws CONFIG_NOT_FOUND if forge.yaml missing', async () => {
      try {
        await wm.readConfig();
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ForgeError);
        expect(err.code).toBe('CONFIG_NOT_FOUND');
      }
    });
  });

  describe('readLock() / writeLock()', () => {
    it('returns empty lock if forge.lock missing', async () => {
      const lock = await wm.readLock();
      expect(lock.version).toBe('1');
      expect(lock.artifacts).toEqual({});
    });

    it('round-trips forge.lock correctly', async () => {
      const lock = await wm.readLock();
      await wm.writeLock(lock);
      const re = await wm.readLock();
      expect(re.version).toBe('1');
    });
  });

  describe('computeSha256()', () => {
    it('produces a 64-char hex string', () => {
      const hash = wm.computeSha256('hello world');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces consistent output', () => {
      expect(wm.computeSha256('test')).toBe(wm.computeSha256('test'));
    });
  });

  describe('mergeFiles()', () => {
    it('writes new files directly', async () => {
      const lock = await wm.readLock();
      const ops = [
        {
          path: '.claude/skills/dev/SKILL.md',
          content: '# Dev',
          sourceRef: { type: 'skill' as const, id: 'dev', version: '1.0.0' },
          operation: 'create' as const,
        },
      ];
      const report = await wm.mergeFiles(ops, lock, 'skip');
      expect(report.written).toContain('.claude/skills/dev/SKILL.md');
    });

    it('overwrites Forge-owned files', async () => {
      // Create a file and add it to lock
      const filePath = '.claude/skills/dev/SKILL.md';
      const absPath = path.join(tmpDir, filePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, 'old content');

      const lock = await wm.readLock();
      // Simulate forge ownership
      lock.artifacts['skill:dev'] = {
        id: 'dev',
        type: 'skill',
        version: '1.0.0',
        registry: 'local',
        sha256: 'a'.repeat(64),
        files: [filePath],
        resolvedAt: new Date().toISOString(),
      };

      const ops = [
        {
          path: filePath,
          content: 'new content',
          sourceRef: { type: 'skill' as const, id: 'dev', version: '1.0.0' },
          operation: 'update' as const,
        },
      ];
      const report = await wm.mergeFiles(ops, lock, 'skip');
      expect(report.written).toContain(filePath);
      const written = await fs.readFile(absPath, 'utf-8');
      expect(written).toBe('new content');
    });

    it('skips conflicting user-owned files with skip strategy', async () => {
      const filePath = 'user-file.md';
      await fs.writeFile(path.join(tmpDir, filePath), 'user content');
      const lock = await wm.readLock();
      const ops = [
        {
          path: filePath,
          content: 'forge content',
          sourceRef: { type: 'skill' as const, id: 'x', version: '1.0.0' },
          operation: 'update' as const,
        },
      ];
      const report = await wm.mergeFiles(ops, lock, 'skip');
      expect(report.skipped).toContain(filePath);
    });

    it('backs up conflicting files with backup strategy', async () => {
      const filePath = 'some-file.md';
      await fs.writeFile(path.join(tmpDir, filePath), 'user content');
      const lock = await wm.readLock();
      const ops = [
        {
          path: filePath,
          content: 'forge content',
          sourceRef: { type: 'skill' as const, id: 'x', version: '1.0.0' },
          operation: 'update' as const,
        },
      ];
      const report = await wm.mergeFiles(ops, lock, 'backup');
      expect(report.backed_up).toContain(filePath + '.bak');
      expect(report.written).toContain(filePath);
    });

    it('overwrites with overwrite strategy', async () => {
      const filePath = 'conflict-file.md';
      await fs.writeFile(path.join(tmpDir, filePath), 'user content');
      const lock = await wm.readLock();
      const ops = [
        {
          path: filePath,
          content: 'forge content',
          sourceRef: { type: 'skill' as const, id: 'x', version: '1.0.0' },
          operation: 'update' as const,
        },
      ];
      const report = await wm.mergeFiles(ops, lock, 'overwrite');
      expect(report.written).toContain(filePath);
      expect(report.backed_up).toEqual([]);
      const written = await fs.readFile(path.join(tmpDir, filePath), 'utf-8');
      expect(written).toBe('forge content');
    });

    it('treats prompt strategy as skip', async () => {
      const filePath = 'prompt-file.md';
      await fs.writeFile(path.join(tmpDir, filePath), 'user content');
      const lock = await wm.readLock();
      const ops = [
        {
          path: filePath,
          content: 'forge content',
          sourceRef: { type: 'skill' as const, id: 'x', version: '1.0.0' },
          operation: 'update' as const,
        },
      ];
      const report = await wm.mergeFiles(ops, lock, 'prompt');
      expect(report.skipped).toContain(filePath);
    });
  });

  describe('cleanUntracked()', () => {
    it('removes files no longer in the install set', async () => {
      const filePath1 = '.claude/skills/old/SKILL.md';
      const filePath2 = '.claude/skills/new/SKILL.md';
      const absPath1 = path.join(tmpDir, filePath1);
      const absPath2 = path.join(tmpDir, filePath2);

      // Create both files
      await fs.mkdir(path.dirname(absPath1), { recursive: true });
      await fs.mkdir(path.dirname(absPath2), { recursive: true });
      await fs.writeFile(absPath1, 'old');
      await fs.writeFile(absPath2, 'new');

      const lock = await wm.readLock();
      lock.artifacts['skill:old'] = {
        id: 'old',
        type: 'skill',
        version: '1.0.0',
        registry: 'local',
        sha256: 'a'.repeat(64),
        files: [filePath1, filePath2],
        resolvedAt: new Date().toISOString(),
      };

      const removed = await wm.cleanUntracked(lock, [filePath2]);
      expect(removed).toContain(filePath1);
      expect(removed).not.toContain(filePath2);

      const exists1 = await fs.access(absPath1).then(() => true).catch(() => false);
      const exists2 = await fs.access(absPath2).then(() => true).catch(() => false);
      expect(exists1).toBe(false);
      expect(exists2).toBe(true);
    });
  });
});
