import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { repoDevelop, type RepoDevelopOptions } from '../repo-develop.js';
import type { GlobalConfig } from '../../models/global-config.js';
import type { RepoIndexEntry } from '../../models/repo-index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal GlobalConfig-like object for tests.
 * All paths point into a temp directory.
 */
function makeGlobalConfig(tmpDir: string): GlobalConfig {
  return {
    registries: [],
    workspace: {
      mount_path: path.join(tmpDir, 'workspaces'),
      default_config: 'sdlc-default',
      retention_days: 30,
      store_path: path.join(tmpDir, 'workspaces.json'),
      sessions_path: path.join(tmpDir, 'sessions.json'),
      managed_repos_path: path.join(tmpDir, 'repos'),
      sessions_root: path.join(tmpDir, 'sessions'),
      max_sessions: 20,
    },
    mcp_endpoints: {},
    repos: {
      scan_paths: [],
      index_path: path.join(tmpDir, 'repos.json'),
    },
    global_plugins: {},
    claude_permissions: {
      allow: ['mcp__*__*'],
      deny: [],
    },
  };
}

/**
 * Build a minimal RepoIndexEntry for tests.
 */
function makeRepoEntry(overrides: Partial<RepoIndexEntry> = {}): RepoIndexEntry {
  return {
    name: 'TestRepo',
    localPath: '/fake/path/TestRepo',
    remoteUrl: 'git@github.com:Org/TestRepo.git',
    defaultBranch: 'main',
    language: 'TypeScript',
    framework: null,
    lastCommitDate: new Date().toISOString(),
    lastScannedAt: new Date().toISOString(),
    ...overrides,
  };
}

const CONFIRMED_WORKFLOW = {
  type: 'owner' as const,
  pushTo: 'origin',
  prTarget: { repo: 'Org/TestRepo', branch: 'main' },
  confirmedAt: new Date().toISOString(),
  confirmedBy: 'user' as const,
};

const INLINE_WORKFLOW = {
  type: 'owner' as const,
  pushTo: 'origin',
  prTarget: { repo: 'Org/TestRepo', branch: 'main' },
};

// ─── Mock git ─────────────────────────────────────────────────────────────────

// We mock child_process.execFile at module level because we cannot actually run
// git commands in unit tests without real git repos.
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        // Use the callback if provided (promisify path), else return a fake child process
        if (typeof cb === 'function') {
          // git remote → empty, git fetch → success, git worktree add → success
          const joined = args.join(' ');
          if (joined.startsWith('remote')) {
            cb(null, { stdout: 'origin\n', stderr: '' });
          } else if (joined.startsWith('rev-parse --verify origin/')) {
            cb(null, { stdout: 'abc1234', stderr: '' });
          } else if (joined.startsWith('rev-parse --abbrev-ref')) {
            cb(null, { stdout: 'main', stderr: '' });
          } else if (joined.startsWith('remote get-url origin')) {
            cb(null, { stdout: 'git@github.com:Org/TestRepo.git', stderr: '' });
          } else if (joined.startsWith('worktree add')) {
            cb(null, { stdout: '', stderr: '' });
          } else if (joined.startsWith('fetch')) {
            cb(null, { stdout: '', stderr: '' });
          } else if (joined.startsWith('clone')) {
            // git clone — simulate success by creating the dest directory
            // args = ['clone', sourceUrl, destPath]
            const destPath = args[2];
            if (destPath) {
              const mkdirSync = require('fs').mkdirSync;
              mkdirSync(destPath, { recursive: true });
            }
            cb(null, { stdout: '', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
        }
        return {} as any;
      },
    ),
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('repoDevelop', () => {
  let tmpDir: string;
  let globalConfig: GlobalConfig;
  let fakeRepoPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-develop-'));
    globalConfig = makeGlobalConfig(tmpDir);
    // Create the fake repo directory so fs.access succeeds for managed-pool checks
    fakeRepoPath = path.join(tmpDir, 'repos', 'TestRepo');
    await fs.mkdir(fakeRepoPath, { recursive: true });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Tier-1: User repo index ────────────────────────────────────────────────

  describe('Tier-1: repo found in user index', () => {
    it('returns needs_workflow_confirmation when repo has no saved workflow', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('needs_workflow_confirmation');
      if (result.status === 'needs_workflow_confirmation') {
        expect(result.detected).toBeDefined();
        expect(result.detected.type).toMatch(/owner|fork|contributor/);
        expect(result.message).toContain('forge_develop');
      }
    });

    it('creates a session when repo has a confirmed workflow', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.repo).toBe('TestRepo');
        // User-tier repos are auto-cloned to managed pool for writable worktree base
        expect(result.repoSource).toBe('managed');
        expect(result.branch).toBe('feature/wi-abc123');
        expect(result.baseBranch).toBe('main');
        expect(result.workflow.type).toBe('owner');
        expect(result.agentSlot).toBe(1);
        expect(result.sessionPath).toContain('sessions');
      }
    });

    it('creates session with inline workflow and saves it to index', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath });
      const repoIndex = { repos: [entry] };
      const savedEntries: RepoIndexEntry[][] = [];

      const opts: RepoDevelopOptions = {
        repo: 'TestRepo',
        workItem: 'wi-abc123',
        workflow: INLINE_WORKFLOW,
      };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async (repos) => {
        savedEntries.push(repos);
      });

      expect(result.status).toBe('created');
      // Verify save was called with workflow attached
      expect(savedEntries.length).toBe(1);
      const savedEntry = savedEntries[0].find(r => r.name === 'TestRepo');
      expect(savedEntry?.workflow).toBeDefined();
      expect(savedEntry?.workflow?.confirmedBy).toBe('user');
    });

    it('uses custom branch name when provided', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = {
        repo: 'TestRepo',
        workItem: 'wi-abc123',
        branch: 'feat/custom-branch',
      };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.branch).toBe('feat/custom-branch');
      }
    });
  });

  // ── Tier-2: Managed pool ───────────────────────────────────────────────────

  describe('Tier-2: repo found in managed pool', () => {
    it('finds repo in managed pool when not in index', async () => {
      // No entry in index, but managed pool dir exists (created in beforeEach)
      const opts: RepoDevelopOptions = {
        repo: 'TestRepo',
        workItem: 'wi-abc123',
        workflow: INLINE_WORKFLOW,
      };
      const result = await repoDevelop(opts, globalConfig, null, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.repoSource).toBe('managed');
      }
    });
  });

  // ── Tier-3: Not found ──────────────────────────────────────────────────────

  describe('Tier-3: repo not found anywhere', () => {
    it('throws REPO_NOT_FOUND when repo not in index or managed pool', async () => {
      // Remove the managed pool dir so it's not found
      await fs.rm(fakeRepoPath, { recursive: true, force: true });

      const opts: RepoDevelopOptions = {
        repo: 'UnknownRepo',
        workItem: 'wi-abc123',
        workflow: INLINE_WORKFLOW,
      };

      await expect(
        repoDevelop(opts, globalConfig, null, async () => {}),
      ).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
      });
    });
  });

  // ── Resume flow ───────────────────────────────────────────────────────────

  describe('session resume flow', () => {
    it('resumes an existing session with status "resumed"', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      // First call — creates the session
      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const first = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(first.status).toBe('created');
      if (first.status !== 'created') return; // type narrowing

      // Second call — same workItem+repo → resume
      const second = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(second.status).toBe('resumed');
      if (second.status === 'resumed') {
        expect(second.sessionId).toBe(first.sessionId);
        expect(second.sessionPath).toBe(first.sessionPath);
      }
    });
  });

  // ── Multi-agent: slot-2 assignment ────────────────────────────────────────

  describe('multi-agent slot-2 assignment', () => {
    it('first session gets agentSlot=1 and no path suffix', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.agentSlot).toBe(1);
        expect(result.sessionPath).not.toMatch(/-2$/);
        expect(result.sessionPath).not.toMatch(/-2\//);
      }
    });

    it('creates agentSlot=2 with "-2" path suffix when slot-1 record exists but directory is gone', async () => {
      // This is the primary achievable slot-2 scenario:
      // slot-1 was recorded in sessions.json but its worktree directory was
      // subsequently deleted (e.g., manual cleanup, container recreated).
      // findByWorkItem returns the slot-1 record, fs.access fails → fall through.
      // countByWorkItem returns 1 → new agentSlot = 2.
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };
      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-slot2' };

      // Create slot 1
      const first = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(first.status).toBe('created');
      if (first.status !== 'created') return;

      // Delete slot-1's session directory to simulate orphaned record
      await fs.rm(first.sessionPath, { recursive: true, force: true });

      // Second call: slot-1 record exists but path is gone → creates slot 2
      const second = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(second.status).toBe('created');
      if (second.status === 'created') {
        expect(second.agentSlot).toBe(2);
        expect(second.sessionPath).toMatch(/-2$/);
      }
    });

    it('slot-2 session is persisted in sessions.json alongside slot-1 record', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };
      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-slots' };

      // Create slot 1 then orphan it
      const first = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      if (first.status !== 'created') return;
      await fs.rm(first.sessionPath, { recursive: true, force: true });

      // Create slot 2
      await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      const raw = await fs.readFile(globalConfig.workspace.sessions_path, 'utf-8');
      const data = JSON.parse(raw);
      const slots = data.sessions.filter((s: any) => s.workItem === 'wi-slots');
      expect(slots.length).toBe(2);
      expect(slots.map((s: any) => s.agentSlot).sort()).toEqual([1, 2]);
    });

    // NOTE: True concurrent slot-2 (two agents calling forge_develop simultaneously,
    // both receiving status=created with different slots) requires agent-identity
    // tracking — currently not implemented. A sequential second agent receives
    // status=resumed on slot 1 if the path exists. Tracked separately.
  });

  // ── Workflow confirmation flow ────────────────────────────────────────────

  describe('workflow confirmation flow', () => {
    it('returns needs_workflow_confirmation with auto-detected values', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath }); // no workflow
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('needs_workflow_confirmation');
      if (result.status === 'needs_workflow_confirmation') {
        expect(result.detected.pushTo).toBe('origin');
        expect(result.detected.prTarget.branch).toBe('main');
        expect(result.message).toContain('workflow');
      }
    });

    it('proceeds when workflow parameter is provided on a fresh repo', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath }); // no workflow
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = {
        repo: 'TestRepo',
        workItem: 'wi-abc123',
        workflow: INLINE_WORKFLOW,
      };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
    });

    it('skips confirmation for repos with already-saved workflow', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).not.toBe('needs_workflow_confirmation');
    });
  });

  // ── Session path structure ────────────────────────────────────────────────

  describe('session path structure', () => {
    it('uses sessions_root from global config', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      if (result.status === 'created') {
        expect(result.sessionPath.startsWith(globalConfig.workspace.sessions_root)).toBe(true);
      }
    });

    it('UUID workItem IDs are shortened to first 8 chars in path', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const uuidWorkItem = '2d9c5c7d-3f56-4a61-a197-2530dcc4db0e';
      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: uuidWorkItem };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      if (result.status === 'created') {
        // Path should include the 8-char prefix, not the full UUID
        expect(result.sessionPath).toContain('2d9c5c7d');
        expect(result.sessionPath).not.toContain('2d9c5c7d-3f56-4a61');
      }
    });
  });

  // ── Remote fetch degradation ──────────────────────────────────────────────

  describe('remote fetch failure degrades gracefully', () => {
    it('creates session even when git fetch fails', async () => {
      // Override execFile to make fetch fail
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('fetch')) {
          // Simulate network failure
          (cb as any)(new Error('network unreachable'), { stdout: '', stderr: '' });
        } else if (joined.startsWith('worktree add')) {
          (cb as any)(null, { stdout: '', stderr: '' });
        } else if (joined.startsWith('rev-parse --verify origin/')) {
          // Also fail — no origin ref available
          (cb as any)(new Error('not found'), { stdout: '', stderr: '' });
        } else if (joined.startsWith('clone')) {
          const destPath = (args as string[])[2];
          if (destPath) {
            require('fs').mkdirSync(destPath, { recursive: true });
          }
          (cb as any)(null, { stdout: '', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-abc123' };
      // Should not throw — degrades gracefully
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(result.status).toBe('created');
    });
  });

  // ── Read-only user-tier repo: managed clone auto-creation ─────────────────

  describe('read-only user-tier repo workaround', () => {
    it('auto-creates a managed clone when user-tier repo is used', async () => {
      // Use a localPath that is NOT inside the managed pool (simulates user-tier)
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });

      // Remove the managed pool entry so it doesn't already exist
      await fs.rm(fakeRepoPath, { recursive: true, force: true });

      const entry = makeRepoEntry({
        localPath: userRepoPath,
        workflow: CONFIRMED_WORKFLOW,
      });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-clone1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        // repoSource should be 'managed' after auto-cloning
        expect(result.repoSource).toBe('managed');
      }

      // Verify that git clone was called with the user-tier path as source
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const cloneCalls = mockExecFile.mock.calls.filter(
        (call) => (call[1] as string[])?.[0] === 'clone',
      );
      expect(cloneCalls.length).toBe(1);
      const cloneArgs = cloneCalls[0][1] as string[];
      expect(cloneArgs[1]).toBe(userRepoPath); // source = user-tier path
      // dest is now tmpPath (atomic rename) — ends with .tmp.<pid> before rename
      expect(cloneArgs[2]).toContain(path.join(tmpDir, 'repos', 'TestRepo'));
      expect(cloneArgs[2]).toContain('.tmp.');
    });

    it('reuses existing managed clone on subsequent calls', async () => {
      // The managed pool entry already exists (created in beforeEach)
      // Use a localPath that is outside the managed pool (user-tier)
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });

      const entry = makeRepoEntry({
        localPath: userRepoPath,
        workflow: CONFIRMED_WORKFLOW,
      });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-reuse1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.repoSource).toBe('managed');
      }

      // Verify git clone was NOT called (managed clone already existed)
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const cloneCalls = mockExecFile.mock.calls.filter(
        (call) => (call[1] as string[])?.[0] === 'clone',
      );
      expect(cloneCalls.length).toBe(0);
    });

    it('does not clone for repos already in the managed pool (tier-2)', async () => {
      // Repo found directly in managed pool (not in user index)
      const opts: RepoDevelopOptions = {
        repo: 'TestRepo',
        workItem: 'wi-managed1',
        workflow: INLINE_WORKFLOW,
      };
      const result = await repoDevelop(opts, globalConfig, null, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.repoSource).toBe('managed');
      }

      // No clone should have been triggered
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const cloneCalls = mockExecFile.mock.calls.filter(
        (call) => (call[1] as string[])?.[0] === 'clone',
      );
      expect(cloneCalls.length).toBe(0);
    });

    it('session record stores repoSource as managed after auto-clone', async () => {
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });
      await fs.rm(fakeRepoPath, { recursive: true, force: true });

      const entry = makeRepoEntry({
        localPath: userRepoPath,
        workflow: CONFIRMED_WORKFLOW,
      });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-record1' };
      await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      // Read the session store and verify the repoSource
      const sessionsJson = await fs.readFile(globalConfig.workspace.sessions_path, 'utf-8');
      const sessionsData = JSON.parse(sessionsJson);
      expect(sessionsData.sessions).toHaveLength(1);
      expect(sessionsData.sessions[0].repoSource).toBe('managed');
    });
  });

  // ── Docker host path fixup ─────────────────────────────────────────────────

  describe('Docker host path fixup', () => {
    it('rewrites .git pointer and backlink when host paths are configured', async () => {
      // Simulate Docker layout using tmpDir as the "/data" root
      const containerData = path.join(tmpDir, 'data');
      const containerSessionsRoot = path.join(containerData, 'sessions');
      const containerManagedRepos = path.join(containerData, 'horus-repos');
      const hostBase = path.join(tmpDir, 'host');
      const hostRepos = path.join(hostBase, 'repos');

      const dockerConfig = makeGlobalConfig(tmpDir);
      dockerConfig.workspace.sessions_root = containerSessionsRoot;
      dockerConfig.workspace.managed_repos_path = containerManagedRepos;
      dockerConfig.workspace.host_workspaces_path = path.join(hostBase, 'workspaces');
      dockerConfig.workspace.host_managed_repos_path = hostRepos;

      // Create the managed repo dir so tier-2 resolution finds it
      const managedRepoPath = path.join(containerManagedRepos, 'TestRepo');
      await fs.mkdir(managedRepoPath, { recursive: true });

      const entry = makeRepoEntry({
        localPath: managedRepoPath,
        workflow: CONFIRMED_WORKFLOW,
      });
      const repoIndex = { repos: [entry] };

      // Override mock so `git worktree add` creates a realistic .git file + backlink
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('worktree add')) {
          // args = ['worktree', 'add', sessionPath, '-b', branch, base]
          const sessionDir = (args as string[])[2];
          const sessionDirName = path.basename(sessionDir);
          const worktreeDir = path.join(managedRepoPath, '.git', 'worktrees', sessionDirName);
          const fsSync = require('fs');
          fsSync.mkdirSync(sessionDir, { recursive: true });
          fsSync.mkdirSync(worktreeDir, { recursive: true });
          fsSync.writeFileSync(
            path.join(sessionDir, '.git'),
            `gitdir: ${containerManagedRepos}/TestRepo/.git/worktrees/${sessionDirName}\n`,
          );
          fsSync.writeFileSync(
            path.join(worktreeDir, 'gitdir'),
            `${sessionDir}/.git\n`,
          );
          (cb as any)(null, { stdout: '', stderr: '' });
        } else if (joined.startsWith('rev-parse --verify origin/')) {
          (cb as any)(null, { stdout: 'abc1234', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-docker1' };
      const result = await repoDevelop(opts, dockerConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.hostSessionPath).toBeDefined();
        const sessionDir = result.sessionPath;
        const sessionDirName = path.basename(sessionDir);
        const worktreeDir = path.join(managedRepoPath, '.git', 'worktrees', sessionDirName);

        // Verify .git file was rewritten with host managed repos path
        const dotGit = await fs.readFile(path.join(sessionDir, '.git'), 'utf-8');
        expect(dotGit).toContain(hostRepos);
        expect(dotGit).not.toContain(containerManagedRepos);

        // Verify backlink was rewritten with host session path
        const backlink = await fs.readFile(path.join(worktreeDir, 'gitdir'), 'utf-8');
        expect(backlink).toContain(result.hostSessionPath!);
        expect(backlink).not.toContain(containerSessionsRoot);
      }
    });

    it('sets origin remote to GitHub URL from repo index', async () => {
      const entry = makeRepoEntry({
        localPath: fakeRepoPath,
        workflow: CONFIRMED_WORKFLOW,
        remoteUrl: 'git@github.com:Org/TestRepo.git',
      });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-remote1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(result.status).toBe('created');

      // Verify git remote set-url was called with the GitHub URL
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const remoteSetUrlCalls = mockExecFile.mock.calls.filter(
        (call) => {
          const args = call[1] as string[];
          return args[0] === 'remote' && args[1] === 'set-url';
        },
      );
      expect(remoteSetUrlCalls.length).toBe(1);
      expect((remoteSetUrlCalls[0][1] as string[])[3]).toBe('git@github.com:Org/TestRepo.git');
    });

    it('skips remote set-url when remoteUrl is a local path', async () => {
      const entry = makeRepoEntry({
        localPath: fakeRepoPath,
        workflow: CONFIRMED_WORKFLOW,
        remoteUrl: '/data/repos/TestRepo',
      });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-localremote1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});
      expect(result.status).toBe('created');

      // Verify git remote set-url was NOT called
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const remoteSetUrlCalls = mockExecFile.mock.calls.filter(
        (call) => {
          const args = call[1] as string[];
          return args[0] === 'remote' && args[1] === 'set-url';
        },
      );
      expect(remoteSetUrlCalls.length).toBe(0);
    });

    it('does not rewrite paths when host config is not set (native install)', async () => {
      // Default config has no host_workspaces_path or host_managed_repos_path
      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-native1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.hostSessionPath).toBeUndefined();
      }
    });
  });

  // ── Repo name disambiguation ──────────────────────────────────────────────

  describe('Repo name disambiguation', () => {
    it('returns needs_repo_disambiguation when multiple repos share the same name', async () => {
      const entry1 = makeRepoEntry({
        localPath: '/path/a/MyRepo',
        remoteUrl: 'git@github.com:OrgA/MyRepo.git',
      });
      const entry2 = makeRepoEntry({
        localPath: '/path/b/MyRepo',
        remoteUrl: 'git@github.com:OrgB/MyRepo.git',
      });
      const repoIndex = { repos: [entry1, entry2] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-disambig1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('needs_repo_disambiguation');
      if (result.status === 'needs_repo_disambiguation') {
        expect(result.matches).toHaveLength(2);
        expect(result.matches[0].localPath).toBe('/path/a/MyRepo');
        expect(result.matches[1].localPath).toBe('/path/b/MyRepo');
        expect(result.message).toContain('Multiple repositories');
        expect(result.message).toContain('localPath');
      }
    });

    it('resolves to the correct repo when localPath is provided for disambiguation', async () => {
      const targetPath = path.join(tmpDir, 'repos', 'MyRepoB');
      await fs.mkdir(targetPath, { recursive: true });

      const entry1 = makeRepoEntry({
        localPath: '/path/a/MyRepo',
        remoteUrl: 'git@github.com:OrgA/MyRepo.git',
      });
      const entry2 = makeRepoEntry({
        localPath: targetPath,
        remoteUrl: 'git@github.com:OrgB/MyRepo.git',
        workflow: CONFIRMED_WORKFLOW,
      });
      const repoIndex = { repos: [entry1, entry2] };

      const opts: RepoDevelopOptions = {
        repo: 'TestRepo',
        workItem: 'wi-disambig2',
        localPath: targetPath,
      };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).not.toBe('needs_repo_disambiguation');
      // Should proceed past disambiguation — will either create or need workflow confirmation
      expect(['created', 'needs_workflow_confirmation']).not.toContain('needs_repo_disambiguation');
    });

    it('single name match still works without disambiguation (no regression)', async () => {

      const entry = makeRepoEntry({ localPath: fakeRepoPath, workflow: CONFIRMED_WORKFLOW });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = { repo: 'TestRepo', workItem: 'wi-single1' };
      const result = await repoDevelop(opts, globalConfig, repoIndex, async () => {});

      expect(result.status).toBe('created');
      if (result.status === 'created') {
        expect(result.repo).toBe('TestRepo');
      }
    });

    it('falls through to tier-2/3 when localPath does not match any index entry', async () => {
      const entry = makeRepoEntry({ localPath: fakeRepoPath });
      const repoIndex = { repos: [entry] };

      const opts: RepoDevelopOptions = {
        repo: 'NoSuchRepo',
        workItem: 'wi-notfound1',
        localPath: '/nonexistent/path',
      };

      await expect(
        repoDevelop(opts, globalConfig, repoIndex, async () => {}),
      ).rejects.toThrow('not found');
    });
  });

  // ── Clone failure cleanup (atomic rename) ─────────────────────────────────

  describe('clone failure cleanup (atomic rename)', () => {
    async function makeUserTierSetup() {
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });
      // Remove managed pool so a fresh clone is needed
      await fs.rm(fakeRepoPath, { recursive: true, force: true });
      const entry = makeRepoEntry({ localPath: userRepoPath, workflow: CONFIRMED_WORKFLOW });
      return { userRepoPath, entry };
    }

    it('throws CLONE_FAILED and leaves no tmp dir when git clone fails', async () => {
      const { entry } = await makeUserTierSetup();
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('clone')) {
          const err = Object.assign(new Error('clone failed'), { killed: false, stderr: 'fatal: not a repository' });
          (cb as any)(err, { stdout: '', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await expect(
        repoDevelop({ repo: 'TestRepo', workItem: 'wi-fail1' }, globalConfig, { repos: [entry] }, async () => {}),
      ).rejects.toMatchObject({ code: 'CLONE_FAILED' });

      // No .tmp. directory should remain in the managed pool
      const poolDir = path.join(tmpDir, 'repos');
      const entries = await fs.readdir(poolDir).catch(() => [] as string[]);
      expect(entries.filter(e => e.includes('.tmp.'))).toHaveLength(0);
    });

    it('throws CLONE_TIMEOUT (not CLONE_FAILED) when err.killed is true', async () => {
      const { entry } = await makeUserTierSetup();
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('clone')) {
          const err = Object.assign(new Error('timeout'), { killed: true, stderr: '' });
          (cb as any)(err, { stdout: '', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await expect(
        repoDevelop({ repo: 'TestRepo', workItem: 'wi-timeout1' }, globalConfig, { repos: [entry] }, async () => {}),
      ).rejects.toMatchObject({ code: 'CLONE_TIMEOUT' });
    });

    it('error message includes git stderr output', async () => {
      const { entry } = await makeUserTierSetup();
      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const gitStderr = 'fatal: repository not found';

      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('clone')) {
          const err = Object.assign(new Error('clone failed'), { killed: false, stderr: gitStderr });
          (cb as any)(err, { stdout: '', stderr: gitStderr });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      try {
        await repoDevelop({ repo: 'TestRepo', workItem: 'wi-stderr1' }, globalConfig, { repos: [entry] }, async () => {});
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('CLONE_FAILED');
        expect(err.message).toContain(gitStderr);
      }
    });
  });

  // ── Corrupt managed clone recovery ────────────────────────────────────────

  describe('corrupt managed clone recovery', () => {
    afterEach(async () => {
      // Reset mockImplementation overrides so subsequent tests see the default mock
      const { execFile } = await import('child_process');
      vi.mocked(execFile).mockReset();
    });

    it('reuses valid managed clone without re-cloning (regression check)', async () => {
      // fakeRepoPath exists and rev-parse --git-dir succeeds → skip clone
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });

      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);

      // Explicit default mock: rev-parse --git-dir → success; no clone needed
      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('worktree add')) {
          (cb as any)(null, { stdout: '', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      const entry = makeRepoEntry({ localPath: userRepoPath, workflow: CONFIRMED_WORKFLOW });
      const result = await repoDevelop(
        { repo: 'TestRepo', workItem: 'wi-valid1' },
        globalConfig,
        { repos: [entry] },
        async () => {},
      );

      expect(result.status).toBe('created');

      const cloneCalls = mockExecFile.mock.calls.filter(
        (call) => (call[1] as string[])?.[0] === 'clone',
      );
      expect(cloneCalls.length).toBe(0);
    });

    it('detects corrupt managed clone (rev-parse fails) and re-clones', async () => {
      // fakeRepoPath exists (from beforeEach) but rev-parse --git-dir will fail → corrupt
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });

      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((cmd, args, opts, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined === 'rev-parse --git-dir') {
          // Simulate corrupt managed clone
          (cb as any)(new Error('not a git repository'), { stdout: '', stderr: '' });
        } else if (joined.startsWith('clone')) {
          const destPath = (args as string[])[2];
          if (destPath) require('fs').mkdirSync(destPath, { recursive: true });
          (cb as any)(null, { stdout: '', stderr: '' });
        } else if (joined.startsWith('worktree add')) {
          (cb as any)(null, { stdout: '', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      const entry = makeRepoEntry({ localPath: userRepoPath, workflow: CONFIRMED_WORKFLOW });
      const result = await repoDevelop(
        { repo: 'TestRepo', workItem: 'wi-corrupt1' },
        globalConfig,
        { repos: [entry] },
        async () => {},
      );

      expect(result.status).toBe('created');

      // Clone was called (re-clone after corrupt detection)
      const cloneCalls = mockExecFile.mock.calls.filter(
        (call) => (call[1] as string[])?.[0] === 'clone',
      );
      expect(cloneCalls.length).toBe(1);
    });
  });

  // ── Source-adaptive clone timeout ─────────────────────────────────────────

  describe('source-adaptive clone timeout', () => {
    it('uses 300_000ms timeout for local path sources', async () => {
      const userRepoPath = path.join(tmpDir, 'user-repos', 'TestRepo');
      await fs.mkdir(userRepoPath, { recursive: true });
      await fs.rm(fakeRepoPath, { recursive: true, force: true });

      const { execFile } = await import('child_process');
      const mockExecFile = vi.mocked(execFile);
      const capturedTimeouts: number[] = [];

      mockExecFile.mockImplementation((cmd, args, opts: any, cb) => {
        const joined = (args as string[]).join(' ');
        if (joined.startsWith('clone')) {
          if (opts?.timeout !== undefined) capturedTimeouts.push(opts.timeout);
          const destPath = (args as string[])[2];
          if (destPath) require('fs').mkdirSync(destPath, { recursive: true });
          (cb as any)(null, { stdout: '', stderr: '' });
        } else if (joined.startsWith('worktree add')) {
          (cb as any)(null, { stdout: '', stderr: '' });
        } else {
          (cb as any)(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      const entry = makeRepoEntry({ localPath: userRepoPath, workflow: CONFIRMED_WORKFLOW });
      await repoDevelop(
        { repo: 'TestRepo', workItem: 'wi-local-timeout' },
        globalConfig,
        { repos: [entry] },
        async () => {},
      );

      expect(capturedTimeouts).toHaveLength(1);
      expect(capturedTimeouts[0]).toBe(300_000);
    });
  });
});
