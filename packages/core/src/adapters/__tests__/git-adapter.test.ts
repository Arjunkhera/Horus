import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { stringify as toYaml } from 'yaml';
import { GitAdapter } from '../git-adapter.js';
import { AdapterError } from '../errors.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers — create a local bare git repo as a fixture
// ---------------------------------------------------------------------------

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

/**
 * Creates a local bare git repo with a registry layout:
 *   registry/skills/{id}/metadata.yaml + SKILL.md
 *
 * Returns the path to the bare repo (usable as a clone URL).
 */
async function createBareRepoFixture(
  tmpDir: string,
  skills: Array<{ id: string; name: string; version: string; description: string }>
): Promise<string> {
  const workDir = path.join(tmpDir, 'work');
  const bareDir = path.join(tmpDir, 'bare.git');

  // Create bare repo
  await fs.mkdir(bareDir, { recursive: true });
  await git(['init', '--bare'], bareDir);

  // Create working repo, add content, push to bare
  await fs.mkdir(workDir, { recursive: true });
  await git(['init'], workDir);
  await git(['remote', 'add', 'origin', bareDir], workDir);
  await git(['config', 'user.email', 'test@test.com'], workDir);
  await git(['config', 'user.name', 'Test'], workDir);

  // Create registry directory with skills
  for (const skill of skills) {
    const skillDir = path.join(workDir, 'registry', 'skills', skill.id);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'metadata.yaml'),
      toYaml({
        id: skill.id,
        name: skill.name,
        version: skill.version,
        description: skill.description,
        type: 'skill',
        tags: [],
        dependencies: {},
        files: [],
      })
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `# ${skill.name}\n\n${skill.description}`
    );
  }

  await git(['add', '.'], workDir);
  await git(['commit', '-m', 'Initial registry'], workDir);
  await git(['push', 'origin', 'HEAD:main'], workDir);

  return bareDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitAdapter', () => {
  let tmpDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-git-test-'));
    cacheDir = path.join(tmpDir, 'cache');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('clone and list', () => {
    it('clones repo and lists skills via FilesystemAdapter', async () => {
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'developer', name: 'Developer', version: '1.0.0', description: 'Dev skill' },
        { id: 'tester', name: 'Tester', version: '1.0.0', description: 'Test skill' },
      ]);

      const adapter = new GitAdapter({
        url: bareRepo,
        ref: 'main',
        cacheDir,
      });

      const skills = await adapter.list('skill');
      const ids = skills.map((s) => s.id).sort();
      expect(ids).toEqual(['developer', 'tester']);
    });

    it('reads a specific skill after cloning', async () => {
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'developer', name: 'Developer Skill', version: '2.0.0', description: 'Implements stories' },
      ]);

      const adapter = new GitAdapter({
        url: bareRepo,
        ref: 'main',
        cacheDir,
      });

      const bundle = await adapter.read('skill', 'developer');
      expect(bundle.meta.id).toBe('developer');
      expect(bundle.meta.version).toBe('2.0.0');
      expect(bundle.content).toContain('Developer Skill');
    });

    it('exists() returns true for existing artifact', async () => {
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'developer', name: 'Developer', version: '1.0.0', description: 'Dev skill' },
      ]);

      const adapter = new GitAdapter({ url: bareRepo, ref: 'main', cacheDir });
      expect(await adapter.exists('skill', 'developer')).toBe(true);
      expect(await adapter.exists('skill', 'nonexistent')).toBe(false);
    });
  });

  describe('fetch and update', () => {
    it('fetches updates on subsequent access', async () => {
      const workDir = path.join(tmpDir, 'work');
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'original', name: 'Original', version: '1.0.0', description: 'First skill' },
      ]);

      // First access — clone
      const adapter = new GitAdapter({ url: bareRepo, ref: 'main', cacheDir });
      let skills = await adapter.list('skill');
      expect(skills.map((s) => s.id)).toEqual(['original']);

      // Add a new skill to the repo
      const newSkillDir = path.join(workDir, 'registry', 'skills', 'added');
      await fs.mkdir(newSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(newSkillDir, 'metadata.yaml'),
        toYaml({
          id: 'added',
          name: 'Added Skill',
          version: '1.0.0',
          description: 'Added after clone',
          type: 'skill',
          tags: [],
          dependencies: {},
          files: [],
        })
      );
      await fs.writeFile(path.join(newSkillDir, 'SKILL.md'), '# Added');
      await git(['add', '.'], workDir);
      await git(['commit', '-m', 'Add new skill'], workDir);
      await git(['push', 'origin', 'HEAD:main'], workDir);

      // Create a new adapter instance (simulates next run) to force fetch
      const adapter2 = new GitAdapter({ url: bareRepo, ref: 'main', cacheDir });
      skills = await adapter2.list('skill');
      const ids = skills.map((s) => s.id).sort();
      expect(ids).toEqual(['added', 'original']);
    });
  });

  describe('cache directory', () => {
    it('uses hashed cache directory under configured cacheDir', () => {
      const adapter = new GitAdapter({
        url: 'https://github.com/example/registry.git',
        cacheDir,
      });
      const dir = adapter.getCacheDir();
      expect(dir.startsWith(cacheDir)).toBe(true);
      // Should be a hash-based directory name
      expect(path.basename(dir)).toMatch(/^[a-f0-9]+$/);
    });

    it('produces different cache dirs for different URLs', () => {
      const a1 = new GitAdapter({ url: 'https://github.com/org/repo-a.git', cacheDir });
      const a2 = new GitAdapter({ url: 'https://github.com/org/repo-b.git', cacheDir });
      expect(a1.getCacheDir()).not.toBe(a2.getCacheDir());
    });
  });

  describe('ref support', () => {
    it('defaults to main branch', async () => {
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'dev', name: 'Dev', version: '1.0.0', description: 'Test' },
      ]);

      // No ref specified — should default to 'main'
      const adapter = new GitAdapter({ url: bareRepo, cacheDir });
      const skills = await adapter.list('skill');
      expect(skills).toHaveLength(1);
    });

    it('supports custom branch ref', async () => {
      const workDir = path.join(tmpDir, 'work');
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'main-skill', name: 'Main Skill', version: '1.0.0', description: 'On main' },
      ]);

      // Create a 'develop' branch with a different skill
      await git(['checkout', '-b', 'develop'], workDir);
      const devSkillDir = path.join(workDir, 'registry', 'skills', 'dev-only');
      await fs.mkdir(devSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(devSkillDir, 'metadata.yaml'),
        toYaml({
          id: 'dev-only',
          name: 'Dev Only',
          version: '1.0.0',
          description: 'Only on develop',
          type: 'skill',
          tags: [],
          dependencies: {},
          files: [],
        })
      );
      await fs.writeFile(path.join(devSkillDir, 'SKILL.md'), '# Dev Only');
      await git(['add', '.'], workDir);
      await git(['commit', '-m', 'Add dev-only skill'], workDir);
      await git(['push', 'origin', 'HEAD:develop'], workDir);

      // Clone from develop branch
      const adapter = new GitAdapter({
        url: bareRepo,
        ref: 'develop',
        cacheDir: path.join(cacheDir, 'develop'), // separate cache
      });
      const skills = await adapter.list('skill');
      const ids = skills.map((s) => s.id).sort();
      expect(ids).toContain('dev-only');
      expect(ids).toContain('main-skill');
    });
  });

  describe('error handling', () => {
    it('throws AdapterError on clone failure', async () => {
      const adapter = new GitAdapter({
        url: '/nonexistent/repo.git',
        cacheDir,
      });

      await expect(adapter.list('skill')).rejects.toThrow(AdapterError);
    });

    it('AdapterError includes helpful message', async () => {
      const adapter = new GitAdapter({
        url: '/nonexistent/repo.git',
        cacheDir,
      });

      try {
        await adapter.list('skill');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Clone failed');
        expect(err.message).toContain('/nonexistent/repo.git');
      }
    });
  });

  describe('tokenEnv auth', () => {
    it('falls back gracefully when token env is not set', async () => {
      const bareRepo = await createBareRepoFixture(tmpDir, [
        { id: 'dev', name: 'Dev', version: '1.0.0', description: 'Test' },
      ]);

      // tokenEnv points to non-existent var — should warn and use URL as-is
      const adapter = new GitAdapter({
        url: bareRepo,
        tokenEnv: 'FORGE_NONEXISTENT_TOKEN_VAR',
        cacheDir,
      });

      // Should still work since bareRepo is local
      const skills = await adapter.list('skill');
      expect(skills).toHaveLength(1);
    });
  });
});
