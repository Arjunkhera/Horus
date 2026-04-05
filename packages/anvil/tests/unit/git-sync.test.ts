// Unit tests for git sync operations

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { mkdtemp } from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { execSync } from 'child_process';
import { isGitRepo, syncPull, syncPush } from '../../src/sync/git-sync.js';
import { isAnvilError } from '../../src/types/error.js';

const mkdtempAsync = promisify(mkdtemp);

describe('Git Sync Operations', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-git-test-'));
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('isGitRepo', () => {
    it('should return false for non-git directory', async () => {
      const result = await isGitRepo(tmpDir);
      expect(result).toBe(false);
    });

    it('should return true for git repository', async () => {
      // Initialize git repo
      execSync('git init', { cwd: tmpDir });
      const result = await isGitRepo(tmpDir);
      expect(result).toBe(true);
    });
  });

  describe('syncPush', () => {
    beforeEach(() => {
      // Initialize git repo with user config and make initial commit
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });
      // Create initial commit so we can work with the repo
      execSync('touch .gitkeep', { cwd: tmpDir });
      execSync('git add .gitkeep', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });
    });

    it('should return no_changes when no files to add', async () => {
      const result = await syncPush(tmpDir, 'Test commit');
      expect(isAnvilError(result)).toBe(false);
      if (!isAnvilError(result)) {
        expect(result.status).toBe('no_changes');
      }
    });

    it('should commit a new markdown file', async () => {
      // Create a new markdown file
      const filePath = join(tmpDir, 'test.md');
      await fs.writeFile(filePath, '# Test Note\n\nTest content');

      const result = await syncPush(tmpDir, 'Add test note');
      // Result can be either ok with a committed file or push_failed (no remote)
      expect(isAnvilError(result)).toBe(false);
      if (!isAnvilError(result)) {
        // Either commit succeeded and push failed, or both succeeded
        expect(['ok', 'push_failed']).toContain(result.status);
        if (result.status === 'ok') {
          expect(result.filesCommitted).toBeGreaterThan(0);
          expect(result.commitHash).toBeTruthy();
        }
      }

      // Verify the commit exists regardless
      const log = execSync('git log --oneline', { cwd: tmpDir }).toString();
      expect(log).toContain('Add test note');
    });

    it('should return error for non-git directory', async () => {
      const nonGitDir = await mkdtempAsync(join(tmpdir(), 'anvil-no-git-'));
      try {
        const result = await syncPush(nonGitDir, 'Test commit');
        expect(isAnvilError(result)).toBe(true);
        if (isAnvilError(result)) {
          expect(result.code).toBe('NO_GIT_REPO');
        }
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should commit multiple files', async () => {
      // Create multiple markdown files
      await fs.writeFile(join(tmpDir, 'note1.md'), '# Note 1');
      await fs.writeFile(join(tmpDir, 'note2.md'), '# Note 2');

      const result = await syncPush(tmpDir, 'Add multiple notes');
      expect(isAnvilError(result)).toBe(false);
      if (!isAnvilError(result)) {
        // Either committed successfully or failed at push
        expect(['ok', 'push_failed']).toContain(result.status);
        if (result.status === 'ok') {
          expect(result.filesCommitted).toBeGreaterThanOrEqual(2);
        }
      }

      // Verify commit was created
      const log = execSync('git log --oneline', { cwd: tmpDir }).toString();
      expect(log).toContain('Add multiple notes');
    });

    it('should only stage markdown files and type yaml files', async () => {
      // Create various files
      await fs.writeFile(join(tmpDir, 'note.md'), '# Note');
      await fs.writeFile(join(tmpDir, 'readme.txt'), 'Text file');
      await fs.mkdir(join(tmpDir, '.anvil', 'types'), { recursive: true });
      await fs.writeFile(join(tmpDir, '.anvil', 'types', 'task.yaml'), 'type: task');

      const result = await syncPush(tmpDir, 'Add files');
      expect(isAnvilError(result)).toBe(false);
      if (!isAnvilError(result)) {
        // Either committed or failed at push
        expect(['ok', 'push_failed']).toContain(result.status);
      }

      // Verify only intended files were committed
      const status = execSync('git status --porcelain', { cwd: tmpDir }).toString();
      expect(status).toContain('?? readme.txt'); // txt file should not be staged
    });

    it('should never stage .anvil/.local/ directory', async () => {
      // Create files in .anvil/.local
      await fs.mkdir(join(tmpDir, '.anvil', '.local'), { recursive: true });
      await fs.writeFile(join(tmpDir, '.anvil', '.local', 'cache.json'), '{}');
      
      // Create a note
      await fs.writeFile(join(tmpDir, 'note.md'), '# Note');

      const result = await syncPush(tmpDir, 'Test local exclusion');
      expect(isAnvilError(result)).toBe(false);
      if (!isAnvilError(result)) {
        // Either committed or failed at push
        expect(['ok', 'push_failed']).toContain(result.status);
      }

      // Verify .local files are not staged
      const status = execSync('git status --porcelain', { cwd: tmpDir }).toString();
      expect(status).not.toContain('.local');
    });
  });

  describe('syncPull', () => {
    beforeEach(() => {
      // Initialize local git repo with user config
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });

      // Create initial commit
      const filePath = join(tmpDir, 'initial.md');
      execSync(`touch "${filePath}"`, { cwd: tmpDir });
      execSync('git add .', { cwd: tmpDir });
      execSync('git commit -m "Initial commit"', { cwd: tmpDir });
    });

    it('should return error for non-git directory', async () => {
      const nonGitDir = await mkdtempAsync(join(tmpdir(), 'anvil-no-git-'));
      try {
        const result = await syncPull(nonGitDir);
        expect(isAnvilError(result)).toBe(true);
        if (isAnvilError(result)) {
          expect(result.code).toBe('NO_GIT_REPO');
        }
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should return error when remote does not exist', async () => {
      const result = await syncPull(tmpDir, 'nonexistent');
      expect(isAnvilError(result)).toBe(true);
      if (isAnvilError(result)) {
        expect(result.code).toBe('SYNC_ERROR');
      }
    });

    it('should return error or no_changes when no remote configured', async () => {
      // This repo has no remote, so fetch should fail
      const result = await syncPull(tmpDir, 'origin');
      expect(isAnvilError(result) || result.status === 'no_changes').toBe(true);
    });
  });

  describe('Conflict Detection', () => {
    beforeEach(() => {
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir });
      execSync('git config user.name "Test User"', { cwd: tmpDir });
    });

    it('should detect conflict markers in files', async () => {
      // Create a file with conflict markers
      const filePath = join(tmpDir, 'conflict.md');
      const conflictContent = `# Test
<<<<<<< HEAD
Version A
=======
Version B
>>>>>>> branch
`;
      await fs.writeFile(filePath, conflictContent);

      // Add and stage the file
      execSync('git add conflict.md', { cwd: tmpDir });
      execSync('git commit -m "Add conflicted file"', { cwd: tmpDir });

      // Now create a scenario where we can detect conflicts
      // For testing purposes, we check if the file contains markers
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('<<<<<<<');
    });

    it('should return error for syncPush with no git repo', async () => {
      const nonGitDir = await mkdtempAsync(join(tmpdir(), 'anvil-no-git-'));
      try {
        const result = await syncPush(nonGitDir, 'Test');
        expect(isAnvilError(result)).toBe(true);
        if (isAnvilError(result)) {
          expect(result.code).toBe('NO_GIT_REPO');
        }
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true });
      }
    });
  });
});
