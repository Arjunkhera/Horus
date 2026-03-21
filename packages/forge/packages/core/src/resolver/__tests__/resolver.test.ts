import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as toYaml } from 'yaml';
import { Resolver } from '../resolver.js';
import { Registry } from '../../registry/registry.js';
import { FilesystemAdapter } from '../../adapters/filesystem-adapter.js';
import { CircularDependencyError, VersionMismatchError, ArtifactNotFoundError } from '../../adapters/errors.js';

describe('Resolver', () => {
  let tmpDir: string;
  let resolver: Resolver;
  let registry: Registry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-resolver-test-'));
    registry = new Registry(new FilesystemAdapter(tmpDir));
    resolver = new Resolver(registry);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSkill(id: string, deps: Record<string, string> = {}, tags: string[] = []) {
    const dir = path.join(tmpDir, 'skills', id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
      id, name: `Skill ${id}`, version: '1.0.0',
      description: `The ${id} skill`, type: 'skill', tags, dependencies: deps, files: []
    }));
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${id}`);
  }

  async function createPlugin(id: string, skills: string[] = [], agents: string[] = []) {
    const dir = path.join(tmpDir, 'plugins', id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
      id, name: `Plugin ${id}`, version: '1.0.0',
      description: `The ${id} plugin`, type: 'plugin', skills, agents,
    }));
  }

  describe('resolve() — basic cases', () => {
    it('resolves an artifact with no dependencies', async () => {
      await createSkill('developer');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
      expect(result.ref.id).toBe('developer');
      expect(result.dependencies).toHaveLength(0);
    });

    it('throws ArtifactNotFoundError for missing artifact', async () => {
      await expect(
        resolver.resolve({ type: 'skill', id: 'nonexistent', version: '1.0.0' })
      ).rejects.toThrow(ArtifactNotFoundError);
    });

    it('returns cached result on second resolve', async () => {
      await createSkill('developer');
      resolver.reset();
      const spy = vi.spyOn(registry, 'get');
      await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
      await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
      // get() should only be called once (second is from cache)
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolve() — linear dependencies', () => {
    it('resolves a linear dependency chain (A → B)', async () => {
      await createSkill('b-skill');
      await createSkill('a-skill', { 'b-skill': '1.0.0' });
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0]!.ref.id).toBe('b-skill');
    });

    it('resolves a 3-level chain (A → B → C)', async () => {
      await createSkill('c-skill');
      await createSkill('b-skill', { 'c-skill': '1.0.0' });
      await createSkill('a-skill', { 'b-skill': '1.0.0' });
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
      expect(result.dependencies[0]!.ref.id).toBe('b-skill');
      expect(result.dependencies[0]!.dependencies[0]!.ref.id).toBe('c-skill');
    });
  });

  describe('resolve() — diamond dependencies', () => {
    it('handles diamond deps (A → B,C; B → D; C → D) — D resolved once', async () => {
      await createSkill('d-skill');
      await createSkill('b-skill', { 'd-skill': '1.0.0' });
      await createSkill('c-skill', { 'd-skill': '1.0.0' });
      await createSkill('a-skill', { 'b-skill': '1.0.0', 'c-skill': '1.0.0' });
      resolver.reset();
      const spy = vi.spyOn(registry, 'get');
      await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
      // d-skill should only be fetched once due to caching
      const dCalls = spy.mock.calls.filter(c => c[0].id === 'd-skill');
      expect(dCalls).toHaveLength(1);
    });
  });

  describe('resolve() — circular dependencies', () => {
    it('throws CircularDependencyError for A → A', async () => {
      await createSkill('a-skill', { 'a-skill': '1.0.0' });
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' })
      ).rejects.toThrow(CircularDependencyError);
    });

    it('throws CircularDependencyError for A → B → A', async () => {
      await createSkill('b-skill', { 'a-skill': '1.0.0' });
      await createSkill('a-skill', { 'b-skill': '1.0.0' });
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' })
      ).rejects.toThrow(CircularDependencyError);
    });
  });

  describe('resolve() — version matching', () => {
    it('accepts exact version match', async () => {
      await createSkill('versioned');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '1.0.0' });
      expect(result.ref.id).toBe('versioned');
    });

    it('accepts semver range ^1.0.0', async () => {
      await createSkill('versioned');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '^1.0.0' });
      expect(result.ref.id).toBe('versioned');
    });

    it('throws VersionMismatchError when range not satisfied', async () => {
      await createSkill('versioned'); // version 1.0.0
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'versioned', version: '>=2.0.0' })
      ).rejects.toThrow(VersionMismatchError);
    });

    it('accepts wildcard (*) without version check', async () => {
      await createSkill('versioned');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '*' });
      expect(result.ref.id).toBe('versioned');
    });
  });

  describe('resolveAll()', () => {
    it('returns artifacts in dependency order', async () => {
      await createSkill('dep');
      await createSkill('main', { 'dep': '1.0.0' });
      resolver.reset();
      const results = await resolver.resolveAll([
        { type: 'skill', id: 'main', version: '1.0.0' }
      ]);
      const ids = results.map(r => r.ref.id);
      expect(ids.indexOf('dep')).toBeLessThan(ids.indexOf('main'));
    });

    it('deduplicates artifacts', async () => {
      await createSkill('shared');
      resolver.reset();
      const results = await resolver.resolveAll([
        { type: 'skill', id: 'shared', version: '1.0.0' },
        { type: 'skill', id: 'shared', version: '1.0.0' },
      ]);
      expect(results).toHaveLength(1);
    });
  });

  describe('resolve() — plugin skill extraction', () => {
    it('resolves skills listed in a plugin as dependencies', async () => {
      await createSkill('developer');
      await createSkill('tester');
      await createPlugin('my-plugin', ['developer', 'tester']);
      resolver.reset();

      const result = await resolver.resolve({ type: 'plugin', id: 'my-plugin', version: '*' });
      const depIds = result.dependencies.map(d => d.ref.id);
      expect(depIds).toContain('developer');
      expect(depIds).toContain('tester');
    });

    it('includes plugin skills in resolveAll output', async () => {
      await createSkill('developer');
      await createSkill('tester');
      await createPlugin('my-plugin', ['developer', 'tester']);
      resolver.reset();

      const results = await resolver.resolveAll([
        { type: 'plugin', id: 'my-plugin', version: '*' },
      ]);
      const ids = results.map(r => r.ref.id);
      expect(ids).toContain('developer');
      expect(ids).toContain('tester');
      expect(ids).toContain('my-plugin');
    });

    it('resolves plugin skills before the plugin itself', async () => {
      await createSkill('developer');
      await createPlugin('my-plugin', ['developer']);
      resolver.reset();

      const results = await resolver.resolveAll([
        { type: 'plugin', id: 'my-plugin', version: '*' },
      ]);
      const ids = results.map(r => r.ref.id);
      expect(ids.indexOf('developer')).toBeLessThan(ids.indexOf('my-plugin'));
    });

    it('deduplicates skills shared between plugin and direct refs', async () => {
      await createSkill('developer');
      await createPlugin('my-plugin', ['developer']);
      resolver.reset();

      const results = await resolver.resolveAll([
        { type: 'plugin', id: 'my-plugin', version: '*' },
        { type: 'skill', id: 'developer', version: '*' },
      ]);
      const developerEntries = results.filter(r => r.ref.id === 'developer');
      expect(developerEntries).toHaveLength(1);
    });

    it('handles plugin with no skills gracefully', async () => {
      await createPlugin('empty-plugin', []);
      resolver.reset();

      const result = await resolver.resolve({ type: 'plugin', id: 'empty-plugin', version: '*' });
      expect(result.dependencies).toHaveLength(0);
    });
  });
});
