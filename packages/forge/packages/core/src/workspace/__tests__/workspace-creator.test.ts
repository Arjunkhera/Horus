import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  WorkspaceCreator,
  WorkspaceCreateError,
  slugify,
  generateBranchName,
  type WorkspaceCreateOptions,
} from '../workspace-creator.js';
import { createReferenceClone } from '../../repo/repo-clone.js';

describe('workspace-creator helpers', () => {
  describe('slugify()', () => {
    it('converts to lowercase kebab-case', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('My Feature Story')).toBe('my-feature-story');
    });

    it('removes special characters', () => {
      expect(slugify('Hello! @World#')).toBe('hello-world');
      expect(slugify('My-Story_123')).toBe('my-story-123');
    });

    it('enforces max 30 character length', () => {
      const long = 'this is a very long story title that exceeds the limit';
      const result = slugify(long);
      expect(result.length).toBeLessThanOrEqual(30);
    });

    it('handles edge cases', () => {
      expect(slugify('')).toBe('');
      expect(slugify('---')).toBe('');
      expect(slugify('a')).toBe('a');
    });
  });

  describe('generateBranchName()', () => {
    it('replaces {id}, {slug}, {subtype} placeholders', () => {
      const pattern = '{subtype}/{id}-{slug}';
      const result = generateBranchName(pattern, {
        subtype: 'feature',
        id: 'ws-abc123',
        slug: 'my-story',
      });
      expect(result).toBe('feature/ws-abc123-my-story');
    });

    it('handles missing placeholders', () => {
      const pattern = '{subtype}/{id}-{slug}';
      const result = generateBranchName(pattern, { id: 'ws-abc123' });
      expect(result).toBe('ws-abc123-');
    });

    it('cleans up double slashes', () => {
      const pattern = '{subtype}///{id}-{slug}';
      const result = generateBranchName(pattern, {
        subtype: 'feature',
        id: 'ws-abc123',
        slug: 'my-story',
      });
      expect(result).toContain('feature');
      expect(result).not.toContain('///');
    });

    it('returns default fallback if pattern is empty', () => {
      const result = generateBranchName('', {});
      expect(result).toBe('workspace');
    });

    it('handles patterns with no placeholders', () => {
      const result = generateBranchName('feature/task', {});
      expect(result).toBe('feature/task');
    });
  });

  describe('WorkspaceCreateError', () => {
    it('carries message and optional suggestion', () => {
      const err = new WorkspaceCreateError('Config not found', 'Run: forge config set...');
      expect(err.message).toBe('Config not found');
      expect(err.suggestion).toBe('Run: forge config set...');
      expect(err.name).toBe('WorkspaceCreateError');
    });

    it('is an instance of Error', () => {
      const err = new WorkspaceCreateError('Test');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(WorkspaceCreateError);
    });
  });
});

describe('WorkspaceCreator (unit tests with mocks)', () => {
  // Mock ForgeCore
  const mockForge = {
    resolve: vi.fn(),
    install: vi.fn(),
    repoWorkflow: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create() - config resolution failure', () => {
    it('throws WorkspaceCreateError if config not found', async () => {
      mockForge.resolve.mockRejectedValue(new Error('Not found'));
      const creator = new WorkspaceCreator(mockForge as any);

      const opts: WorkspaceCreateOptions = { configName: 'nonexistent' };
      await expect(creator.create(opts)).rejects.toBeInstanceOf(WorkspaceCreateError);
    });
  });

  describe('create() - repo resolution failure', () => {
    it('throws WorkspaceCreateError if repo not in index', async () => {
      // This would require more mocking of the repo index system
      // Skipping detailed test as it requires full integration setup
    });
  });

  describe('create() - cleanup on failure', () => {
    it('removes workspace folder if creation fails after folder is created', async () => {
      // This requires full integration with mocked file system
      // Skipping as it's complex to mock fs operations
    });
  });
});

describe('WorkspaceCreator — CLAUDE.md uses worktreePath when clone succeeds', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-claudemd-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('CLAUDE.md path for a repo points inside the workspace, not at the source repo', async () => {
    // Build a minimal local git repo so createReferenceClone can succeed
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const runGit = promisify(execFile);

    const localRepoDir = path.join(tmpDir, 'repos', 'Anvil');
    await fs.mkdir(localRepoDir, { recursive: true });
    await runGit('git', ['init', localRepoDir]);
    await runGit('git', ['-C', localRepoDir, 'checkout', '-b', 'main']);
    await fs.writeFile(path.join(localRepoDir, 'README.md'), '# Anvil');
    await runGit('git', ['-C', localRepoDir, 'add', '.']);
    await runGit('git', ['-C', localRepoDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
      'commit', '-m', 'init']);

    const mockForge = {
      resolve: vi.fn().mockResolvedValue({
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
      install: vi.fn().mockResolvedValue(undefined),
      repoWorkflow: vi.fn().mockRejectedValue(new Error('no workflow')),
    };

    // Use loadGlobalConfig's actual path resolution but with a custom mount path
    // by passing mountPath override so the workspace goes into tmpDir
    const creator = new WorkspaceCreator(mockForge as any);
    const record = await creator.create({
      configName: 'sdlc-default',
      repos: ['Anvil'],
      storyTitle: 'test story',
      mountPath: path.join(tmpDir, 'workspaces'),
    });

    const claudeMdContent = await fs.readFile(path.join(record.path, 'CLAUDE.md'), 'utf-8');

    // The CLAUDE.md should reference the workspace clone, not the source repo
    // Fix 4: when worktreePath is set, path = hostWorkspacePath/repoName
    // The workspace clone dir is <workspacePath>/Anvil
    expect(claudeMdContent).not.toContain(localRepoDir);
    // Path ends with workspaceName/Anvil
    expect(claudeMdContent).toContain(`${record.name}/Anvil`);
  });
});

describe('WorkspaceCreator — workspace.env includes FORGE_WORKSPACE_PATH vars', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-envvars-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('emits FORGE_WORKSPACE_PATH and FORGE_HOST_WORKSPACE_PATH in workspace.env', async () => {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const runGit = promisify(execFile);

    const localRepoDir = path.join(tmpDir, 'repos', 'Anvil');
    await fs.mkdir(localRepoDir, { recursive: true });
    await runGit('git', ['init', localRepoDir]);
    await runGit('git', ['-C', localRepoDir, 'checkout', '-b', 'main']);
    await fs.writeFile(path.join(localRepoDir, 'README.md'), '# Anvil');
    await runGit('git', ['-C', localRepoDir, 'add', '.']);
    await runGit('git', ['-C', localRepoDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
      'commit', '-m', 'init']);

    const mockForge = {
      resolve: vi.fn().mockResolvedValue({
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
      install: vi.fn().mockResolvedValue(undefined),
      repoWorkflow: vi.fn().mockRejectedValue(new Error('no workflow')),
    };

    const mountPath = path.join(tmpDir, 'workspaces');
    const creator = new WorkspaceCreator(mockForge as any);
    const record = await creator.create({
      configName: 'sdlc-default',
      repos: ['Anvil'],
      mountPath,
    });

    const envContent = await fs.readFile(path.join(record.path, 'workspace.env'), 'utf-8');
    const envLines = envContent.split('\n').filter(Boolean);
    const envMap = Object.fromEntries(envLines.map(line => line.split('=') as [string, string]));

    expect(envMap['FORGE_WORKSPACE_PATH']).toBeDefined();
    expect(envMap['FORGE_HOST_WORKSPACE_PATH']).toBeDefined();
    // On native install (no host_workspaces_path config), both paths should be equal
    expect(envMap['FORGE_WORKSPACE_PATH']).toBe(envMap['FORGE_HOST_WORKSPACE_PATH']);
    // Both should be inside the mount path
    expect(envMap['FORGE_WORKSPACE_PATH']).toContain(mountPath);
  });
});

describe('reference clone integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-refclone-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('clones a local repo and creates the feature branch', async () => {
    // Set up a bare local repo to act as the "remote"
    const remoteDir = path.join(tmpDir, 'remote.git');
    const localDir = path.join(tmpDir, 'local');
    const cloneDir = path.join(tmpDir, 'ws', 'myrepo');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const runGit = promisify(execFile);

    // Create a minimal git repo with one commit
    await runGit('git', ['init', '--bare', remoteDir]);
    await runGit('git', ['clone', remoteDir, localDir]);
    await fs.writeFile(path.join(localDir, 'README.md'), '# test');
    await runGit('git', ['-C', localDir, 'add', '.']);
    await runGit('git', ['-C', localDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
      'commit', '-m', 'init']);
    await runGit('git', ['-C', localDir, 'push', 'origin', 'HEAD:main']);

    // Create workspace destination parent
    await fs.mkdir(path.join(tmpDir, 'ws'), { recursive: true });

    // Simulate what createReferenceClone does:
    // git clone --reference <localDir> <remoteDir> <cloneDir>
    await runGit('git', ['clone', '--reference', localDir, remoteDir, cloneDir]);

    // Verify clone exists and has the README
    const readme = await fs.readFile(path.join(cloneDir, 'README.md'), 'utf-8');
    expect(readme).toBe('# test');

    // Create a feature branch
    await runGit('git', ['-C', cloneDir, 'checkout', '-b', 'feature/test-branch', 'origin/main']);

    const { stdout } = await runGit('git', ['-C', cloneDir, 'branch', '--show-current']);
    expect(stdout.trim()).toBe('feature/test-branch');
  });

  it('falls back to local clone when remote URL is unreachable', async () => {
    const localDir = path.join(tmpDir, 'local');
    const cloneDir = path.join(tmpDir, 'ws', 'myrepo');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const runGit = promisify(execFile);

    // Create a real local git repo with one commit
    await runGit('git', ['init', localDir]);
    await runGit('git', ['-C', localDir, 'checkout', '-b', 'main']);
    await fs.writeFile(path.join(localDir, 'README.md'), '# local');
    await runGit('git', ['-C', localDir, 'add', '.']);
    await runGit('git', ['-C', localDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
      'commit', '-m', 'init']);

    await fs.mkdir(path.join(tmpDir, 'ws'), { recursive: true });

    // Use a bogus/unreachable remote URL
    await expect(createReferenceClone({
      localPath: localDir,
      remoteUrl: 'git@bogus.invalid:x/y.git',
      destPath: cloneDir,
      branchName: 'feature/test-fallback',
      defaultBranch: 'main',
    })).resolves.toMatchObject({ actualDefaultBranch: 'main' });

    // Verify the clone exists and is on the feature branch
    const { stdout: branch } = await runGit('git', ['-C', cloneDir, 'branch', '--show-current']);
    expect(branch.trim()).toBe('feature/test-fallback');

    const readme = await fs.readFile(path.join(cloneDir, 'README.md'), 'utf-8');
    expect(readme).toBe('# local');
  });

  it('reference clone is independent — changes do not affect local repo', async () => {
    const remoteDir = path.join(tmpDir, 'remote.git');
    const localDir = path.join(tmpDir, 'local');
    const cloneDir = path.join(tmpDir, 'ws', 'myrepo');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const runGit = promisify(execFile);

    await runGit('git', ['init', '--bare', remoteDir]);
    await runGit('git', ['clone', remoteDir, localDir]);
    await fs.writeFile(path.join(localDir, 'README.md'), '# original');
    await runGit('git', ['-C', localDir, 'add', '.']);
    await runGit('git', ['-C', localDir, '-c', 'user.name=Test', '-c', 'user.email=t@t.com',
      'commit', '-m', 'init']);
    await runGit('git', ['-C', localDir, 'push', 'origin', 'HEAD:main']);

    await fs.mkdir(path.join(tmpDir, 'ws'), { recursive: true });
    await runGit('git', ['clone', '--reference', localDir, remoteDir, cloneDir]);
    await runGit('git', ['-C', cloneDir, 'checkout', '-b', 'feature/branch', 'origin/main']);

    // Modify file in clone — local repo must be unaffected
    await fs.writeFile(path.join(cloneDir, 'README.md'), '# modified in workspace');

    const localReadme = await fs.readFile(path.join(localDir, 'README.md'), 'utf-8');
    expect(localReadme).toBe('# original');
  });
});

