"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const workspace_manager_js_1 = require("../workspace-manager.js");
const errors_js_1 = require("../../adapters/errors.js");
(0, vitest_1.describe)('WorkspaceManager', () => {
    let tmpDir;
    let wm;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-wm-test-'));
        wm = new workspace_manager_js_1.WorkspaceManager(tmpDir);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('scaffoldWorkspace()', () => {
        (0, vitest_1.it)('creates forge.yaml and forge.lock', async () => {
            await wm.scaffoldWorkspace('test-workspace');
            const configExists = await fs_1.promises
                .access(path_1.default.join(tmpDir, 'forge.yaml'))
                .then(() => true)
                .catch(() => false);
            const lockExists = await fs_1.promises
                .access(path_1.default.join(tmpDir, 'forge.lock'))
                .then(() => true)
                .catch(() => false);
            (0, vitest_1.expect)(configExists).toBe(true);
            (0, vitest_1.expect)(lockExists).toBe(true);
        });
        (0, vitest_1.it)('throws if forge.yaml already exists', async () => {
            await wm.scaffoldWorkspace('first');
            await (0, vitest_1.expect)(wm.scaffoldWorkspace('second')).rejects.toThrow(errors_js_1.ForgeError);
        });
    });
    (0, vitest_1.describe)('readConfig() / writeConfig()', () => {
        (0, vitest_1.it)('round-trips forge.yaml correctly', async () => {
            await wm.scaffoldWorkspace('my-workspace');
            const config = await wm.readConfig();
            (0, vitest_1.expect)(config.name).toBe('my-workspace');
            config.name = 'updated';
            await wm.writeConfig(config);
            const re = await wm.readConfig();
            (0, vitest_1.expect)(re.name).toBe('updated');
        });
        (0, vitest_1.it)('throws CONFIG_NOT_FOUND if forge.yaml missing', async () => {
            try {
                await wm.readConfig();
                vitest_1.expect.fail('should have thrown');
            }
            catch (err) {
                (0, vitest_1.expect)(err).toBeInstanceOf(errors_js_1.ForgeError);
                (0, vitest_1.expect)(err.code).toBe('CONFIG_NOT_FOUND');
            }
        });
    });
    (0, vitest_1.describe)('readLock() / writeLock()', () => {
        (0, vitest_1.it)('returns empty lock if forge.lock missing', async () => {
            const lock = await wm.readLock();
            (0, vitest_1.expect)(lock.version).toBe('1');
            (0, vitest_1.expect)(lock.artifacts).toEqual({});
        });
        (0, vitest_1.it)('round-trips forge.lock correctly', async () => {
            const lock = await wm.readLock();
            await wm.writeLock(lock);
            const re = await wm.readLock();
            (0, vitest_1.expect)(re.version).toBe('1');
        });
    });
    (0, vitest_1.describe)('computeSha256()', () => {
        (0, vitest_1.it)('produces a 64-char hex string', () => {
            const hash = wm.computeSha256('hello world');
            (0, vitest_1.expect)(hash).toMatch(/^[a-f0-9]{64}$/);
        });
        (0, vitest_1.it)('produces consistent output', () => {
            (0, vitest_1.expect)(wm.computeSha256('test')).toBe(wm.computeSha256('test'));
        });
    });
    (0, vitest_1.describe)('mergeFiles()', () => {
        (0, vitest_1.it)('writes new files directly', async () => {
            const lock = await wm.readLock();
            const ops = [
                {
                    path: '.claude/skills/dev/SKILL.md',
                    content: '# Dev',
                    sourceRef: { type: 'skill', id: 'dev', version: '1.0.0' },
                    operation: 'create',
                },
            ];
            const report = await wm.mergeFiles(ops, lock, 'skip');
            (0, vitest_1.expect)(report.written).toContain('.claude/skills/dev/SKILL.md');
        });
        (0, vitest_1.it)('overwrites Forge-owned files', async () => {
            // Create a file and add it to lock
            const filePath = '.claude/skills/dev/SKILL.md';
            const absPath = path_1.default.join(tmpDir, filePath);
            await fs_1.promises.mkdir(path_1.default.dirname(absPath), { recursive: true });
            await fs_1.promises.writeFile(absPath, 'old content');
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
                    sourceRef: { type: 'skill', id: 'dev', version: '1.0.0' },
                    operation: 'update',
                },
            ];
            const report = await wm.mergeFiles(ops, lock, 'skip');
            (0, vitest_1.expect)(report.written).toContain(filePath);
            const written = await fs_1.promises.readFile(absPath, 'utf-8');
            (0, vitest_1.expect)(written).toBe('new content');
        });
        (0, vitest_1.it)('skips conflicting user-owned files with skip strategy', async () => {
            const filePath = 'user-file.md';
            await fs_1.promises.writeFile(path_1.default.join(tmpDir, filePath), 'user content');
            const lock = await wm.readLock();
            const ops = [
                {
                    path: filePath,
                    content: 'forge content',
                    sourceRef: { type: 'skill', id: 'x', version: '1.0.0' },
                    operation: 'update',
                },
            ];
            const report = await wm.mergeFiles(ops, lock, 'skip');
            (0, vitest_1.expect)(report.skipped).toContain(filePath);
        });
        (0, vitest_1.it)('backs up conflicting files with backup strategy', async () => {
            const filePath = 'some-file.md';
            await fs_1.promises.writeFile(path_1.default.join(tmpDir, filePath), 'user content');
            const lock = await wm.readLock();
            const ops = [
                {
                    path: filePath,
                    content: 'forge content',
                    sourceRef: { type: 'skill', id: 'x', version: '1.0.0' },
                    operation: 'update',
                },
            ];
            const report = await wm.mergeFiles(ops, lock, 'backup');
            (0, vitest_1.expect)(report.backed_up).toContain(filePath + '.bak');
            (0, vitest_1.expect)(report.written).toContain(filePath);
        });
        (0, vitest_1.it)('overwrites with overwrite strategy', async () => {
            const filePath = 'conflict-file.md';
            await fs_1.promises.writeFile(path_1.default.join(tmpDir, filePath), 'user content');
            const lock = await wm.readLock();
            const ops = [
                {
                    path: filePath,
                    content: 'forge content',
                    sourceRef: { type: 'skill', id: 'x', version: '1.0.0' },
                    operation: 'update',
                },
            ];
            const report = await wm.mergeFiles(ops, lock, 'overwrite');
            (0, vitest_1.expect)(report.written).toContain(filePath);
            (0, vitest_1.expect)(report.backed_up).toEqual([]);
            const written = await fs_1.promises.readFile(path_1.default.join(tmpDir, filePath), 'utf-8');
            (0, vitest_1.expect)(written).toBe('forge content');
        });
        (0, vitest_1.it)('treats prompt strategy as skip', async () => {
            const filePath = 'prompt-file.md';
            await fs_1.promises.writeFile(path_1.default.join(tmpDir, filePath), 'user content');
            const lock = await wm.readLock();
            const ops = [
                {
                    path: filePath,
                    content: 'forge content',
                    sourceRef: { type: 'skill', id: 'x', version: '1.0.0' },
                    operation: 'update',
                },
            ];
            const report = await wm.mergeFiles(ops, lock, 'prompt');
            (0, vitest_1.expect)(report.skipped).toContain(filePath);
        });
    });
    (0, vitest_1.describe)('cleanUntracked()', () => {
        (0, vitest_1.it)('removes files no longer in the install set', async () => {
            const filePath1 = '.claude/skills/old/SKILL.md';
            const filePath2 = '.claude/skills/new/SKILL.md';
            const absPath1 = path_1.default.join(tmpDir, filePath1);
            const absPath2 = path_1.default.join(tmpDir, filePath2);
            // Create both files
            await fs_1.promises.mkdir(path_1.default.dirname(absPath1), { recursive: true });
            await fs_1.promises.mkdir(path_1.default.dirname(absPath2), { recursive: true });
            await fs_1.promises.writeFile(absPath1, 'old');
            await fs_1.promises.writeFile(absPath2, 'new');
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
            (0, vitest_1.expect)(removed).toContain(filePath1);
            (0, vitest_1.expect)(removed).not.toContain(filePath2);
            const exists1 = await fs_1.promises.access(absPath1).then(() => true).catch(() => false);
            const exists2 = await fs_1.promises.access(absPath2).then(() => true).catch(() => false);
            (0, vitest_1.expect)(exists1).toBe(false);
            (0, vitest_1.expect)(exists2).toBe(true);
        });
    });
});
//# sourceMappingURL=workspace-manager.test.js.map