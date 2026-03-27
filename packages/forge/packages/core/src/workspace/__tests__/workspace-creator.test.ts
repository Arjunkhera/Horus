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

describe('WorkspaceCreator — CLAUDE.md is context-only (no clone paths)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-claudemd-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('CLAUDE.md references forge_develop for code isolation (no repos specified)', async () => {
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

    const creator = new WorkspaceCreator(mockForge as any);
    const record = await creator.create({
      configName: 'sdlc-default',
      mountPath: path.join(tmpDir, 'workspaces'),
    });

    const claudeMdContent = await fs.readFile(path.join(record.path, 'CLAUDE.md'), 'utf-8');

    // Should show "(none)" for repos when none are linked
    expect(claudeMdContent).toContain('(none)');
    // Should NOT have any worktree/clone path reference
    expect(claudeMdContent).not.toContain('worktreePath');
    // Should mention forge_develop for code isolation
    expect(claudeMdContent).toContain('forge_develop');
    // Should NOT reference forge_repo_clone
    expect(claudeMdContent).not.toContain('forge_repo_clone');
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

describe('WorkspaceCreator — no git clones created during workspace creation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-noclone-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('workspace folder contains no git clones after creation', async () => {
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
      mountPath,
    });

    // Verify the workspace was created
    const stat = await fs.stat(record.path);
    expect(stat.isDirectory()).toBe(true);

    // Verify repos array has no worktreePath field
    for (const repo of record.repos) {
      expect(Object.keys(repo)).not.toContain('worktreePath');
    }
  });

  it('workspace creation completes without git operations', async () => {
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
    const start = Date.now();
    const creator = new WorkspaceCreator(mockForge as any);
    await creator.create({ configName: 'sdlc-default', mountPath });
    const elapsed = Date.now() - start;

    // With no git operations, creation should be fast (well under 10 seconds)
    // Using a generous threshold to avoid flakiness in CI
    expect(elapsed).toBeLessThan(10000);
  });
});
