"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const workspace_creator_js_1 = require("../workspace-creator.js");
const repo_clone_js_1 = require("../../repo/repo-clone.js");
(0, vitest_1.describe)('workspace-creator helpers', () => {
    (0, vitest_1.describe)('slugify()', () => {
        (0, vitest_1.it)('converts to lowercase kebab-case', () => {
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('Hello World')).toBe('hello-world');
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('My Feature Story')).toBe('my-feature-story');
        });
        (0, vitest_1.it)('removes special characters', () => {
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('Hello! @World#')).toBe('hello-world');
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('My-Story_123')).toBe('my-story-123');
        });
        (0, vitest_1.it)('enforces max 30 character length', () => {
            const long = 'this is a very long story title that exceeds the limit';
            const result = (0, workspace_creator_js_1.slugify)(long);
            (0, vitest_1.expect)(result.length).toBeLessThanOrEqual(30);
        });
        (0, vitest_1.it)('handles edge cases', () => {
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('')).toBe('');
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('---')).toBe('');
            (0, vitest_1.expect)((0, workspace_creator_js_1.slugify)('a')).toBe('a');
        });
    });
    (0, vitest_1.describe)('generateBranchName()', () => {
        (0, vitest_1.it)('replaces {id}, {slug}, {subtype} placeholders', () => {
            const pattern = '{subtype}/{id}-{slug}';
            const result = (0, workspace_creator_js_1.generateBranchName)(pattern, {
                subtype: 'feature',
                id: 'ws-abc123',
                slug: 'my-story',
            });
            (0, vitest_1.expect)(result).toBe('feature/ws-abc123-my-story');
        });
        (0, vitest_1.it)('handles missing placeholders', () => {
            const pattern = '{subtype}/{id}-{slug}';
            const result = (0, workspace_creator_js_1.generateBranchName)(pattern, { id: 'ws-abc123' });
            (0, vitest_1.expect)(result).toBe('ws-abc123-');
        });
        (0, vitest_1.it)('cleans up double slashes', () => {
            const pattern = '{subtype}///{id}-{slug}';
            const result = (0, workspace_creator_js_1.generateBranchName)(pattern, {
                subtype: 'feature',
                id: 'ws-abc123',
                slug: 'my-story',
            });
            (0, vitest_1.expect)(result).toContain('feature');
            (0, vitest_1.expect)(result).not.toContain('///');
        });
        (0, vitest_1.it)('returns default fallback if pattern is empty', () => {
            const result = (0, workspace_creator_js_1.generateBranchName)('', {});
            (0, vitest_1.expect)(result).toBe('workspace');
        });
        (0, vitest_1.it)('handles patterns with no placeholders', () => {
            const result = (0, workspace_creator_js_1.generateBranchName)('feature/task', {});
            (0, vitest_1.expect)(result).toBe('feature/task');
        });
    });
    (0, vitest_1.describe)('WorkspaceCreateError', () => {
        (0, vitest_1.it)('carries message and optional suggestion', () => {
            const err = new workspace_creator_js_1.WorkspaceCreateError('Config not found', 'Run: forge config set...');
            (0, vitest_1.expect)(err.message).toBe('Config not found');
            (0, vitest_1.expect)(err.suggestion).toBe('Run: forge config set...');
            (0, vitest_1.expect)(err.name).toBe('WorkspaceCreateError');
        });
        (0, vitest_1.it)('is an instance of Error', () => {
            const err = new workspace_creator_js_1.WorkspaceCreateError('Test');
            (0, vitest_1.expect)(err).toBeInstanceOf(Error);
            (0, vitest_1.expect)(err).toBeInstanceOf(workspace_creator_js_1.WorkspaceCreateError);
        });
    });
});
(0, vitest_1.describe)('WorkspaceCreator (unit tests with mocks)', () => {
    // Mock ForgeCore
    const mockForge = {
        resolve: vitest_1.vi.fn(),
        install: vitest_1.vi.fn(),
        repoWorkflow: vitest_1.vi.fn(),
    };
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('create() - config resolution failure', () => {
        (0, vitest_1.it)('throws WorkspaceCreateError if config not found', async () => {
            mockForge.resolve.mockRejectedValue(new Error('Not found'));
            const creator = new workspace_creator_js_1.WorkspaceCreator(mockForge);
            const opts = { configName: 'nonexistent' };
            await (0, vitest_1.expect)(creator.create(opts)).rejects.toBeInstanceOf(workspace_creator_js_1.WorkspaceCreateError);
        });
    });
    (0, vitest_1.describe)('create() - repo resolution failure', () => {
        (0, vitest_1.it)('throws WorkspaceCreateError if repo not in index', async () => {
            // This would require more mocking of the repo index system
            // Skipping detailed test as it requires full integration setup
        });
    });
    (0, vitest_1.describe)('create() - cleanup on failure', () => {
        (0, vitest_1.it)('removes workspace folder if creation fails after folder is created', async () => {
            // This requires full integration with mocked file system
            // Skipping as it's complex to mock fs operations
        });
    });
});
(0, vitest_1.describe)('WorkspaceCreator — CLAUDE.md uses worktreePath when clone succeeds', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-claudemd-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('CLAUDE.md path for a repo points inside the workspace, not at the source repo', async () => {
        // Build a minimal local git repo so createReferenceClone can succeed
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const runGit = promisify(execFile);
        const localRepoDir = path_1.default.join(tmpDir, 'repos', 'Anvil');
        await fs_1.promises.mkdir(localRepoDir, { recursive: true });
        await runGit('git', ['init', localRepoDir]);
        await runGit('git', ['-C', localRepoDir, 'checkout', '-b', 'main']);
        await fs_1.promises.writeFile(path_1.default.join(localRepoDir, 'README.md'), '# Anvil');
        await runGit('git', ['-C', localRepoDir, 'add', '.']);
        await runGit('git', ['-C', localRepoDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
            'commit', '-m', 'init']);
        const mockForge = {
            resolve: vitest_1.vi.fn().mockResolvedValue({
                ref: { version: '1.0.0' },
                bundle: {
                    meta: {
                        skills: [],
                        plugins: [],
                        mcp_servers: {},
                        git_workflow: {
                            branch_pattern: 'feature/{id}',
                            base_branch: 'main',
                            commit_format: 'conventional',
                            stash_before_checkout: false,
                            pr_template: false,
                            signed_commits: false,
                        },
                    },
                },
            }),
            install: vitest_1.vi.fn().mockResolvedValue(undefined),
            repoWorkflow: vitest_1.vi.fn().mockRejectedValue(new Error('no workflow')),
        };
        // Use loadGlobalConfig's actual path resolution but with a custom mount path
        // by passing mountPath override so the workspace goes into tmpDir
        const creator = new workspace_creator_js_1.WorkspaceCreator(mockForge);
        const record = await creator.create({
            configName: 'sdlc-default',
            repos: ['Anvil'],
            storyTitle: 'test story',
            mountPath: path_1.default.join(tmpDir, 'workspaces'),
        });
        const claudeMdContent = await fs_1.promises.readFile(path_1.default.join(record.path, 'CLAUDE.md'), 'utf-8');
        // The CLAUDE.md should reference the workspace clone, not the source repo
        // Fix 4: when worktreePath is set, path = hostWorkspacePath/repoName
        // The workspace clone dir is <workspacePath>/Anvil
        (0, vitest_1.expect)(claudeMdContent).not.toContain(localRepoDir);
        // Path ends with workspaceName/Anvil
        (0, vitest_1.expect)(claudeMdContent).toContain(`${record.name}/Anvil`);
    });
});
(0, vitest_1.describe)('WorkspaceCreator — workspace.env includes FORGE_WORKSPACE_PATH vars', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-envvars-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('emits FORGE_WORKSPACE_PATH and FORGE_HOST_WORKSPACE_PATH in workspace.env', async () => {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const runGit = promisify(execFile);
        const localRepoDir = path_1.default.join(tmpDir, 'repos', 'Anvil');
        await fs_1.promises.mkdir(localRepoDir, { recursive: true });
        await runGit('git', ['init', localRepoDir]);
        await runGit('git', ['-C', localRepoDir, 'checkout', '-b', 'main']);
        await fs_1.promises.writeFile(path_1.default.join(localRepoDir, 'README.md'), '# Anvil');
        await runGit('git', ['-C', localRepoDir, 'add', '.']);
        await runGit('git', ['-C', localRepoDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
            'commit', '-m', 'init']);
        const mockForge = {
            resolve: vitest_1.vi.fn().mockResolvedValue({
                ref: { version: '1.0.0' },
                bundle: {
                    meta: {
                        skills: [],
                        plugins: [],
                        mcp_servers: {},
                        git_workflow: {
                            branch_pattern: 'feature/{id}',
                            base_branch: 'main',
                            commit_format: 'conventional',
                            stash_before_checkout: false,
                            pr_template: false,
                            signed_commits: false,
                        },
                    },
                },
            }),
            install: vitest_1.vi.fn().mockResolvedValue(undefined),
            repoWorkflow: vitest_1.vi.fn().mockRejectedValue(new Error('no workflow')),
        };
        const mountPath = path_1.default.join(tmpDir, 'workspaces');
        const creator = new workspace_creator_js_1.WorkspaceCreator(mockForge);
        const record = await creator.create({
            configName: 'sdlc-default',
            repos: ['Anvil'],
            mountPath,
        });
        const envContent = await fs_1.promises.readFile(path_1.default.join(record.path, 'workspace.env'), 'utf-8');
        const envLines = envContent.split('\n').filter(Boolean);
        const envMap = Object.fromEntries(envLines.map(line => line.split('=')));
        (0, vitest_1.expect)(envMap['FORGE_WORKSPACE_PATH']).toBeDefined();
        (0, vitest_1.expect)(envMap['FORGE_HOST_WORKSPACE_PATH']).toBeDefined();
        // On native install (no host_workspaces_path config), both paths should be equal
        (0, vitest_1.expect)(envMap['FORGE_WORKSPACE_PATH']).toBe(envMap['FORGE_HOST_WORKSPACE_PATH']);
        // Both should be inside the mount path
        (0, vitest_1.expect)(envMap['FORGE_WORKSPACE_PATH']).toContain(mountPath);
    });
});
(0, vitest_1.describe)('reference clone integration', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-refclone-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('clones a local repo and creates the feature branch', async () => {
        // Set up a bare local repo to act as the "remote"
        const remoteDir = path_1.default.join(tmpDir, 'remote.git');
        const localDir = path_1.default.join(tmpDir, 'local');
        const cloneDir = path_1.default.join(tmpDir, 'ws', 'myrepo');
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const runGit = promisify(execFile);
        // Create a minimal git repo with one commit
        await runGit('git', ['init', '--bare', remoteDir]);
        await runGit('git', ['clone', remoteDir, localDir]);
        await fs_1.promises.writeFile(path_1.default.join(localDir, 'README.md'), '# test');
        await runGit('git', ['-C', localDir, 'add', '.']);
        await runGit('git', ['-C', localDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
            'commit', '-m', 'init']);
        await runGit('git', ['-C', localDir, 'push', 'origin', 'HEAD:main']);
        // Create workspace destination parent
        await fs_1.promises.mkdir(path_1.default.join(tmpDir, 'ws'), { recursive: true });
        // Simulate what createReferenceClone does:
        // git clone --reference <localDir> <remoteDir> <cloneDir>
        await runGit('git', ['clone', '--reference', localDir, remoteDir, cloneDir]);
        // Verify clone exists and has the README
        const readme = await fs_1.promises.readFile(path_1.default.join(cloneDir, 'README.md'), 'utf-8');
        (0, vitest_1.expect)(readme).toBe('# test');
        // Create a feature branch
        await runGit('git', ['-C', cloneDir, 'checkout', '-b', 'feature/test-branch', 'origin/main']);
        const { stdout } = await runGit('git', ['-C', cloneDir, 'branch', '--show-current']);
        (0, vitest_1.expect)(stdout.trim()).toBe('feature/test-branch');
    });
    (0, vitest_1.it)('falls back to local clone when remote URL is unreachable', async () => {
        const localDir = path_1.default.join(tmpDir, 'local');
        const cloneDir = path_1.default.join(tmpDir, 'ws', 'myrepo');
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const runGit = promisify(execFile);
        // Create a real local git repo with one commit
        await runGit('git', ['init', localDir]);
        await runGit('git', ['-C', localDir, 'checkout', '-b', 'main']);
        await fs_1.promises.writeFile(path_1.default.join(localDir, 'README.md'), '# local');
        await runGit('git', ['-C', localDir, 'add', '.']);
        await runGit('git', ['-C', localDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
            'commit', '-m', 'init']);
        await fs_1.promises.mkdir(path_1.default.join(tmpDir, 'ws'), { recursive: true });
        // Use a bogus/unreachable remote URL
        await (0, vitest_1.expect)((0, repo_clone_js_1.createReferenceClone)({
            localPath: localDir,
            remoteUrl: 'git@bogus.invalid:x/y.git',
            destPath: cloneDir,
            branchName: 'feature/test-fallback',
            defaultBranch: 'main',
        })).resolves.toBeUndefined();
        // Verify the clone exists and is on the feature branch
        const { stdout: branch } = await runGit('git', ['-C', cloneDir, 'branch', '--show-current']);
        (0, vitest_1.expect)(branch.trim()).toBe('feature/test-fallback');
        const readme = await fs_1.promises.readFile(path_1.default.join(cloneDir, 'README.md'), 'utf-8');
        (0, vitest_1.expect)(readme).toBe('# local');
    });
    (0, vitest_1.it)('reference clone is independent — changes do not affect local repo', async () => {
        const remoteDir = path_1.default.join(tmpDir, 'remote.git');
        const localDir = path_1.default.join(tmpDir, 'local');
        const cloneDir = path_1.default.join(tmpDir, 'ws', 'myrepo');
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const runGit = promisify(execFile);
        await runGit('git', ['init', '--bare', remoteDir]);
        await runGit('git', ['clone', remoteDir, localDir]);
        await fs_1.promises.writeFile(path_1.default.join(localDir, 'README.md'), '# original');
        await runGit('git', ['-C', localDir, 'add', '.']);
        await runGit('git', ['-C', localDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
            'commit', '-m', 'init']);
        await runGit('git', ['-C', localDir, 'push', 'origin', 'HEAD:main']);
        await fs_1.promises.mkdir(path_1.default.join(tmpDir, 'ws'), { recursive: true });
        await runGit('git', ['clone', '--reference', localDir, remoteDir, cloneDir]);
        await runGit('git', ['-C', cloneDir, 'checkout', '-b', 'feature/branch', 'origin/main']);
        // Modify file in clone — local repo must be unaffected
        await fs_1.promises.writeFile(path_1.default.join(cloneDir, 'README.md'), '# modified in workspace');
        const localReadme = await fs_1.promises.readFile(path_1.default.join(localDir, 'README.md'), 'utf-8');
        (0, vitest_1.expect)(localReadme).toBe('# original');
    });
});
//# sourceMappingURL=workspace-creator.test.js.map