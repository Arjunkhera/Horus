import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { scan } from '../repo-scanner.js';

const execFileAsync = promisify(execFile);

async function initGitRepo(repoPath: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: repoPath });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
}

async function makeCommit(repoPath: string): Promise<void> {
  const testFile = path.join(repoPath, 'test.txt');
  await writeFile(testFile, 'test content');
  await execFileAsync('git', ['add', '.'], { cwd: repoPath });
  await execFileAsync('git', ['commit', '-m', 'test commit'], { cwd: repoPath });
}

describe('repo-scanner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'forge-scanner-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('scan finds git repos one level deep', async () => {
    const repo1 = path.join(tempDir, 'repo1');
    const repo2 = path.join(tempDir, 'repo2');

    await mkdir(repo1);
    await mkdir(repo2);
    await initGitRepo(repo1);
    await initGitRepo(repo2);
    await makeCommit(repo1);
    await makeCommit(repo2);

    const result = await scan([tempDir]);

    expect(result.repos).toHaveLength(2);
    expect(result.repos.map(r => r.name).sort()).toEqual(['repo1', 'repo2']);
    expect(result.scanPaths).toContain(tempDir);
  });

  it('scan does NOT recurse into subdirectories', async () => {
    const repo1 = path.join(tempDir, 'repo1');
    const nestedDir = path.join(tempDir, 'nested-container');
    const nested = path.join(nestedDir, 'repo2');

    await mkdir(repo1);
    await mkdir(nestedDir);
    await mkdir(nested);
    await initGitRepo(repo1);
    await initGitRepo(nested);
    await makeCommit(repo1);
    await makeCommit(nested);

    const result = await scan([tempDir]);

    // Should only find repo1, not the nested repo2
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].name).toBe('repo1');
  });

  it('scan handles non-git directories correctly (skips them)', async () => {
    const repo1 = path.join(tempDir, 'repo1');
    const nonGit = path.join(tempDir, 'not-a-repo');

    await mkdir(repo1);
    await mkdir(nonGit);
    await initGitRepo(repo1);
    await makeCommit(repo1);

    const result = await scan([tempDir]);

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].name).toBe('repo1');
  });

  it('scan handles empty scan path gracefully', async () => {
    const emptyDir = path.join(tempDir, 'empty');
    await mkdir(emptyDir);

    const result = await scan([emptyDir]);

    expect(result.repos).toHaveLength(0);
    expect(result.scanPaths).toContain(emptyDir);
  });

  it('scan handles missing scan path gracefully (ENOENT)', async () => {
    const missingPath = path.join(tempDir, 'does-not-exist');

    // Should not throw, should return empty repos
    const result = await scan([missingPath]);

    expect(result.repos).toHaveLength(0);
    expect(result.scanPaths).toContain(missingPath);
  });

  it('indexRepo extracts name and localPath correctly', async () => {
    const repo1 = path.join(tempDir, 'my-test-repo');
    await mkdir(repo1);
    await initGitRepo(repo1);
    await makeCommit(repo1);

    const result = await scan([tempDir]);

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].name).toBe('my-test-repo');
    expect(result.repos[0].localPath).toBe(repo1);
  });

  it('detects TypeScript language with tsconfig.json', async () => {
    const repo = path.join(tempDir, 'ts-repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'tsconfig.json'), '{}');
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].language).toBe('TypeScript');
  });

  it('detects JavaScript language with package.json', async () => {
    const repo = path.join(tempDir, 'js-repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'package.json'), '{"name": "test"}');
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].language).toBe('JavaScript');
  });

  it('detects Python language', async () => {
    const repo = path.join(tempDir, 'py-repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'pyproject.toml'), '');
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].language).toBe('Python');
  });

  it('detects Rust language', async () => {
    const repo = path.join(tempDir, 'rust-repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'Cargo.toml'), '');
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].language).toBe('Rust');
  });

  it('detects null language when no marker file found', async () => {
    const repo = path.join(tempDir, 'unknown-repo');
    await mkdir(repo);
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].language).toBeNull();
  });

  it('detects framework from package.json dependencies', async () => {
    const repo = path.join(tempDir, 'express-repo');
    await mkdir(repo);
    const pkgJson = {
      name: 'test',
      dependencies: { express: '^4.0.0' }
    };
    await writeFile(path.join(repo, 'package.json'), JSON.stringify(pkgJson));
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].framework).toBe('express');
  });

  it('prefers next framework when both react and next are present', async () => {
    const repo = path.join(tempDir, 'next-repo');
    await mkdir(repo);
    const pkgJson = {
      name: 'test',
      dependencies: { next: '^13.0.0', react: '^18.0.0' }
    };
    await writeFile(path.join(repo, 'package.json'), JSON.stringify(pkgJson));
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].framework).toBe('next');
  });

  it('returns null framework for non-JS/TS repos', async () => {
    const repo = path.join(tempDir, 'py-repo');
    await mkdir(repo);
    await writeFile(path.join(repo, 'pyproject.toml'), '');
    await initGitRepo(repo);
    await makeCommit(repo);

    const result = await scan([tempDir]);

    expect(result.repos[0].framework).toBeNull();
  });

  it('scan with incremental merge preserves repos from other scan paths', async () => {
    // Create two separate scan directories
    const scanDir1 = path.join(tempDir, 'scan1');
    const scanDir2 = path.join(tempDir, 'scan2');
    await mkdir(scanDir1);
    await mkdir(scanDir2);

    // Create repos in each
    const repo1 = path.join(scanDir1, 'repo1');
    const repo2 = path.join(scanDir2, 'repo2');
    await mkdir(repo1);
    await mkdir(repo2);
    await initGitRepo(repo1);
    await initGitRepo(repo2);
    await makeCommit(repo1);
    await makeCommit(repo2);

    // First scan both directories
    const firstScan = await scan([scanDir1, scanDir2]);
    expect(firstScan.repos).toHaveLength(2);

    // Now scan only scanDir1 but provide the existing index
    const secondScan = await scan([scanDir1], firstScan);

    // Should preserve repo2 from scanDir2
    expect(secondScan.repos).toHaveLength(2);
    expect(secondScan.repos.map(r => r.name).sort()).toEqual(['repo1', 'repo2']);
  });

  it('scan replaces entries for repos found in new scan', async () => {
    const repo = path.join(tempDir, 'repo1');
    await mkdir(repo);
    await initGitRepo(repo);
    await makeCommit(repo);

    // First scan
    const firstScan = await scan([tempDir]);
    const firstScannedAt = firstScan.repos[0].lastScannedAt;

    // Wait a bit and scan again
    await new Promise(resolve => setTimeout(resolve, 10));
    const secondScan = await scan([tempDir], firstScan);

    // Should have same repo but updated lastScannedAt
    expect(secondScan.repos).toHaveLength(1);
    expect(secondScan.repos[0].name).toBe('repo1');
    expect(secondScan.repos[0].lastScannedAt).not.toBe(firstScannedAt);
  });
});
