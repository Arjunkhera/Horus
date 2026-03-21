import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createReferenceClone, RepoCloneError } from '../repo-clone.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

/**
 * Create a local source git repo initialised on `defaultBranch` with one commit.
 */
async function createSourceRepo(tmpDir: string, defaultBranch: string): Promise<string> {
  const srcDir = path.join(tmpDir, 'source');
  await fs.mkdir(srcDir, { recursive: true });
  await git(['init', '-b', defaultBranch], srcDir);
  await git(['config', 'user.email', 'test@test.com'], srcDir);
  await git(['config', 'user.name', 'Test'], srcDir);
  await fs.writeFile(path.join(srcDir, 'README.md'), '# test');
  await git(['add', '.'], srcDir);
  await git(['commit', '-m', 'init'], srcDir);
  return srcDir;
}

describe('createReferenceClone', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-clone-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('stale defaultBranch in index (the bug)', () => {
    it('succeeds when index says master but actual default branch is main', async () => {
      const srcDir = await createSourceRepo(tmpDir, 'main');
      const destDir = path.join(tmpDir, 'clone');

      const result = await createReferenceClone({
        localPath: srcDir,
        remoteUrl: null,
        destPath: destDir,
        branchName: 'feature/my-fix',
        defaultBranch: 'master', // stale — actual is main
      });

      expect(result.actualDefaultBranch).toBe('main');

      const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], destDir);
      expect(currentBranch).toBe('feature/my-fix');
    });

    it('succeeds when index says main but actual default branch is master', async () => {
      const srcDir = await createSourceRepo(tmpDir, 'master');
      const destDir = path.join(tmpDir, 'clone');

      const result = await createReferenceClone({
        localPath: srcDir,
        remoteUrl: null,
        destPath: destDir,
        branchName: 'feature/my-fix',
        defaultBranch: 'main', // stale — actual is master
      });

      expect(result.actualDefaultBranch).toBe('master');

      const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], destDir);
      expect(currentBranch).toBe('feature/my-fix');
    });

    it('returns correct actualDefaultBranch when index value is already correct', async () => {
      const srcDir = await createSourceRepo(tmpDir, 'main');
      const destDir = path.join(tmpDir, 'clone');

      const result = await createReferenceClone({
        localPath: srcDir,
        remoteUrl: null,
        destPath: destDir,
        branchName: 'feature/my-fix',
        defaultBranch: 'main', // correct
      });

      expect(result.actualDefaultBranch).toBe('main');
    });
  });

  describe('no branchName (stay on default)', () => {
    it('stays on detected default branch and returns it', async () => {
      const srcDir = await createSourceRepo(tmpDir, 'main');
      const destDir = path.join(tmpDir, 'clone');

      const result = await createReferenceClone({
        localPath: srcDir,
        remoteUrl: null,
        destPath: destDir,
        defaultBranch: 'master', // stale
      });

      expect(result.actualDefaultBranch).toBe('main');

      const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], destDir);
      expect(currentBranch).toBe('main');
    });
  });

  describe('cleanup on failure', () => {
    it('removes the clone directory when branch creation fails', async () => {
      // Create a source repo with an invalid state by making the dest exist but be empty,
      // then use an unreachable localPath to force a git clone failure.
      const destDir = path.join(tmpDir, 'clone');

      await expect(
        createReferenceClone({
          localPath: '/nonexistent/path/to/repo',
          remoteUrl: null,
          destPath: destDir,
          branchName: 'feature/my-fix',
          defaultBranch: 'main',
        }),
      ).rejects.toThrow(RepoCloneError);

      // Destination should not exist (cleaned up)
      const exists = await fs.access(destDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });
});
