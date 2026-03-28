import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { WorkspaceLifecycleManager } from '../workspace-lifecycle.js';
import { WorkspaceMetadataStore } from '../workspace-metadata-store.js';
import type { WorkspaceRecord } from '../../models/workspace-record.js';

describe('WorkspaceLifecycleManager', () => {
  let tmpFile: string;
  let store: WorkspaceMetadataStore;
  let manager: WorkspaceLifecycleManager;

  beforeEach(async () => {
    tmpFile = path.join(tmpdir(), `forge-test-${randomUUID()}.json`);
    store = new WorkspaceMetadataStore().withPath(tmpFile);
    manager = new WorkspaceLifecycleManager(undefined, store);
  });

  afterEach(async () => {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  function createTestRecord(overrides?: Partial<WorkspaceRecord>): WorkspaceRecord {
    return {
      id: 'ws-test001',
      name: 'test-workspace',
      configRef: 'sdlc-default@1.0.0',
      storyId: null,
      storyTitle: null,
      path: '/tmp/test-workspace',
      status: 'active',
      repos: [],
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      completedAt: null,
      ...overrides,
    };
  }

  describe('pause()', () => {
    it('transitions workspace from active to paused', async () => {
      const record = createTestRecord();
      await store.create(record);

      const result = await manager.pause(record.id);

      expect(result.status).toBe('paused');
    });

    it('throws when workspace not found', async () => {
      await expect(manager.pause('nonexistent')).rejects.toThrow("Workspace 'nonexistent' not found");
    });

    it('throws on invalid transition from archived', async () => {
      const record = createTestRecord({ status: 'archived' });
      await store.create(record);

      await expect(manager.pause(record.id)).rejects.toThrow(
        "Cannot transition workspace from 'archived' to 'paused'",
      );
    });
  });

  describe('complete()', () => {
    it('transitions workspace to completed and sets completedAt', async () => {
      const record = createTestRecord();
      await store.create(record);

      const beforeTime = new Date();
      const result = await manager.complete(record.id);
      const afterTime = new Date();

      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeTruthy();

      const completedDate = new Date(result.completedAt!);
      expect(completedDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(completedDate.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('can complete from both active and paused', async () => {
      const activeRecord = createTestRecord({ status: 'active' });
      await store.create(activeRecord);
      const result1 = await manager.complete(activeRecord.id);
      expect(result1.status).toBe('completed');

      const pausedRecord = createTestRecord({ id: 'ws-paused', status: 'paused' });
      await store.create(pausedRecord);
      const result2 = await manager.complete(pausedRecord.id);
      expect(result2.status).toBe('completed');
    });
  });

  describe('archive()', () => {
    it('transitions workspace to archived from completed', async () => {
      const record = createTestRecord({ status: 'completed' });
      await store.create(record);

      const result = await manager.archive(record.id);

      expect(result.status).toBe('archived');
    });

    it('can archive from active', async () => {
      const record = createTestRecord({ status: 'active' });
      await store.create(record);

      const result = await manager.archive(record.id);

      expect(result.status).toBe('archived');
    });

    it('throws on invalid transition: archived -> archived', async () => {
      const record = createTestRecord({ status: 'archived' });
      await store.create(record);

      await expect(manager.archive(record.id)).rejects.toThrow(
        "Cannot transition workspace from 'archived' to 'archived'",
      );
    });
  });

  describe('touch()', () => {
    it('updates lastAccessedAt', async () => {
      const record = createTestRecord();
      const oldTime = new Date(Date.now() - 1000000);
      record.lastAccessedAt = oldTime.toISOString();
      await store.create(record);

      const beforeTime = new Date();
      await manager.touch(record.id);
      const afterTime = new Date();

      const updated = await store.get(record.id);
      const accessedDate = new Date(updated!.lastAccessedAt);
      expect(accessedDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(accessedDate.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('delete()', () => {
    it('removes workspace record from store', async () => {
      const record = createTestRecord();
      await store.create(record);

      await manager.delete(record.id, { force: true });

      const retrieved = await store.get(record.id);
      expect(retrieved).toBeNull();
    });

    it('throws when workspace not found', async () => {
      await expect(manager.delete('nonexistent', { force: true })).rejects.toThrow(
        "Workspace 'nonexistent' not found",
      );
    });

    it('removes workspace folder from disk', async () => {
      const tmpDir = path.join(tmpdir(), `ws-${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });

      const record = createTestRecord({ path: tmpDir });
      await store.create(record);

      // Verify folder exists
      const stat = await fs.stat(tmpDir);
      expect(stat.isDirectory()).toBe(true);

      await manager.delete(record.id, { force: true });

      // Folder should be removed
      try {
        await fs.stat(tmpDir);
        expect.fail('Folder should have been deleted');
      } catch (err: any) {
        expect(err.code).toBe('ENOENT');
      }
    });
  });

  describe('getRetentionCandidates()', () => {
    it('returns workspaces older than retention period', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      const record1 = createTestRecord({
        id: 'ws-old',
        lastAccessedAt: oldDate.toISOString(),
        status: 'active',
      });
      const record2 = createTestRecord({
        id: 'ws-recent',
        lastAccessedAt: new Date().toISOString(),
        status: 'active',
      });

      await store.create(record1);
      await store.create(record2);

      const candidates = await manager.getRetentionCandidates(30);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('ws-old');
    });

    it('ignores completed workspaces', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      const record = createTestRecord({
        id: 'ws-completed-old',
        lastAccessedAt: oldDate.toISOString(),
        status: 'completed',
      });

      await store.create(record);

      const candidates = await manager.getRetentionCandidates(30);

      expect(candidates).toHaveLength(0);
    });

    it('ignores archived workspaces', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      const record = createTestRecord({
        id: 'ws-archived-old',
        lastAccessedAt: oldDate.toISOString(),
        status: 'archived',
      });

      await store.create(record);

      const candidates = await manager.getRetentionCandidates(30);

      expect(candidates).toHaveLength(0);
    });
  });

  describe('clean()', () => {
    it('dry-run returns candidates without deleting', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      const record = createTestRecord({
        id: 'ws-old',
        lastAccessedAt: oldDate.toISOString(),
        status: 'active',
      });

      await store.create(record);

      const result = await manager.clean(30, { dryRun: true });

      expect(result.cleaned).toContain('ws-old');
      expect(result.skipped).toHaveLength(0);

      // Record should still exist
      const still = await store.get('ws-old');
      expect(still).toBeTruthy();
    });

    it('deletes candidates when not dry-run', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      const tmpDir = path.join(tmpdir(), `ws-${randomUUID()}`);
      await fs.mkdir(tmpDir, { recursive: true });

      const record = createTestRecord({
        id: 'ws-old',
        path: tmpDir,
        lastAccessedAt: oldDate.toISOString(),
        status: 'active',
      });

      await store.create(record);

      const result = await manager.clean(30, { dryRun: false });

      expect(result.cleaned).toContain('ws-old');

      // Record should be gone
      const gone = await store.get('ws-old');
      expect(gone).toBeNull();
    });

    it('handles empty candidate list', async () => {
      const result = await manager.clean(30);
      expect(result.cleaned).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe('State machine validation', () => {
  it('allows active -> paused and paused can transition', async () => {
      const record = createTestRecord({ status: 'active' });
      await store.create(record);

      const paused = await manager.pause(record.id);
      expect(paused.status).toBe('paused');

      // From paused, we can complete or archive
      const completed = await manager.complete(paused.id);
      expect(completed.status).toBe('completed');
    });

    it('allows active -> completed -> archived', async () => {
      const record = createTestRecord({ status: 'active' });
      await store.create(record);

      const completed = await manager.complete(record.id);
      expect(completed.status).toBe('completed');

      const archived = await manager.archive(completed.id);
      expect(archived.status).toBe('archived');
    });

    it('terminal state: archived rejects all transitions', async () => {
      const record = createTestRecord({ status: 'archived' });
      await store.create(record);

      await expect(manager.pause(record.id)).rejects.toThrow();
      await expect(manager.complete(record.id)).rejects.toThrow();
      await expect(manager.archive(record.id)).rejects.toThrow();
    });
  });
});
