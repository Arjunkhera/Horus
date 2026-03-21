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
const workspace_lifecycle_js_1 = require("../workspace-lifecycle.js");
const workspace_metadata_store_js_1 = require("../workspace-metadata-store.js");
(0, vitest_1.describe)('WorkspaceLifecycleManager', () => {
    let tmpFile;
    let store;
    let manager;
    (0, vitest_1.beforeEach)(async () => {
        tmpFile = path_1.default.join((0, os_1.tmpdir)(), `forge-test-${(0, crypto_1.randomUUID)()}.json`);
        store = new workspace_metadata_store_js_1.WorkspaceMetadataStore().withPath(tmpFile);
        manager = new workspace_lifecycle_js_1.WorkspaceLifecycleManager(undefined, store);
    });
    (0, vitest_1.afterEach)(async () => {
        try {
            await fs_1.promises.unlink(tmpFile);
        }
        catch {
            // File doesn't exist, that's fine
        }
    });
    function createTestRecord(overrides) {
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
    (0, vitest_1.describe)('pause()', () => {
        (0, vitest_1.it)('transitions workspace from active to paused', async () => {
            const record = createTestRecord();
            await store.create(record);
            const result = await manager.pause(record.id);
            (0, vitest_1.expect)(result.status).toBe('paused');
        });
        (0, vitest_1.it)('throws when workspace not found', async () => {
            await (0, vitest_1.expect)(manager.pause('nonexistent')).rejects.toThrow("Workspace 'nonexistent' not found");
        });
        (0, vitest_1.it)('throws on invalid transition from archived', async () => {
            const record = createTestRecord({ status: 'archived' });
            await store.create(record);
            await (0, vitest_1.expect)(manager.pause(record.id)).rejects.toThrow("Cannot transition workspace from 'archived' to 'paused'");
        });
    });
    (0, vitest_1.describe)('complete()', () => {
        (0, vitest_1.it)('transitions workspace to completed and sets completedAt', async () => {
            const record = createTestRecord();
            await store.create(record);
            const beforeTime = new Date();
            const result = await manager.complete(record.id);
            const afterTime = new Date();
            (0, vitest_1.expect)(result.status).toBe('completed');
            (0, vitest_1.expect)(result.completedAt).toBeTruthy();
            const completedDate = new Date(result.completedAt);
            (0, vitest_1.expect)(completedDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            (0, vitest_1.expect)(completedDate.getTime()).toBeLessThanOrEqual(afterTime.getTime());
        });
        (0, vitest_1.it)('can complete from both active and paused', async () => {
            const activeRecord = createTestRecord({ status: 'active' });
            await store.create(activeRecord);
            const result1 = await manager.complete(activeRecord.id);
            (0, vitest_1.expect)(result1.status).toBe('completed');
            const pausedRecord = createTestRecord({ id: 'ws-paused', status: 'paused' });
            await store.create(pausedRecord);
            const result2 = await manager.complete(pausedRecord.id);
            (0, vitest_1.expect)(result2.status).toBe('completed');
        });
    });
    (0, vitest_1.describe)('archive()', () => {
        (0, vitest_1.it)('transitions workspace to archived from completed', async () => {
            const record = createTestRecord({ status: 'completed' });
            await store.create(record);
            const result = await manager.archive(record.id);
            (0, vitest_1.expect)(result.status).toBe('archived');
        });
        (0, vitest_1.it)('can archive from active', async () => {
            const record = createTestRecord({ status: 'active' });
            await store.create(record);
            const result = await manager.archive(record.id);
            (0, vitest_1.expect)(result.status).toBe('archived');
        });
        (0, vitest_1.it)('throws on invalid transition: archived -> archived', async () => {
            const record = createTestRecord({ status: 'archived' });
            await store.create(record);
            await (0, vitest_1.expect)(manager.archive(record.id)).rejects.toThrow("Cannot transition workspace from 'archived' to 'archived'");
        });
    });
    (0, vitest_1.describe)('touch()', () => {
        (0, vitest_1.it)('updates lastAccessedAt', async () => {
            const record = createTestRecord();
            const oldTime = new Date(Date.now() - 1000000);
            record.lastAccessedAt = oldTime.toISOString();
            await store.create(record);
            const beforeTime = new Date();
            await manager.touch(record.id);
            const afterTime = new Date();
            const updated = await store.get(record.id);
            const accessedDate = new Date(updated.lastAccessedAt);
            (0, vitest_1.expect)(accessedDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            (0, vitest_1.expect)(accessedDate.getTime()).toBeLessThanOrEqual(afterTime.getTime());
        });
    });
    (0, vitest_1.describe)('delete()', () => {
        (0, vitest_1.it)('removes workspace record from store', async () => {
            const record = createTestRecord();
            await store.create(record);
            await manager.delete(record.id, { force: true });
            const retrieved = await store.get(record.id);
            (0, vitest_1.expect)(retrieved).toBeNull();
        });
        (0, vitest_1.it)('throws when workspace not found', async () => {
            await (0, vitest_1.expect)(manager.delete('nonexistent', { force: true })).rejects.toThrow("Workspace 'nonexistent' not found");
        });
        (0, vitest_1.it)('removes workspace folder from disk', async () => {
            const tmpDir = path_1.default.join((0, os_1.tmpdir)(), `ws-${(0, crypto_1.randomUUID)()}`);
            await fs_1.promises.mkdir(tmpDir, { recursive: true });
            const record = createTestRecord({ path: tmpDir });
            await store.create(record);
            // Verify folder exists
            const stat = await fs_1.promises.stat(tmpDir);
            (0, vitest_1.expect)(stat.isDirectory()).toBe(true);
            await manager.delete(record.id, { force: true });
            // Folder should be removed
            try {
                await fs_1.promises.stat(tmpDir);
                vitest_1.expect.fail('Folder should have been deleted');
            }
            catch (err) {
                (0, vitest_1.expect)(err.code).toBe('ENOENT');
            }
        });
    });
    (0, vitest_1.describe)('getRetentionCandidates()', () => {
        (0, vitest_1.it)('returns workspaces older than retention period', async () => {
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
            (0, vitest_1.expect)(candidates).toHaveLength(1);
            (0, vitest_1.expect)(candidates[0].id).toBe('ws-old');
        });
        (0, vitest_1.it)('ignores completed workspaces', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 40);
            const record = createTestRecord({
                id: 'ws-completed-old',
                lastAccessedAt: oldDate.toISOString(),
                status: 'completed',
            });
            await store.create(record);
            const candidates = await manager.getRetentionCandidates(30);
            (0, vitest_1.expect)(candidates).toHaveLength(0);
        });
        (0, vitest_1.it)('ignores archived workspaces', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 40);
            const record = createTestRecord({
                id: 'ws-archived-old',
                lastAccessedAt: oldDate.toISOString(),
                status: 'archived',
            });
            await store.create(record);
            const candidates = await manager.getRetentionCandidates(30);
            (0, vitest_1.expect)(candidates).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('clean()', () => {
        (0, vitest_1.it)('dry-run returns candidates without deleting', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 40);
            const record = createTestRecord({
                id: 'ws-old',
                lastAccessedAt: oldDate.toISOString(),
                status: 'active',
            });
            await store.create(record);
            const result = await manager.clean(30, { dryRun: true });
            (0, vitest_1.expect)(result.cleaned).toContain('ws-old');
            (0, vitest_1.expect)(result.skipped).toHaveLength(0);
            // Record should still exist
            const still = await store.get('ws-old');
            (0, vitest_1.expect)(still).toBeTruthy();
        });
        (0, vitest_1.it)('deletes candidates when not dry-run', async () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 40);
            const tmpDir = path_1.default.join((0, os_1.tmpdir)(), `ws-${(0, crypto_1.randomUUID)()}`);
            await fs_1.promises.mkdir(tmpDir, { recursive: true });
            const record = createTestRecord({
                id: 'ws-old',
                path: tmpDir,
                lastAccessedAt: oldDate.toISOString(),
                status: 'active',
            });
            await store.create(record);
            const result = await manager.clean(30, { dryRun: false });
            (0, vitest_1.expect)(result.cleaned).toContain('ws-old');
            // Record should be gone
            const gone = await store.get('ws-old');
            (0, vitest_1.expect)(gone).toBeNull();
        });
        (0, vitest_1.it)('handles empty candidate list', async () => {
            const result = await manager.clean(30);
            (0, vitest_1.expect)(result.cleaned).toHaveLength(0);
            (0, vitest_1.expect)(result.skipped).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('State machine validation', () => {
        (0, vitest_1.it)('allows active -> paused and paused can transition', async () => {
            const record = createTestRecord({ status: 'active' });
            await store.create(record);
            const paused = await manager.pause(record.id);
            (0, vitest_1.expect)(paused.status).toBe('paused');
            // From paused, we can complete or archive
            const completed = await manager.complete(paused.id);
            (0, vitest_1.expect)(completed.status).toBe('completed');
        });
        (0, vitest_1.it)('allows active -> completed -> archived', async () => {
            const record = createTestRecord({ status: 'active' });
            await store.create(record);
            const completed = await manager.complete(record.id);
            (0, vitest_1.expect)(completed.status).toBe('completed');
            const archived = await manager.archive(completed.id);
            (0, vitest_1.expect)(archived.status).toBe('archived');
        });
        (0, vitest_1.it)('terminal state: archived rejects all transitions', async () => {
            const record = createTestRecord({ status: 'archived' });
            await store.create(record);
            await (0, vitest_1.expect)(manager.pause(record.id)).rejects.toThrow();
            await (0, vitest_1.expect)(manager.complete(record.id)).rejects.toThrow();
            await (0, vitest_1.expect)(manager.archive(record.id)).rejects.toThrow();
        });
    });
});
//# sourceMappingURL=workspace-lifecycle.test.js.map