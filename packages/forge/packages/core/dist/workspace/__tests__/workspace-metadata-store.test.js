"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = require("os");
const crypto_1 = require("crypto");
const workspace_metadata_store_js_1 = require("../workspace-metadata-store.js");
(0, vitest_1.describe)('WorkspaceMetadataStore', () => {
    let tmpFile;
    let store;
    (0, vitest_1.beforeEach)(() => {
        tmpFile = path_1.default.join((0, os_1.tmpdir)(), `forge-test-${(0, crypto_1.randomUUID)()}.json`);
        store = new workspace_metadata_store_js_1.WorkspaceMetadataStore().withPath(tmpFile);
    });
    (0, vitest_1.afterEach)(async () => {
        try {
            await fs_1.promises.unlink(tmpFile);
        }
        catch {
            // File doesn't exist, that's fine
        }
    });
    (0, vitest_1.describe)('load()', () => {
        (0, vitest_1.it)('returns empty store for missing file', async () => {
            const loaded = await store.load();
            (0, vitest_1.expect)(loaded.version).toBe('1');
            (0, vitest_1.expect)(loaded.workspaces).toEqual({});
        });
    });
    (0, vitest_1.describe)('create() + get() round-trip', () => {
        (0, vitest_1.it)('creates and retrieves a workspace record', async () => {
            const record = {
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
            (0, vitest_1.expect)(retrieved).toEqual(record);
        });
    });
    (0, vitest_1.describe)('create() duplicate ID', () => {
        (0, vitest_1.it)('throws on duplicate ID', async () => {
            const record = {
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
            await (0, vitest_1.expect)(store.create(record)).rejects.toThrow('already exists');
        });
    });
    (0, vitest_1.describe)('update()', () => {
        (0, vitest_1.it)('patches specific fields and preserves others', async () => {
            const original = {
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
            (0, vitest_1.expect)(updated.status).toBe('paused');
            (0, vitest_1.expect)(updated.storyTitle).toBe('Updated Title');
            (0, vitest_1.expect)(updated.name).toBe('original-name'); // preserved
            (0, vitest_1.expect)(updated.configRef).toBe('sdlc-default@1.0.0'); // preserved
            (0, vitest_1.expect)(updated.createdAt).toBe('2026-02-01T10:00:00Z'); // preserved
        });
        (0, vitest_1.it)('throws for unknown ID', async () => {
            await (0, vitest_1.expect)(store.update('ws-nonexistent', { status: 'paused' })).rejects.toThrow('not found');
        });
    });
    (0, vitest_1.describe)('delete()', () => {
        (0, vitest_1.it)('removes a record', async () => {
            const record = {
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
            (0, vitest_1.expect)(retrieved).toBeNull();
        });
        (0, vitest_1.it)('throws for unknown ID', async () => {
            await (0, vitest_1.expect)(store.delete('ws-nonexistent')).rejects.toThrow('not found');
        });
    });
    (0, vitest_1.describe)('list()', () => {
        (0, vitest_1.it)('returns all records', async () => {
            const now = new Date().toISOString();
            const records = [
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
            (0, vitest_1.expect)(listed).toHaveLength(2);
        });
        (0, vitest_1.it)('filters by status', async () => {
            const now = new Date().toISOString();
            const records = [
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
            (0, vitest_1.expect)(activeOnly).toHaveLength(1);
            (0, vitest_1.expect)(activeOnly[0].id).toBe('ws-active');
        });
        (0, vitest_1.it)('sorts by lastAccessedAt descending', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
            const records = [
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
            (0, vitest_1.expect)(listed[0].id).toBe('ws-new');
            (0, vitest_1.expect)(listed[1].id).toBe('ws-mid');
            (0, vitest_1.expect)(listed[2].id).toBe('ws-old');
        });
    });
    (0, vitest_1.describe)('findByStoryId()', () => {
        (0, vitest_1.it)('finds workspace by story ID', async () => {
            const record = {
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
            (0, vitest_1.expect)(found).toEqual(record);
        });
        (0, vitest_1.it)('returns null if story ID not found', async () => {
            const found = await store.findByStoryId('nonexistent-story');
            (0, vitest_1.expect)(found).toBeNull();
        });
    });
    (0, vitest_1.describe)('touch()', () => {
        (0, vitest_1.it)('updates lastAccessedAt to now', async () => {
            const oldTime = new Date('2026-01-01T10:00:00Z').toISOString();
            const record = {
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
            (0, vitest_1.expect)(updated).not.toBeNull();
            const accessedTime = new Date(updated.lastAccessedAt);
            (0, vitest_1.expect)(accessedTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            (0, vitest_1.expect)(accessedTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
            (0, vitest_1.expect)(updated.createdAt).toBe(oldTime); // createdAt unchanged
        });
    });
    (0, vitest_1.describe)('checkRetention()', () => {
        (0, vitest_1.it)('returns only active/paused workspaces past retention days', async () => {
            const now = new Date();
            const fiftyDaysAgo = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString();
            const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
            const nowIso = now.toISOString();
            const records = [
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
            (0, vitest_1.expect)(candidates).toHaveLength(2);
            const ids = candidates.map((c) => c.id);
            (0, vitest_1.expect)(ids).toContain('ws-old-active');
            (0, vitest_1.expect)(ids).toContain('ws-old-paused');
            (0, vitest_1.expect)(ids).not.toContain('ws-old-completed');
            (0, vitest_1.expect)(ids).not.toContain('ws-old-archived');
            (0, vitest_1.expect)(ids).not.toContain('ws-recent-active');
        });
        (0, vitest_1.it)('does not return completed/archived workspaces', async () => {
            const fiftyDaysAgo = new Date(new Date().getTime() - 50 * 24 * 60 * 60 * 1000).toISOString();
            const records = [
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
            (0, vitest_1.expect)(candidates).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('generateWorkspaceId()', () => {
        (0, vitest_1.it)('generates ws- prefix with 8 random chars', () => {
            const id = (0, workspace_metadata_store_js_1.generateWorkspaceId)();
            (0, vitest_1.expect)(id).toMatch(/^ws-[a-z0-9]{8}$/);
        });
        (0, vitest_1.it)('generates unique IDs', () => {
            const ids = new Set();
            for (let i = 0; i < 100; i++) {
                ids.add((0, workspace_metadata_store_js_1.generateWorkspaceId)());
            }
            (0, vitest_1.expect)(ids.size).toBe(100);
        });
    });
});
//# sourceMappingURL=workspace-metadata-store.test.js.map