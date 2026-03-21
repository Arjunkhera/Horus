"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const repo_index_store_js_1 = require("../repo-index-store.js");
(0, vitest_1.describe)('repo-index-store', () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), 'forge-store-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('saveRepoIndex writes valid JSON', async () => {
        const indexPath = path_1.default.join(tempDir, 'repos.json');
        const index = {
            version: '1',
            scannedAt: '2026-03-01T00:00:00Z',
            scanPaths: ['/home/user/repos'],
            repos: [
                {
                    name: 'test-repo',
                    localPath: '/home/user/repos/test-repo',
                    remoteUrl: 'https://github.com/user/test-repo.git',
                    defaultBranch: 'main',
                    language: 'TypeScript',
                    framework: 'express',
                    lastCommitDate: '2026-02-28T12:00:00Z',
                    lastScannedAt: '2026-03-01T00:00:00Z',
                },
            ],
        };
        await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
        // Verify file exists and contains valid JSON
        const fs = await import('fs/promises');
        const content = await fs.readFile(indexPath, 'utf-8');
        const parsed = JSON.parse(content);
        (0, vitest_1.expect)(parsed).toEqual(index);
    });
    (0, vitest_1.it)('loadRepoIndex reads it back correctly (round-trip)', async () => {
        const indexPath = path_1.default.join(tempDir, 'repos.json');
        const index = {
            version: '1',
            scannedAt: '2026-03-01T00:00:00Z',
            scanPaths: ['/home/user/repos'],
            repos: [
                {
                    name: 'test-repo',
                    localPath: '/home/user/repos/test-repo',
                    remoteUrl: 'https://github.com/user/test-repo.git',
                    defaultBranch: 'main',
                    language: 'JavaScript',
                    framework: 'react',
                    lastCommitDate: '2026-02-28T12:00:00Z',
                    lastScannedAt: '2026-03-01T00:00:00Z',
                },
            ],
        };
        await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
        const loaded = await (0, repo_index_store_js_1.loadRepoIndex)(indexPath);
        (0, vitest_1.expect)(loaded).toEqual(index);
    });
    (0, vitest_1.it)('loadRepoIndex returns null for missing file', async () => {
        const indexPath = path_1.default.join(tempDir, 'nonexistent.json');
        const loaded = await (0, repo_index_store_js_1.loadRepoIndex)(indexPath);
        (0, vitest_1.expect)(loaded).toBeNull();
    });
    (0, vitest_1.it)('loadRepoIndex returns null and warns for malformed file', async () => {
        const indexPath = path_1.default.join(tempDir, 'repos.json');
        const fs = await import('fs/promises');
        // Write invalid JSON
        await fs.writeFile(indexPath, 'not valid json {]');
        const consoleSpy = console.warn;
        let warned = false;
        console.warn = () => { warned = true; };
        try {
            const loaded = await (0, repo_index_store_js_1.loadRepoIndex)(indexPath);
            (0, vitest_1.expect)(loaded).toBeNull();
            (0, vitest_1.expect)(warned).toBe(true);
        }
        finally {
            console.warn = consoleSpy;
        }
    });
    (0, vitest_1.it)('creates directory if it does not exist', async () => {
        const indexPath = path_1.default.join(tempDir, 'subdir', 'nested', 'repos.json');
        const index = {
            version: '1',
            scannedAt: '2026-03-01T00:00:00Z',
            scanPaths: [],
            repos: [],
        };
        await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
        const fs = await import('fs/promises');
        const stat = await fs.stat(indexPath);
        (0, vitest_1.expect)(stat.isFile()).toBe(true);
    });
    (0, vitest_1.it)('handles multiple repos in index', async () => {
        const indexPath = path_1.default.join(tempDir, 'repos.json');
        const index = {
            version: '1',
            scannedAt: '2026-03-01T00:00:00Z',
            scanPaths: ['/home/user/repos'],
            repos: [
                {
                    name: 'repo1',
                    localPath: '/home/user/repos/repo1',
                    remoteUrl: null,
                    defaultBranch: 'main',
                    language: 'Python',
                    framework: null,
                    lastCommitDate: '2026-02-28T12:00:00Z',
                    lastScannedAt: '2026-03-01T00:00:00Z',
                },
                {
                    name: 'repo2',
                    localPath: '/home/user/repos/repo2',
                    remoteUrl: 'https://github.com/user/repo2.git',
                    defaultBranch: 'develop',
                    language: 'Rust',
                    framework: null,
                    lastCommitDate: '2026-02-27T10:00:00Z',
                    lastScannedAt: '2026-03-01T00:00:00Z',
                },
            ],
        };
        await (0, repo_index_store_js_1.saveRepoIndex)(index, indexPath);
        const loaded = await (0, repo_index_store_js_1.loadRepoIndex)(indexPath);
        (0, vitest_1.expect)(loaded?.repos).toHaveLength(2);
        (0, vitest_1.expect)(loaded?.repos[0].name).toBe('repo1');
        (0, vitest_1.expect)(loaded?.repos[1].name).toBe('repo2');
    });
});
//# sourceMappingURL=repo-index-store.test.js.map