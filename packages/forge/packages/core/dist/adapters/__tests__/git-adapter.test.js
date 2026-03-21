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
const yaml_1 = require("yaml");
const git_adapter_js_1 = require("../git-adapter.js");
const errors_js_1 = require("../errors.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Helpers — create a local bare git repo as a fixture
// ---------------------------------------------------------------------------
async function git(args, cwd) {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout;
}
/**
 * Creates a local bare git repo with a registry layout:
 *   registry/skills/{id}/metadata.yaml + SKILL.md
 *
 * Returns the path to the bare repo (usable as a clone URL).
 */
async function createBareRepoFixture(tmpDir, skills) {
    const workDir = path_1.default.join(tmpDir, 'work');
    const bareDir = path_1.default.join(tmpDir, 'bare.git');
    // Create bare repo
    await fs_1.promises.mkdir(bareDir, { recursive: true });
    await git(['init', '--bare'], bareDir);
    // Create working repo, add content, push to bare
    await fs_1.promises.mkdir(workDir, { recursive: true });
    await git(['init'], workDir);
    await git(['remote', 'add', 'origin', bareDir], workDir);
    await git(['config', 'user.email', 'test@test.com'], workDir);
    await git(['config', 'user.name', 'Test'], workDir);
    // Create registry directory with skills
    for (const skill of skills) {
        const skillDir = path_1.default.join(workDir, 'registry', 'skills', skill.id);
        await fs_1.promises.mkdir(skillDir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(skillDir, 'metadata.yaml'), (0, yaml_1.stringify)({
            id: skill.id,
            name: skill.name,
            version: skill.version,
            description: skill.description,
            type: 'skill',
            tags: [],
            dependencies: {},
            files: [],
        }));
        await fs_1.promises.writeFile(path_1.default.join(skillDir, 'SKILL.md'), `# ${skill.name}\n\n${skill.description}`);
    }
    await git(['add', '.'], workDir);
    await git(['commit', '-m', 'Initial registry'], workDir);
    await git(['push', 'origin', 'HEAD:main'], workDir);
    return bareDir;
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('GitAdapter', () => {
    let tmpDir;
    let cacheDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-git-test-'));
        cacheDir = path_1.default.join(tmpDir, 'cache');
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('clone and list', () => {
        (0, vitest_1.it)('clones repo and lists skills via FilesystemAdapter', async () => {
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'developer', name: 'Developer', version: '1.0.0', description: 'Dev skill' },
                { id: 'tester', name: 'Tester', version: '1.0.0', description: 'Test skill' },
            ]);
            const adapter = new git_adapter_js_1.GitAdapter({
                url: bareRepo,
                ref: 'main',
                cacheDir,
            });
            const skills = await adapter.list('skill');
            const ids = skills.map((s) => s.id).sort();
            (0, vitest_1.expect)(ids).toEqual(['developer', 'tester']);
        });
        (0, vitest_1.it)('reads a specific skill after cloning', async () => {
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'developer', name: 'Developer Skill', version: '2.0.0', description: 'Implements stories' },
            ]);
            const adapter = new git_adapter_js_1.GitAdapter({
                url: bareRepo,
                ref: 'main',
                cacheDir,
            });
            const bundle = await adapter.read('skill', 'developer');
            (0, vitest_1.expect)(bundle.meta.id).toBe('developer');
            (0, vitest_1.expect)(bundle.meta.version).toBe('2.0.0');
            (0, vitest_1.expect)(bundle.content).toContain('Developer Skill');
        });
        (0, vitest_1.it)('exists() returns true for existing artifact', async () => {
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'developer', name: 'Developer', version: '1.0.0', description: 'Dev skill' },
            ]);
            const adapter = new git_adapter_js_1.GitAdapter({ url: bareRepo, ref: 'main', cacheDir });
            (0, vitest_1.expect)(await adapter.exists('skill', 'developer')).toBe(true);
            (0, vitest_1.expect)(await adapter.exists('skill', 'nonexistent')).toBe(false);
        });
    });
    (0, vitest_1.describe)('fetch and update', () => {
        (0, vitest_1.it)('fetches updates on subsequent access', async () => {
            const workDir = path_1.default.join(tmpDir, 'work');
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'original', name: 'Original', version: '1.0.0', description: 'First skill' },
            ]);
            // First access — clone
            const adapter = new git_adapter_js_1.GitAdapter({ url: bareRepo, ref: 'main', cacheDir });
            let skills = await adapter.list('skill');
            (0, vitest_1.expect)(skills.map((s) => s.id)).toEqual(['original']);
            // Add a new skill to the repo
            const newSkillDir = path_1.default.join(workDir, 'registry', 'skills', 'added');
            await fs_1.promises.mkdir(newSkillDir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(newSkillDir, 'metadata.yaml'), (0, yaml_1.stringify)({
                id: 'added',
                name: 'Added Skill',
                version: '1.0.0',
                description: 'Added after clone',
                type: 'skill',
                tags: [],
                dependencies: {},
                files: [],
            }));
            await fs_1.promises.writeFile(path_1.default.join(newSkillDir, 'SKILL.md'), '# Added');
            await git(['add', '.'], workDir);
            await git(['commit', '-m', 'Add new skill'], workDir);
            await git(['push', 'origin', 'HEAD:main'], workDir);
            // Create a new adapter instance (simulates next run) to force fetch
            const adapter2 = new git_adapter_js_1.GitAdapter({ url: bareRepo, ref: 'main', cacheDir });
            skills = await adapter2.list('skill');
            const ids = skills.map((s) => s.id).sort();
            (0, vitest_1.expect)(ids).toEqual(['added', 'original']);
        });
    });
    (0, vitest_1.describe)('cache directory', () => {
        (0, vitest_1.it)('uses hashed cache directory under configured cacheDir', () => {
            const adapter = new git_adapter_js_1.GitAdapter({
                url: 'https://github.com/example/registry.git',
                cacheDir,
            });
            const dir = adapter.getCacheDir();
            (0, vitest_1.expect)(dir.startsWith(cacheDir)).toBe(true);
            // Should be a hash-based directory name
            (0, vitest_1.expect)(path_1.default.basename(dir)).toMatch(/^[a-f0-9]+$/);
        });
        (0, vitest_1.it)('produces different cache dirs for different URLs', () => {
            const a1 = new git_adapter_js_1.GitAdapter({ url: 'https://github.com/org/repo-a.git', cacheDir });
            const a2 = new git_adapter_js_1.GitAdapter({ url: 'https://github.com/org/repo-b.git', cacheDir });
            (0, vitest_1.expect)(a1.getCacheDir()).not.toBe(a2.getCacheDir());
        });
    });
    (0, vitest_1.describe)('ref support', () => {
        (0, vitest_1.it)('defaults to main branch', async () => {
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'dev', name: 'Dev', version: '1.0.0', description: 'Test' },
            ]);
            // No ref specified — should default to 'main'
            const adapter = new git_adapter_js_1.GitAdapter({ url: bareRepo, cacheDir });
            const skills = await adapter.list('skill');
            (0, vitest_1.expect)(skills).toHaveLength(1);
        });
        (0, vitest_1.it)('supports custom branch ref', async () => {
            const workDir = path_1.default.join(tmpDir, 'work');
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'main-skill', name: 'Main Skill', version: '1.0.0', description: 'On main' },
            ]);
            // Create a 'develop' branch with a different skill
            await git(['checkout', '-b', 'develop'], workDir);
            const devSkillDir = path_1.default.join(workDir, 'registry', 'skills', 'dev-only');
            await fs_1.promises.mkdir(devSkillDir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(devSkillDir, 'metadata.yaml'), (0, yaml_1.stringify)({
                id: 'dev-only',
                name: 'Dev Only',
                version: '1.0.0',
                description: 'Only on develop',
                type: 'skill',
                tags: [],
                dependencies: {},
                files: [],
            }));
            await fs_1.promises.writeFile(path_1.default.join(devSkillDir, 'SKILL.md'), '# Dev Only');
            await git(['add', '.'], workDir);
            await git(['commit', '-m', 'Add dev-only skill'], workDir);
            await git(['push', 'origin', 'HEAD:develop'], workDir);
            // Clone from develop branch
            const adapter = new git_adapter_js_1.GitAdapter({
                url: bareRepo,
                ref: 'develop',
                cacheDir: path_1.default.join(cacheDir, 'develop'), // separate cache
            });
            const skills = await adapter.list('skill');
            const ids = skills.map((s) => s.id).sort();
            (0, vitest_1.expect)(ids).toContain('dev-only');
            (0, vitest_1.expect)(ids).toContain('main-skill');
        });
    });
    (0, vitest_1.describe)('error handling', () => {
        (0, vitest_1.it)('throws AdapterError on clone failure', async () => {
            const adapter = new git_adapter_js_1.GitAdapter({
                url: '/nonexistent/repo.git',
                cacheDir,
            });
            await (0, vitest_1.expect)(adapter.list('skill')).rejects.toThrow(errors_js_1.AdapterError);
        });
        (0, vitest_1.it)('AdapterError includes helpful message', async () => {
            const adapter = new git_adapter_js_1.GitAdapter({
                url: '/nonexistent/repo.git',
                cacheDir,
            });
            try {
                await adapter.list('skill');
                vitest_1.expect.fail('Should have thrown');
            }
            catch (err) {
                (0, vitest_1.expect)(err.message).toContain('Clone failed');
                (0, vitest_1.expect)(err.message).toContain('/nonexistent/repo.git');
            }
        });
    });
    (0, vitest_1.describe)('tokenEnv auth', () => {
        (0, vitest_1.it)('falls back gracefully when token env is not set', async () => {
            const bareRepo = await createBareRepoFixture(tmpDir, [
                { id: 'dev', name: 'Dev', version: '1.0.0', description: 'Test' },
            ]);
            // tokenEnv points to non-existent var — should warn and use URL as-is
            const adapter = new git_adapter_js_1.GitAdapter({
                url: bareRepo,
                tokenEnv: 'FORGE_NONEXISTENT_TOKEN_VAR',
                cacheDir,
            });
            // Should still work since bareRepo is local
            const skills = await adapter.list('skill');
            (0, vitest_1.expect)(skills).toHaveLength(1);
        });
    });
});
//# sourceMappingURL=git-adapter.test.js.map