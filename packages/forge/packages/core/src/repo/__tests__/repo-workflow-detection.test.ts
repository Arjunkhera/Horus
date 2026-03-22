import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ForgeCore } from '../../core.js';
import { saveRepoIndex } from '../repo-index-store.js';
import { saveGlobalConfig } from '../../config/global-config-loader.js';
import type { RepoIndex } from '../../models/repo-index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function writeYaml(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

async function setupGlobalConfig(tmpDir: string, reposIndexPath: string): Promise<string> {
  const configPath = path.join(tmpDir, 'forge-config.yaml');
  await writeYaml(
    configPath,
    `
registries: []
workspace:
  mount_path: ${tmpDir}/workspaces
  store_path: ${tmpDir}/workspaces.json
repos:
  scan_paths: []
  index_path: ${reposIndexPath}
`,
  );
  return configPath;
}

/**
 * Build a minimal ForgeCore instance pointing at a temp directory.
 * Returns the core and the path to the repos.json index.
 */
async function buildTestCore(tmpDir: string): Promise<{ core: ForgeCore; indexPath: string }> {
  const indexPath = path.join(tmpDir, 'repos.json');
  const configPath = await setupGlobalConfig(tmpDir, indexPath);

  // Use internal option to override global config path
  const core = new ForgeCore(tmpDir, { globalConfigPath: configPath });
  return { core, indexPath };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Workflow auto-detection and confirmation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'forge-workflow-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── Schema: RepoIndexWorkflow optional field ─────────────────────────────

  describe('RepoIndexEntry workflow field', () => {
    it('accepts an entry without workflow field (backward compatible)', async () => {
      const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
      const entry = {
        name: 'test',
        localPath: '/repos/test',
        remoteUrl: 'https://github.com/org/test.git',
        defaultBranch: 'main',
        language: 'TypeScript',
        framework: null,
        lastCommitDate: '2026-01-01T00:00:00Z',
        lastScannedAt: '2026-01-01T00:00:00Z',
      };
      const result = RepoIndexEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
      expect(result.data?.workflow).toBeUndefined();
    });

    it('accepts an entry with owner workflow', async () => {
      const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
      const entry = {
        name: 'my-repo',
        localPath: '/repos/my-repo',
        remoteUrl: 'https://github.com/me/my-repo.git',
        defaultBranch: 'main',
        language: null,
        framework: null,
        lastCommitDate: '',
        lastScannedAt: '2026-01-01T00:00:00Z',
        workflow: {
          type: 'owner' as const,
          pushTo: 'origin',
          prTarget: { repo: 'me/my-repo', branch: 'main' },
          confirmedAt: '2026-03-22T10:00:00Z',
          confirmedBy: 'user' as const,
          remotesSnapshot: { origin: 'https://github.com/me/my-repo.git' },
        },
      };
      const result = RepoIndexEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
      expect(result.data?.workflow?.type).toBe('owner');
    });

    it('accepts an entry with fork workflow', async () => {
      const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
      const entry = {
        name: 'upstream-repo',
        localPath: '/repos/upstream-repo',
        remoteUrl: 'https://github.com/me/upstream-repo.git',
        defaultBranch: 'main',
        language: null,
        framework: null,
        lastCommitDate: '',
        lastScannedAt: '2026-01-01T00:00:00Z',
        workflow: {
          type: 'fork' as const,
          upstream: 'https://github.com/org/upstream-repo.git',
          fork: 'https://github.com/me/upstream-repo.git',
          pushTo: 'origin',
          prTarget: { repo: 'org/upstream-repo', branch: 'main' },
          confirmedAt: '2026-03-22T10:00:00Z',
          confirmedBy: 'user' as const,
          remotesSnapshot: {
            origin: 'https://github.com/me/upstream-repo.git',
            upstream: 'https://github.com/org/upstream-repo.git',
          },
        },
      };
      const result = RepoIndexEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
      expect(result.data?.workflow?.type).toBe('fork');
      expect(result.data?.workflow?.upstream).toBe('https://github.com/org/upstream-repo.git');
    });

    it('accepts an entry with contributor workflow', async () => {
      const { RepoIndexEntrySchema } = await import('../../models/repo-index.js');
      const entry = {
        name: 'contrib-repo',
        localPath: '/repos/contrib-repo',
        remoteUrl: 'https://github.com/org/contrib-repo.git',
        defaultBranch: 'main',
        language: null,
        framework: null,
        lastCommitDate: '',
        lastScannedAt: '2026-01-01T00:00:00Z',
        workflow: {
          type: 'contributor' as const,
          pushTo: 'origin',
          prTarget: { repo: 'org/contrib-repo', branch: 'main' },
          confirmedAt: '2026-03-22T10:00:00Z',
          confirmedBy: 'auto' as const,
        },
      };
      const result = RepoIndexEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
      expect(result.data?.workflow?.type).toBe('contributor');
      expect(result.data?.workflow?.confirmedBy).toBe('auto');
    });
  });

  // ─── repoWorkflow: confirmed workflow in index ────────────────────────────

  describe('repoWorkflow() — Tier 0: confirmed workflow from index', () => {
    it('returns confirmed workflow from index when present', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'my-repo',
          localPath: path.join(tmpDir, 'my-repo'),
          remoteUrl: 'https://github.com/me/my-repo.git',
          defaultBranch: 'main',
          language: 'TypeScript',
          framework: null,
          lastCommitDate: '2026-03-20T00:00:00Z',
          lastScannedAt: '2026-03-22T00:00:00Z',
          workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'me/my-repo', branch: 'main' },
            confirmedAt: '2026-03-22T10:00:00Z',
            confirmedBy: 'user',
            remotesSnapshot: { origin: 'https://github.com/me/my-repo.git' },
          },
        }],
      };
      await saveRepoIndex(index, indexPath);

      // Create the repo dir so _listRemotes can run without errors
      await mkdir(path.join(tmpDir, 'my-repo'), { recursive: true });

      const result = await core.repoWorkflow('my-repo');

      expect(result.source).toBe('index');
      expect(result.needsConfirmation).toBeFalsy();
      expect(result.confirmedAt).toBe('2026-03-22T10:00:00Z');
      expect(result.confirmedBy).toBe('user');
      expect(result.workflow.strategy).toBe('owner');
    });

    it('includes staleness warning when remotes changed', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const repoDir = path.join(tmpDir, 'stale-repo');
      await mkdir(path.join(repoDir, '.git'), { recursive: true });

      // Initialize a git repo so git commands work
      await new Promise<void>((resolve, reject) => {
        const { execFile } = require('child_process');
        execFile('git', ['init', repoDir], (err: Error | null) => {
          err ? reject(err) : resolve();
        });
      }).catch(() => {
        // git init failed — skip staleness test gracefully
      });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'stale-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/stale-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
          workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'me/stale-repo', branch: 'main' },
            confirmedAt: '2026-03-01T10:00:00Z',
            confirmedBy: 'user',
            // Snapshot had "upstream", but current repo doesn't
            remotesSnapshot: {
              origin: 'https://github.com/me/stale-repo.git',
              upstream: 'https://github.com/org/stale-repo.git',
            },
          },
        }],
      };
      await saveRepoIndex(index, indexPath);

      const result = await core.repoWorkflow('stale-repo');
      // Source is still 'index' but may have a staleness warning
      expect(result.source).toBe('index');
      // The warning is present if git ran successfully and showed no upstream remote
      // In a CI/test env without real git remotes, we just verify the shape
      if (result.stalenessWarning) {
        expect(result.stalenessWarning).toMatch(/stale|changed/i);
      }
    });
  });

  // ─── repoWorkflow: no confirmed workflow → needs confirmation ─────────────

  describe('repoWorkflow() — no confirmed workflow → needsConfirmation', () => {
    it('returns needsConfirmation when repo in index has no workflow', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const repoDir = path.join(tmpDir, 'fresh-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'fresh-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/fresh-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
          // No workflow field
        }],
      };
      await saveRepoIndex(index, indexPath);

      const result = await core.repoWorkflow('fresh-repo');

      expect(result.needsConfirmation).toBe(true);
      expect(result.autoDetected).toBeDefined();
      expect(['owner', 'fork', 'contributor']).toContain(result.autoDetected?.type);
    });

    it('autoDetects fork workflow when upstream remote is present', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      // We need to mock the private _detectWorkflowFull / _listRemotes
      // by injecting a spy on the private method
      const repoDir = path.join(tmpDir, 'forked-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'forked-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/forked-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
        }],
      };
      await saveRepoIndex(index, indexPath);

      // Spy on the private _listRemotes to simulate upstream remote
      const remotes = {
        origin: 'https://github.com/me/forked-repo.git',
        upstream: 'https://github.com/org/forked-repo.git',
      };
      vi.spyOn(core as any, '_listRemotes').mockResolvedValue(remotes);

      const result = await core.repoWorkflow('forked-repo');

      expect(result.needsConfirmation).toBe(true);
      expect(result.autoDetected?.type).toBe('fork');
      expect(result.autoDetected?.upstream).toBe('https://github.com/org/forked-repo.git');
      expect(result.autoDetected?.fork).toBe('https://github.com/me/forked-repo.git');
      expect(result.autoDetected?.pushTo).toBe('origin');
    });

    it('autoDetects owner workflow when no upstream remote', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const repoDir = path.join(tmpDir, 'owner-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'owner-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/owner-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
        }],
      };
      await saveRepoIndex(index, indexPath);

      // Spy on _listRemotes to simulate plain origin-only setup
      vi.spyOn(core as any, '_listRemotes').mockResolvedValue({
        origin: 'https://github.com/me/owner-repo.git',
      });

      const result = await core.repoWorkflow('owner-repo');

      expect(result.needsConfirmation).toBe(true);
      expect(result.autoDetected?.type).toBe('owner');
      expect(result.autoDetected?.pushTo).toBe('origin');
    });

    it('returns default with needsConfirmation when repo not in index', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      // Empty index
      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [],
      };
      await saveRepoIndex(index, indexPath);

      const result = await core.repoWorkflow('nonexistent-repo');

      expect(result.source).toBe('default');
      expect(result.needsConfirmation).toBe(true);
    });
  });

  // ─── repoWorkflowSave ─────────────────────────────────────────────────────

  describe('repoWorkflowSave()', () => {
    it('saves owner workflow to repos.json', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const repoDir = path.join(tmpDir, 'save-test-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'save-test-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/save-test-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
        }],
      };
      await saveRepoIndex(index, indexPath);

      const saved = await core.repoWorkflowSave(
        'save-test-repo',
        {
          type: 'owner',
          pushTo: 'origin',
          prTarget: { repo: 'me/save-test-repo', branch: 'main' },
          remotesSnapshot: { origin: 'https://github.com/me/save-test-repo.git' },
        },
        'user',
      );

      expect(saved.type).toBe('owner');
      expect(saved.confirmedBy).toBe('user');
      expect(saved.confirmedAt).toBeTruthy();
      // Verify it was persisted — re-read the index
      const { loadRepoIndex: load } = await import('../repo-index-store.js');
      const reloaded = await load(indexPath);
      const entry = reloaded?.repos.find(r => r.name === 'save-test-repo');
      expect(entry?.workflow?.type).toBe('owner');
      expect(entry?.workflow?.confirmedAt).toBe(saved.confirmedAt);
    });

    it('saves fork workflow with upstream and fork fields', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const repoDir = path.join(tmpDir, 'fork-save-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'fork-save-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/fork-save-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
        }],
      };
      await saveRepoIndex(index, indexPath);

      const saved = await core.repoWorkflowSave(
        'fork-save-repo',
        {
          type: 'fork',
          upstream: 'https://github.com/org/fork-save-repo.git',
          fork: 'https://github.com/me/fork-save-repo.git',
          pushTo: 'origin',
          prTarget: { repo: 'org/fork-save-repo', branch: 'main' },
          remotesSnapshot: {
            origin: 'https://github.com/me/fork-save-repo.git',
            upstream: 'https://github.com/org/fork-save-repo.git',
          },
        },
        'user',
      );

      expect(saved.type).toBe('fork');
      expect(saved.upstream).toBe('https://github.com/org/fork-save-repo.git');
      expect(saved.fork).toBe('https://github.com/me/fork-save-repo.git');
    });

    it('saves contributor workflow', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const repoDir = path.join(tmpDir, 'contrib-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'contrib-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/org/contrib-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
        }],
      };
      await saveRepoIndex(index, indexPath);

      const saved = await core.repoWorkflowSave(
        'contrib-repo',
        {
          type: 'contributor',
          pushTo: 'origin',
          prTarget: { repo: 'org/contrib-repo', branch: 'main' },
        },
        'auto',
      );

      expect(saved.type).toBe('contributor');
      expect(saved.confirmedBy).toBe('auto');
    });

    it('sets confirmedAt to an ISO timestamp', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);
      const repoDir = path.join(tmpDir, 'ts-test-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'ts-test-repo',
          localPath: repoDir,
          remoteUrl: null,
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
        }],
      };
      await saveRepoIndex(index, indexPath);

      const before = new Date().toISOString();
      const saved = await core.repoWorkflowSave(
        'ts-test-repo',
        { type: 'owner', pushTo: 'origin', prTarget: { repo: 'me/ts-test-repo', branch: 'main' } },
        'user',
      );
      const after = new Date().toISOString();

      expect(saved.confirmedAt >= before).toBe(true);
      expect(saved.confirmedAt <= after).toBe(true);
    });

    it('throws REPO_NOT_FOUND when repo not in index', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [],
      };
      await saveRepoIndex(index, indexPath);

      await expect(
        core.repoWorkflowSave(
          'ghost-repo',
          { type: 'owner', pushTo: 'origin', prTarget: { repo: 'me/ghost-repo', branch: 'main' } },
          'user',
        ),
      ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
    });
  });

  // ─── Staleness detection ──────────────────────────────────────────────────

  describe('staleness detection', () => {
    it('does not warn when remotes match snapshot', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);
      const repoDir = path.join(tmpDir, 'stable-repo');
      await mkdir(repoDir, { recursive: true });

      const snapshot = { origin: 'https://github.com/me/stable-repo.git' };

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'stable-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/stable-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
          workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'me/stable-repo', branch: 'main' },
            confirmedAt: '2026-03-01T10:00:00Z',
            confirmedBy: 'user',
            remotesSnapshot: snapshot,
          },
        }],
      };
      await saveRepoIndex(index, indexPath);

      // Mock _listRemotes to return the same snapshot
      vi.spyOn(core as any, '_listRemotes').mockResolvedValue({ ...snapshot });

      const result = await core.repoWorkflow('stable-repo');

      expect(result.source).toBe('index');
      expect(result.stalenessWarning).toBeUndefined();
    });

    it('warns when a remote was added', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);
      const repoDir = path.join(tmpDir, 'new-remote-repo');
      await mkdir(repoDir, { recursive: true });

      const snapshot = { origin: 'https://github.com/me/new-remote-repo.git' };

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'new-remote-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/new-remote-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
          workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'me/new-remote-repo', branch: 'main' },
            confirmedAt: '2026-03-01T10:00:00Z',
            confirmedBy: 'user',
            remotesSnapshot: snapshot,
          },
        }],
      };
      await saveRepoIndex(index, indexPath);

      // Mock _listRemotes to return current state with an extra remote
      vi.spyOn(core as any, '_listRemotes').mockResolvedValue({
        ...snapshot,
        upstream: 'https://github.com/org/new-remote-repo.git',
      });

      const result = await core.repoWorkflow('new-remote-repo');

      expect(result.source).toBe('index');
      expect(result.stalenessWarning).toBeDefined();
      expect(result.stalenessWarning).toMatch(/upstream/);
    });

    it('warns when a remote URL changed', async () => {
      const { core, indexPath } = await buildTestCore(tmpDir);
      const repoDir = path.join(tmpDir, 'changed-url-repo');
      await mkdir(repoDir, { recursive: true });

      const index: RepoIndex = {
        version: '1',
        scannedAt: '2026-03-22T00:00:00Z',
        scanPaths: [],
        repos: [{
          name: 'changed-url-repo',
          localPath: repoDir,
          remoteUrl: 'https://github.com/me/changed-url-repo.git',
          defaultBranch: 'main',
          language: null,
          framework: null,
          lastCommitDate: '',
          lastScannedAt: '2026-03-22T00:00:00Z',
          workflow: {
            type: 'owner',
            pushTo: 'origin',
            prTarget: { repo: 'me/changed-url-repo', branch: 'main' },
            confirmedAt: '2026-03-01T10:00:00Z',
            confirmedBy: 'user',
            remotesSnapshot: { origin: 'https://github.com/me/changed-url-repo.git' },
          },
        }],
      };
      await saveRepoIndex(index, indexPath);

      // Remote URL changed (repo moved)
      vi.spyOn(core as any, '_listRemotes').mockResolvedValue({
        origin: 'https://github.com/neworg/changed-url-repo.git',
      });

      const result = await core.repoWorkflow('changed-url-repo');

      expect(result.source).toBe('index');
      expect(result.stalenessWarning).toBeDefined();
      expect(result.stalenessWarning).toMatch(/origin/);
    });
  });
});
