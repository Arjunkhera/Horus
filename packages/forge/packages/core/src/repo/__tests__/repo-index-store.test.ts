import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { saveRepoIndex, loadRepoIndex } from '../repo-index-store.js';
import type { RepoIndex } from '../../models/repo-index.js';

describe('repo-index-store', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'forge-store-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('saveRepoIndex writes valid JSON', async () => {
    const indexPath = path.join(tempDir, 'repos.json');
    const index: RepoIndex = {
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

    await saveRepoIndex(index, indexPath);

    // Verify file exists and contains valid JSON
    const fs = await import('fs/promises');
    const content = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(index);
  });

  it('loadRepoIndex reads it back correctly (round-trip)', async () => {
    const indexPath = path.join(tempDir, 'repos.json');
    const index: RepoIndex = {
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

    await saveRepoIndex(index, indexPath);
    const loaded = await loadRepoIndex(indexPath);

    expect(loaded).toEqual(index);
  });

  it('loadRepoIndex returns null for missing file', async () => {
    const indexPath = path.join(tempDir, 'nonexistent.json');
    const loaded = await loadRepoIndex(indexPath);

    expect(loaded).toBeNull();
  });

  it('loadRepoIndex returns null and warns for malformed file', async () => {
    const indexPath = path.join(tempDir, 'repos.json');
    const fs = await import('fs/promises');
    
    // Write invalid JSON
    await fs.writeFile(indexPath, 'not valid json {]');

    const consoleSpy = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };

    try {
      const loaded = await loadRepoIndex(indexPath);
      expect(loaded).toBeNull();
      expect(warned).toBe(true);
    } finally {
      console.warn = consoleSpy;
    }
  });

  it('creates directory if it does not exist', async () => {
    const indexPath = path.join(tempDir, 'subdir', 'nested', 'repos.json');
    const index: RepoIndex = {
      version: '1',
      scannedAt: '2026-03-01T00:00:00Z',
      scanPaths: [],
      repos: [],
    };

    await saveRepoIndex(index, indexPath);

    const fs = await import('fs/promises');
    const stat = await fs.stat(indexPath);
    expect(stat.isFile()).toBe(true);
  });

  it('handles multiple repos in index', async () => {
    const indexPath = path.join(tempDir, 'repos.json');
    const index: RepoIndex = {
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

    await saveRepoIndex(index, indexPath);
    const loaded = await loadRepoIndex(indexPath);

    expect(loaded?.repos).toHaveLength(2);
    expect(loaded?.repos[0].name).toBe('repo1');
    expect(loaded?.repos[1].name).toBe('repo2');
  });
});
