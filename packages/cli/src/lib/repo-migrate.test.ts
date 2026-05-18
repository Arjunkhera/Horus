import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs to avoid touching the real filesystem
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

// Mock node:os
vi.mock('node:os', () => ({
  default: {
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  },
}));

import { promises as fs } from 'node:fs';
import { inferOrg, migrateRepos } from './repo-migrate.js';
import type { RepoRegistryClient } from '@forge/core';
import { RepoExistsError } from '@forge/core';
import type { RepoIndex } from '@forge/core';

const mockReadFile = vi.mocked(fs.readFile);

// Minimal mock RepoRegistryClient
function makeClient(registerImpl?: (input: unknown) => Promise<unknown>): RepoRegistryClient {
  return {
    register: registerImpl ?? vi.fn().mockResolvedValue({}),
  } as unknown as RepoRegistryClient;
}

function makeReposJson(repos: Partial<RepoIndex['repos'][0]>[] = []): string {
  const index: RepoIndex = {
    version: '1',
    scannedAt: new Date().toISOString(),
    scanPaths: ['/home/testuser/repos'],
    repos: repos.map((r) => ({
      name: r.name ?? 'test-repo',
      localPath: r.localPath ?? '/home/testuser/repos/test-repo',
      // Use 'remoteUrl' in r check to distinguish undefined vs explicitly-null
      remoteUrl: 'remoteUrl' in r ? (r.remoteUrl ?? null) : 'https://github.com/TestOrg/test-repo.git',
      defaultBranch: r.defaultBranch ?? 'main',
      language: r.language ?? null,
      framework: r.framework ?? null,
      lastCommitDate: r.lastCommitDate ?? new Date().toISOString(),
      lastScannedAt: r.lastScannedAt ?? new Date().toISOString(),
      workflow: r.workflow,
    })),
  };
  return JSON.stringify(index);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── inferOrg ──────────────────────────────────────────────────────────────────

describe('inferOrg', () => {
  it('extracts org from SSH remote URLs', () => {
    expect(inferOrg('git@github.com:MyOrg/my-repo.git')).toBe('MyOrg');
  });

  it('extracts org from HTTPS remote URLs', () => {
    expect(inferOrg('https://github.com/AnotherOrg/repo.git')).toBe('AnotherOrg');
  });

  it('extracts org from HTTPS URLs without .git suffix', () => {
    expect(inferOrg('https://github.com/SomeOrg/repo')).toBe('SomeOrg');
  });

  it('extracts org from SSH URL with non-github host', () => {
    expect(inferOrg('git@gitlab.com:MyCompany/project.git')).toBe('MyCompany');
  });

  it('returns null for a URL that has no org segment', () => {
    // e.g. file:///local/path — no matching pattern
    expect(inferOrg('file:///local/path')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(inferOrg('')).toBeNull();
  });
});

// ── migrateRepos — basic success path ────────────────────────────────────────

describe('migrateRepos', () => {
  it('migrates repos with valid remoteUrls', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'repo-a', remoteUrl: 'https://github.com/OrgA/repo-a.git' },
        { name: 'repo-b', remoteUrl: 'git@github.com:OrgB/repo-b.git' },
      ]) as any,
    );

    const registerMock = vi.fn().mockResolvedValue({});
    const client = makeClient(registerMock);

    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.migrated).toEqual(['OrgA/repo-a', 'OrgB/repo-b']);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(registerMock).toHaveBeenCalledTimes(2);
  });

  it('skips repos with no remoteUrl', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'no-remote', remoteUrl: null },
      ]) as any,
    );

    const client = makeClient();
    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toEqual([{ repo: 'no-remote', reason: 'no remoteUrl' }]);
    expect(result.failed).toHaveLength(0);
  });

  it('skips repos where org cannot be inferred', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'local-repo', remoteUrl: 'file:///local/path' },
      ]) as any,
    );

    const client = makeClient();
    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.skipped).toEqual([
      { repo: 'local-repo', reason: 'could not infer org from remoteUrl' },
    ]);
  });

  it('skips repos that are already registered (RepoExistsError)', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'existing-repo', remoteUrl: 'https://github.com/MyOrg/existing-repo.git' },
      ]) as any,
    );

    const registerMock = vi.fn().mockRejectedValue(new RepoExistsError('MyOrg', 'existing-repo'));
    const client = makeClient(registerMock);

    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toEqual([
      { repo: 'MyOrg/existing-repo', reason: 'already registered' },
    ]);
    expect(result.failed).toHaveLength(0);
  });

  it('skips repos with error message containing REPO_EXISTS', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'existing-repo', remoteUrl: 'https://github.com/MyOrg/existing-repo.git' },
      ]) as any,
    );

    const registerMock = vi.fn().mockRejectedValue(new Error('REPO_EXISTS: already registered'));
    const client = makeClient(registerMock);

    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.skipped).toEqual([
      { repo: 'MyOrg/existing-repo', reason: 'already registered' },
    ]);
  });

  it('records failed repos for other errors', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'bad-repo', remoteUrl: 'https://github.com/OrgX/bad-repo.git' },
      ]) as any,
    );

    const registerMock = vi.fn().mockRejectedValue(new Error('Network error'));
    const client = makeClient(registerMock);

    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toEqual([
      { repo: 'OrgX/bad-repo', error: 'Network error' },
    ]);
  });

  // ── dry-run mode ─────────────────────────────────────────────────────────────

  it('dry-run: records migrated as "<org>/<name> (dry-run)" without calling register', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'my-repo', remoteUrl: 'https://github.com/MyOrg/my-repo.git' },
      ]) as any,
    );

    const registerMock = vi.fn();
    const client = makeClient(registerMock);

    const result = await migrateRepos({ from: '/fake/repos.json', dryRun: true, client });

    expect(result.migrated).toEqual(['MyOrg/my-repo (dry-run)']);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('dry-run: still skips repos without remoteUrl', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'no-remote', remoteUrl: null },
      ]) as any,
    );

    const client = makeClient();
    const result = await migrateRepos({ from: '/fake/repos.json', dryRun: true, client });

    expect(result.skipped).toEqual([{ repo: 'no-remote', reason: 'no remoteUrl' }]);
    expect(result.migrated).toHaveLength(0);
  });

  // ── default path ──────────────────────────────────────────────────────────────

  it('uses ~/Horus/data/config/repos.json when no "from" path is given', async () => {
    mockReadFile.mockResolvedValueOnce(makeReposJson([]) as any);

    const client = makeClient();
    await migrateRepos({ client });

    expect(mockReadFile).toHaveBeenCalledWith(
      '/home/testuser/Horus/data/config/repos.json',
      'utf8',
    );
  });

  // ── mixed results ─────────────────────────────────────────────────────────────

  it('handles a mix of success, skip, and failure in one run', async () => {
    mockReadFile.mockResolvedValueOnce(
      makeReposJson([
        { name: 'good-repo', remoteUrl: 'https://github.com/Org/good-repo.git' },
        { name: 'no-remote', remoteUrl: null },
        { name: 'dup-repo', remoteUrl: 'https://github.com/Org/dup-repo.git' },
        { name: 'bad-repo', remoteUrl: 'https://github.com/Org/bad-repo.git' },
      ]) as any,
    );

    const registerMock = vi
      .fn()
      .mockResolvedValueOnce({})                                          // good-repo
      .mockRejectedValueOnce(new RepoExistsError('Org', 'dup-repo'))     // dup-repo
      .mockRejectedValueOnce(new Error('timeout'));                        // bad-repo

    const client = makeClient(registerMock);
    const result = await migrateRepos({ from: '/fake/repos.json', client });

    expect(result.migrated).toEqual(['Org/good-repo']);
    expect(result.skipped).toEqual([
      { repo: 'no-remote', reason: 'no remoteUrl' },
      { repo: 'Org/dup-repo', reason: 'already registered' },
    ]);
    expect(result.failed).toEqual([{ repo: 'Org/bad-repo', error: 'timeout' }]);
  });
});
