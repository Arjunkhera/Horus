"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const repo_clone_js_1 = require("../repo-clone.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function git(args, cwd) {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
}
/**
 * Create a local source git repo initialised on `defaultBranch` with one commit.
 */
async function createSourceRepo(tmpDir, defaultBranch) {
    const srcDir = path_1.default.join(tmpDir, 'source');
    await fs_1.promises.mkdir(srcDir, { recursive: true });
    await git(['init', '-b', defaultBranch], srcDir);
    await git(['config', 'user.email', 'test@test.com'], srcDir);
    await git(['config', 'user.name', 'Test'], srcDir);
    await fs_1.promises.writeFile(path_1.default.join(srcDir, 'README.md'), '# test');
    await git(['add', '.'], srcDir);
    await git(['commit', '-m', 'init'], srcDir);
    return srcDir;
}
(0, vitest_1.describe)('createReferenceClone', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-clone-test-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('stale defaultBranch in index (the bug)', () => {
        (0, vitest_1.it)('succeeds when index says master but actual default branch is main', async () => {
            const srcDir = await createSourceRepo(tmpDir, 'main');
            const destDir = path_1.default.join(tmpDir, 'clone');
            const result = await (0, repo_clone_js_1.createReferenceClone)({
                localPath: srcDir,
                remoteUrl: null,
                destPath: destDir,
                branchName: 'feature/my-fix',
                defaultBranch: 'master', // stale — actual is main
            });
            (0, vitest_1.expect)(result.actualDefaultBranch).toBe('main');
            const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], destDir);
            (0, vitest_1.expect)(currentBranch).toBe('feature/my-fix');
        });
        (0, vitest_1.it)('succeeds when index says main but actual default branch is master', async () => {
            const srcDir = await createSourceRepo(tmpDir, 'master');
            const destDir = path_1.default.join(tmpDir, 'clone');
            const result = await (0, repo_clone_js_1.createReferenceClone)({
                localPath: srcDir,
                remoteUrl: null,
                destPath: destDir,
                branchName: 'feature/my-fix',
                defaultBranch: 'main', // stale — actual is master
            });
            (0, vitest_1.expect)(result.actualDefaultBranch).toBe('master');
            const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], destDir);
            (0, vitest_1.expect)(currentBranch).toBe('feature/my-fix');
        });
        (0, vitest_1.it)('returns correct actualDefaultBranch when index value is already correct', async () => {
            const srcDir = await createSourceRepo(tmpDir, 'main');
            const destDir = path_1.default.join(tmpDir, 'clone');
            const result = await (0, repo_clone_js_1.createReferenceClone)({
                localPath: srcDir,
                remoteUrl: null,
                destPath: destDir,
                branchName: 'feature/my-fix',
                defaultBranch: 'main', // correct
            });
            (0, vitest_1.expect)(result.actualDefaultBranch).toBe('main');
        });
    });
    (0, vitest_1.describe)('no branchName (stay on default)', () => {
        (0, vitest_1.it)('stays on detected default branch and returns it', async () => {
            const srcDir = await createSourceRepo(tmpDir, 'main');
            const destDir = path_1.default.join(tmpDir, 'clone');
            const result = await (0, repo_clone_js_1.createReferenceClone)({
                localPath: srcDir,
                remoteUrl: null,
                destPath: destDir,
                defaultBranch: 'master', // stale
            });
            (0, vitest_1.expect)(result.actualDefaultBranch).toBe('main');
            const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], destDir);
            (0, vitest_1.expect)(currentBranch).toBe('main');
        });
    });
    (0, vitest_1.describe)('cleanup on failure', () => {
        (0, vitest_1.it)('removes the clone directory when branch creation fails', async () => {
            // Create a source repo with an invalid state by making the dest exist but be empty,
            // then use an unreachable localPath to force a git clone failure.
            const destDir = path_1.default.join(tmpDir, 'clone');
            await (0, vitest_1.expect)((0, repo_clone_js_1.createReferenceClone)({
                localPath: '/nonexistent/path/to/repo',
                remoteUrl: null,
                destPath: destDir,
                branchName: 'feature/my-fix',
                defaultBranch: 'main',
            })).rejects.toThrow(repo_clone_js_1.RepoCloneError);
            // Destination should not exist (cleaned up)
            const exists = await fs_1.promises.access(destDir).then(() => true).catch(() => false);
            (0, vitest_1.expect)(exists).toBe(false);
        });
    });
});
//# sourceMappingURL=repo-clone.test.js.map