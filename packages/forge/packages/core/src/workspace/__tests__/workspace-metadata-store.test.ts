import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  WorkspaceMetadataStore,
  generateWorkspaceId,
  WORKSPACES_FILE,
} from '../workspace-metadata-store.js';
import type { WorkspaceRecord } from '../../models/workspace-record.js';

describe('WorkspaceMetadataStore', () => {
  let tmpFile: string;
  let store: WorkspaceMetadataStore;

  beforeEach(() => {
    tmpFile = path.join(tmpdir(), `forge-test-${randomUUID()}.json`);
    store = new WorkspaceMetadataStore().withPath(tmpFile);
  });

  afterEach(async () => {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe('load()', () => {
    it('returns empty store for missing file', async () => {
      const loaded = await store.load();
      expect(loaded.version).toBe('1');
      expect(loaded.workspaces).toEqual({});
    });
  });

  describe('create() + get() round-trip', () => {
    it('creates and retrieves a workspace record', async () => {
      const record: WorkspaceRecord = {
        id: 'ws-12345678',
        name: 'test-workspace',
        configRef: 'sdlc-default@1.0.0',
        storyId: 'story-001',
        storyTitle: 'Setup workspace',
        path: '/home/user/workspaces/test-workspace',
        status: 'active',
        repos: [
          {
            name: 'main-repo',
            localPath: '/home/user/workspaces/test-workspace/main-repo',
            branch: 'main',
            worktreePath: null,
          },
        ],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        completedAt: null,
      };

      await store.create(record);
      const retrieved = await store.get('ws-12345678');

      expect(retrieved).toEqual(record);
    });
  });

  describe('create() duplicate ID', () => {
    it('throws on duplicate ID', async () => {
      const record: WorkspaceRecord = {
        id: 'ws-duplicate',
        name: 'test',
        configRef: 'sdlc-default@1.0.0',
        storyId: null,
        storyTitle: null,
        path: '/tmp/test',
        status: 'active',
        repos: [],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        completedAt: null,
      };

      await store.create(record);
      await expect(store.create(record)).rejects.toThrow('already exists');
    });
  });

  describe('update()', () => {
    it('patches specific fields and preserves others', async () => {
      const original: WorkspaceRecord = {
        id: 'ws-update-test',
        name: 'original-name',
        configRef: 'sdlc-default@1.0.0',
        storyId: 'story-001',
        storyTitle: 'Original Title',
        path: '/home/user/workspaces/test',
        status: 'active',
        repos: [],
        createdAt: '2026-02-01T10:00:00Z',
        lastAccessedAt: '2026-02-01T10:00:00Z',
        completedAt: null,
      };

      await store.create(original);

      const updated = await store.update('ws-update-test', {
        status: 'paused',
        storyTitle: 'Updated Title',
      });

      expect(updated.status).toBe('paused');
      expect(updated.storyTitle).toBe('Updated Title');
      expect(updated.name).toBe('original-name'); // preserved
      expect(updated.configRef).toBe('sdlc-default@1.0.0'); // preserved
      expect(updated.createdAt).toBe('2026-02-01T10:00:00Z'); // preserved
    });

    it('throws for unknown ID', async () => {
      await expect(store.update('ws-nonexistent', { status: 'paused' })).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('delete()', () => {
    it('removes a record', async () => {
      const record: WorkspaceRecord = {
        id: 'ws-delete-test',
        name: 'to-delete',
        configRef: 'sdlc-default@1.0.0',
        storyId: null,
        storyTitle: null,
        path: '/tmp/test',
        status: 'active',
        repos: [],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        completedAt: null,
      };

      await store.create(record);
      await store.delete('ws-delete-test');

      const retrieved = await store.get('ws-delete-test');
      expect(retrieved).toBeNull();
    });

    it('throws for unknown ID', async () => {
      await expect(store.delete('ws-nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('list()', () => {
    it('returns all records', async () => {
      const now = new Date().toISOString();
      const records: WorkspaceRecord[] = [
        {
          id: 'ws-1',
          name: 'workspace-1',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws1',
          status: 'active',
          repos: [],
          createdAt: now,
          lastAccessedAt: now,
          completedAt: null,
        },
        {
          id: 'ws-2',
          name: 'workspace-2',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws2',
          status: 'paused',
          repos: [],
          createdAt: now,
          lastAccessedAt: now,
          completedAt: null,
        },
      ];

      for (const rec of records) {
        await store.create(rec);
      }

      const listed = await store.list();
      expect(listed).toHaveLength(2);
    });

    it('filters by status', async () => {
      const now = new Date().toISOString();
      const records: WorkspaceRecord[] = [
        {
          id: 'ws-active',
          name: 'workspace-active',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-active',
          status: 'active',
          repos: [],
          createdAt: now,
          lastAccessedAt: now,
          completedAt: null,
        },
        {
          id: 'ws-paused',
          name: 'workspace-paused',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-paused',
          status: 'paused',
          repos: [],
          createdAt: now,
          lastAccessedAt: now,
          completedAt: null,
        },
        {
          id: 'ws-completed',
          name: 'workspace-completed',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-completed',
          status: 'completed',
          repos: [],
          createdAt: now,
          lastAccessedAt: now,
          completedAt: now,
        },
      ];

      for (const rec of records) {
        await store.create(rec);
      }

      const activeOnly = await store.list({ status: 'active' });
      expect(activeOnly).toHaveLength(1);
      expect(activeOnly[0].id).toBe('ws-active');
    });

    it('sorts by lastAccessedAt descending', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const records: WorkspaceRecord[] = [
        {
          id: 'ws-old',
          name: 'old',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old',
          status: 'active',
          repos: [],
          createdAt: twoHoursAgo.toISOString(),
          lastAccessedAt: twoHoursAgo.toISOString(),
          completedAt: null,
        },
        {
          id: 'ws-new',
          name: 'new',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-new',
          status: 'active',
          repos: [],
          createdAt: now.toISOString(),
          lastAccessedAt: now.toISOString(),
          completedAt: null,
        },
        {
          id: 'ws-mid',
          name: 'mid',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-mid',
          status: 'active',
          repos: [],
          createdAt: oneHourAgo.toISOString(),
          lastAccessedAt: oneHourAgo.toISOString(),
          completedAt: null,
        },
      ];

      for (const rec of records) {
        await store.create(rec);
      }

      const listed = await store.list();
      expect(listed[0].id).toBe('ws-new');
      expect(listed[1].id).toBe('ws-mid');
      expect(listed[2].id).toBe('ws-old');
    });
  });

  describe('findByStoryId()', () => {
    it('finds workspace by story ID', async () => {
      const record: WorkspaceRecord = {
        id: 'ws-story-linked',
        name: 'story-workspace',
        configRef: 'sdlc-default@1.0.0',
        storyId: 'story-123',
        storyTitle: 'My Story',
        path: '/tmp/ws-story',
        status: 'active',
        repos: [],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        completedAt: null,
      };

      await store.create(record);
      const found = await store.findByStoryId('story-123');

      expect(found).toEqual(record);
    });

    it('returns null if story ID not found', async () => {
      const found = await store.findByStoryId('nonexistent-story');
      expect(found).toBeNull();
    });
  });

  describe('touch()', () => {
    it('updates lastAccessedAt to now', async () => {
      const oldTime = new Date('2026-01-01T10:00:00Z').toISOString();
      const record: WorkspaceRecord = {
        id: 'ws-touch-test',
        name: 'touch-test',
        configRef: 'sdlc-default@1.0.0',
        storyId: null,
        storyTitle: null,
        path: '/tmp/ws-touch',
        status: 'active',
        repos: [],
        createdAt: oldTime,
        lastAccessedAt: oldTime,
        completedAt: null,
      };

      await store.create(record);
      const beforeTime = new Date();

      await store.touch('ws-touch-test');

      const afterTime = new Date();
      const updated = await store.get('ws-touch-test');

      expect(updated).not.toBeNull();
      const accessedTime = new Date(updated!.lastAccessedAt);
      expect(accessedTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(accessedTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
      expect(updated!.createdAt).toBe(oldTime); // createdAt unchanged
    });
  });

  describe('checkRetention()', () => {
    it('returns only active/paused workspaces past retention days', async () => {
      const now = new Date();
      const fiftyDaysAgo = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = now.toISOString();

      const records: WorkspaceRecord[] = [
        {
          id: 'ws-old-active',
          name: 'old-active',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old-active',
          status: 'active',
          repos: [],
          createdAt: fiftyDaysAgo,
          lastAccessedAt: fiftyDaysAgo,
          completedAt: null,
        },
        {
          id: 'ws-old-paused',
          name: 'old-paused',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old-paused',
          status: 'paused',
          repos: [],
          createdAt: fiftyDaysAgo,
          lastAccessedAt: fiftyDaysAgo,
          completedAt: null,
        },
        {
          id: 'ws-old-completed',
          name: 'old-completed',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old-completed',
          status: 'completed',
          repos: [],
          createdAt: fiftyDaysAgo,
          lastAccessedAt: fiftyDaysAgo,
          completedAt: fiftyDaysAgo,
        },
        {
          id: 'ws-old-archived',
          name: 'old-archived',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old-archived',
          status: 'archived',
          repos: [],
          createdAt: fiftyDaysAgo,
          lastAccessedAt: fiftyDaysAgo,
          completedAt: fiftyDaysAgo,
        },
        {
          id: 'ws-recent-active',
          name: 'recent-active',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-recent-active',
          status: 'active',
          repos: [],
          createdAt: tenDaysAgo,
          lastAccessedAt: tenDaysAgo,
          completedAt: null,
        },
      ];

      for (const rec of records) {
        await store.create(rec);
      }

      const candidates = await store.checkRetention(30);

      expect(candidates).toHaveLength(2);
      const ids = candidates.map((c) => c.id);
      expect(ids).toContain('ws-old-active');
      expect(ids).toContain('ws-old-paused');
      expect(ids).not.toContain('ws-old-completed');
      expect(ids).not.toContain('ws-old-archived');
      expect(ids).not.toContain('ws-recent-active');
    });

    it('does not return completed/archived workspaces', async () => {
      const fiftyDaysAgo = new Date(
        new Date().getTime() - 50 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const records: WorkspaceRecord[] = [
        {
          id: 'ws-old-completed',
          name: 'old-completed',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old-completed',
          status: 'completed',
          repos: [],
          createdAt: fiftyDaysAgo,
          lastAccessedAt: fiftyDaysAgo,
          completedAt: fiftyDaysAgo,
        },
        {
          id: 'ws-old-archived',
          name: 'old-archived',
          configRef: 'sdlc-default@1.0.0',
          storyId: null,
          storyTitle: null,
          path: '/tmp/ws-old-archived',
          status: 'archived',
          repos: [],
          createdAt: fiftyDaysAgo,
          lastAccessedAt: fiftyDaysAgo,
          completedAt: fiftyDaysAgo,
        },
      ];

      for (const rec of records) {
        await store.create(rec);
      }

      const candidates = await store.checkRetention(30);

      expect(candidates).toHaveLength(0);
    });
  });

  describe('generateWorkspaceId()', () => {
    it('generates ws- prefix with 8 random chars', () => {
      const id = generateWorkspaceId();
      expect(id).toMatch(/^ws-[a-z0-9]{8}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateWorkspaceId());
      }
      expect(ids.size).toBe(100);
    });
  });
});
