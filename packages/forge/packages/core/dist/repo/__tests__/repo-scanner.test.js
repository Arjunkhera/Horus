"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const repo_scanner_js_1 = require("../repo-scanner.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function initGitRepo(repoPath) {
    await execFileAsync('git', ['init'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
}
async function makeCommit(repoPath) {
    const testFile = path_1.default.join(repoPath, 'test.txt');
    await (0, promises_1.writeFile)(testFile, 'test content');
    await execFileAsync('git', ['add', '.'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'test commit'], { cwd: repoPath });
}
(0, vitest_1.describe)('repo-scanner', () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), 'forge-scanner-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('scan finds git repos one level deep', async () => {
        const repo1 = path_1.default.join(tempDir, 'repo1');
        const repo2 = path_1.default.join(tempDir, 'repo2');
        await (0, promises_1.mkdir)(repo1);
        await (0, promises_1.mkdir)(repo2);
        await initGitRepo(repo1);
        await initGitRepo(repo2);
        await makeCommit(repo1);
        await makeCommit(repo2);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos).toHaveLength(2);
        (0, vitest_1.expect)(result.repos.map(r => r.name).sort()).toEqual(['repo1', 'repo2']);
        (0, vitest_1.expect)(result.scanPaths).toContain(tempDir);
    });
    (0, vitest_1.it)('scan does NOT recurse into subdirectories', async () => {
        const repo1 = path_1.default.join(tempDir, 'repo1');
        const nestedDir = path_1.default.join(tempDir, 'nested-container');
        const nested = path_1.default.join(nestedDir, 'repo2');
        await (0, promises_1.mkdir)(repo1);
        await (0, promises_1.mkdir)(nestedDir);
        await (0, promises_1.mkdir)(nested);
        await initGitRepo(repo1);
        await initGitRepo(nested);
        await makeCommit(repo1);
        await makeCommit(nested);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        // Should only find repo1, not the nested repo2
        (0, vitest_1.expect)(result.repos).toHaveLength(1);
        (0, vitest_1.expect)(result.repos[0].name).toBe('repo1');
    });
    (0, vitest_1.it)('scan handles non-git directories correctly (skips them)', async () => {
        const repo1 = path_1.default.join(tempDir, 'repo1');
        const nonGit = path_1.default.join(tempDir, 'not-a-repo');
        await (0, promises_1.mkdir)(repo1);
        await (0, promises_1.mkdir)(nonGit);
        await initGitRepo(repo1);
        await makeCommit(repo1);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos).toHaveLength(1);
        (0, vitest_1.expect)(result.repos[0].name).toBe('repo1');
    });
    (0, vitest_1.it)('scan handles empty scan path gracefully', async () => {
        const emptyDir = path_1.default.join(tempDir, 'empty');
        await (0, promises_1.mkdir)(emptyDir);
        const result = await (0, repo_scanner_js_1.scan)([emptyDir]);
        (0, vitest_1.expect)(result.repos).toHaveLength(0);
        (0, vitest_1.expect)(result.scanPaths).toContain(emptyDir);
    });
    (0, vitest_1.it)('scan handles missing scan path gracefully (ENOENT)', async () => {
        const missingPath = path_1.default.join(tempDir, 'does-not-exist');
        // Should not throw, should return empty repos
        const result = await (0, repo_scanner_js_1.scan)([missingPath]);
        (0, vitest_1.expect)(result.repos).toHaveLength(0);
        (0, vitest_1.expect)(result.scanPaths).toContain(missingPath);
    });
    (0, vitest_1.it)('indexRepo extracts name and localPath correctly', async () => {
        const repo1 = path_1.default.join(tempDir, 'my-test-repo');
        await (0, promises_1.mkdir)(repo1);
        await initGitRepo(repo1);
        await makeCommit(repo1);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos).toHaveLength(1);
        (0, vitest_1.expect)(result.repos[0].name).toBe('my-test-repo');
        (0, vitest_1.expect)(result.repos[0].localPath).toBe(repo1);
    });
    (0, vitest_1.it)('detects TypeScript language with tsconfig.json', async () => {
        const repo = path_1.default.join(tempDir, 'ts-repo');
        await (0, promises_1.mkdir)(repo);
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'tsconfig.json'), '{}');
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].language).toBe('TypeScript');
    });
    (0, vitest_1.it)('detects JavaScript language with package.json', async () => {
        const repo = path_1.default.join(tempDir, 'js-repo');
        await (0, promises_1.mkdir)(repo);
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'package.json'), '{"name": "test"}');
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].language).toBe('JavaScript');
    });
    (0, vitest_1.it)('detects Python language', async () => {
        const repo = path_1.default.join(tempDir, 'py-repo');
        await (0, promises_1.mkdir)(repo);
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'pyproject.toml'), '');
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].language).toBe('Python');
    });
    (0, vitest_1.it)('detects Rust language', async () => {
        const repo = path_1.default.join(tempDir, 'rust-repo');
        await (0, promises_1.mkdir)(repo);
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'Cargo.toml'), '');
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].language).toBe('Rust');
    });
    (0, vitest_1.it)('detects null language when no marker file found', async () => {
        const repo = path_1.default.join(tempDir, 'unknown-repo');
        await (0, promises_1.mkdir)(repo);
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].language).toBeNull();
    });
    (0, vitest_1.it)('detects framework from package.json dependencies', async () => {
        const repo = path_1.default.join(tempDir, 'express-repo');
        await (0, promises_1.mkdir)(repo);
        const pkgJson = {
            name: 'test',
            dependencies: { express: '^4.0.0' }
        };
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'package.json'), JSON.stringify(pkgJson));
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].framework).toBe('express');
    });
    (0, vitest_1.it)('prefers next framework when both react and next are present', async () => {
        const repo = path_1.default.join(tempDir, 'next-repo');
        await (0, promises_1.mkdir)(repo);
        const pkgJson = {
            name: 'test',
            dependencies: { next: '^13.0.0', react: '^18.0.0' }
        };
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'package.json'), JSON.stringify(pkgJson));
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].framework).toBe('next');
    });
    (0, vitest_1.it)('returns null framework for non-JS/TS repos', async () => {
        const repo = path_1.default.join(tempDir, 'py-repo');
        await (0, promises_1.mkdir)(repo);
        await (0, promises_1.writeFile)(path_1.default.join(repo, 'pyproject.toml'), '');
        await initGitRepo(repo);
        await makeCommit(repo);
        const result = await (0, repo_scanner_js_1.scan)([tempDir]);
        (0, vitest_1.expect)(result.repos[0].framework).toBeNull();
    });
    (0, vitest_1.it)('scan with incremental merge preserves repos from other scan paths', async () => {
        // Create two separate scan directories
        const scanDir1 = path_1.default.join(tempDir, 'scan1');
        const scanDir2 = path_1.default.join(tempDir, 'scan2');
        await (0, promises_1.mkdir)(scanDir1);
        await (0, promises_1.mkdir)(scanDir2);
        // Create repos in each
        const repo1 = path_1.default.join(scanDir1, 'repo1');
        const repo2 = path_1.default.join(scanDir2, 'repo2');
        await (0, promises_1.mkdir)(repo1);
        await (0, promises_1.mkdir)(repo2);
        await initGitRepo(repo1);
        await initGitRepo(repo2);
        await makeCommit(repo1);
        await makeCommit(repo2);
        // First scan both directories
        const firstScan = await (0, repo_scanner_js_1.scan)([scanDir1, scanDir2]);
        (0, vitest_1.expect)(firstScan.repos).toHaveLength(2);
        // Now scan only scanDir1 but provide the existing index
        const secondScan = await (0, repo_scanner_js_1.scan)([scanDir1], firstScan);
        // Should preserve repo2 from scanDir2
        (0, vitest_1.expect)(secondScan.repos).toHaveLength(2);
        (0, vitest_1.expect)(secondScan.repos.map(r => r.name).sort()).toEqual(['repo1', 'repo2']);
    });
    (0, vitest_1.it)('scan replaces entries for repos found in new scan', async () => {
        const repo = path_1.default.join(tempDir, 'repo1');
        await (0, promises_1.mkdir)(repo);
        await initGitRepo(repo);
        await makeCommit(repo);
        // First scan
        const firstScan = await (0, repo_scanner_js_1.scan)([tempDir]);
        const firstScannedAt = firstScan.repos[0].lastScannedAt;
        // Wait a bit and scan again
        await new Promise(resolve => setTimeout(resolve, 10));
        const secondScan = await (0, repo_scanner_js_1.scan)([tempDir], firstScan);
        // Should have same repo but updated lastScannedAt
        (0, vitest_1.expect)(secondScan.repos).toHaveLength(1);
        (0, vitest_1.expect)(secondScan.repos[0].name).toBe('repo1');
        (0, vitest_1.expect)(secondScan.repos[0].lastScannedAt).not.toBe(firstScannedAt);
    });
});
//# sourceMappingURL=repo-scanner.test.js.map