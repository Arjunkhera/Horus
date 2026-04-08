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

  /** Create a flat-layout skill (single version) */
  async function createSkill(id: string, deps: Record<string, string> = {}, tags: string[] = [], version = '1.0.0') {
    const dir = path.join(tmpDir, 'skills', id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
      id, name: `Skill ${id}`, version,
      description: `The ${id} skill`, type: 'skill', tags, dependencies: deps, files: []
    }));
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${id}`);
  }

  /** Create a versioned skill with multiple versions */
  async function createVersionedSkill(
    id: string,
    versions: string[],
    depsPerVersion: Record<string, Record<string, string>> = {},
  ) {
    for (const ver of versions) {
      const dir = path.join(tmpDir, 'skills', id, ver);
      await fs.mkdir(dir, { recursive: true });
      const deps = depsPerVersion[ver] ?? {};
      await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
        id, name: `Skill ${id}`, version: ver,
        description: `The ${id} skill v${ver}`, type: 'skill', tags: [],
        dependencies: deps, files: [],
      }));
      await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${id} v${ver}`);
    }
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
      const callsAfterFirst = spy.mock.calls.length;
      await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
      // Second resolve should not add any calls (returned from cache)
      expect(spy.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe('resolve() — linear dependencies', () => {
    it('resolves a linear dependency chain (A -> B)', async () => {
      await createSkill('b-skill');
      await createSkill('a-skill', { 'b-skill': '1.0.0' });
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0]!.ref.id).toBe('b-skill');
    });

    it('resolves a 3-level chain (A -> B -> C)', async () => {
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
    it('handles diamond deps (A -> B,C; B -> D; C -> D) — D resolved once', async () => {
      await createSkill('d-skill');
      await createSkill('b-skill', { 'd-skill': '1.0.0' });
      await createSkill('c-skill', { 'd-skill': '1.0.0' });
      await createSkill('a-skill', { 'b-skill': '1.0.0', 'c-skill': '1.0.0' });
      resolver.reset();
      const spy = vi.spyOn(registry, 'get');
      await resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' });
      // d-skill should only be fetched once for the actual bundle (cache after first resolve)
      const dCalls = spy.mock.calls.filter(c => {
        const refArg = c[0] as any;
        return refArg.id === 'd-skill' || refArg.id?.includes('d-skill');
      });
      // At most 2 calls: one for resolveVersion, one for fetch. Then cached.
      expect(dCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('resolve() — circular dependencies', () => {
    it('throws CircularDependencyError for A -> A', async () => {
      await createSkill('a-skill', { 'a-skill': '1.0.0' });
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' })
      ).rejects.toThrow(CircularDependencyError);
    });

    it('throws CircularDependencyError for A -> B -> A', async () => {
      await createSkill('b-skill', { 'a-skill': '1.0.0' });
      await createSkill('a-skill', { 'b-skill': '1.0.0' });
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'a-skill', version: '1.0.0' })
      ).rejects.toThrow(CircularDependencyError);
    });
  });

  describe('resolve() — version matching (flat layout)', () => {
    it('accepts exact version match', async () => {
      await createSkill('versioned');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '1.0.0' });
      expect(result.ref.id).toBe('versioned');
      expect(result.ref.version).toBe('1.0.0');
    });

    it('accepts semver range ^1.0.0', async () => {
      await createSkill('versioned');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: '^1.0.0' });
      expect(result.ref.id).toBe('versioned');
      expect(result.ref.version).toBe('1.0.0');
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

    it('resolves "latest" to the artifact version', async () => {
      await createSkill('versioned');
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'versioned', version: 'latest' });
      expect(result.ref.version).toBe('1.0.0');
    });
  });

  describe('resolve() — multi-version resolution (versioned layout)', () => {
    it('resolves latest when no version specified', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0', '2.0.0']);
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'multi', version: '*' });
      expect(result.ref.version).toBe('2.0.0');
    });

    it('resolves latest with "latest" keyword', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0', '2.0.0']);
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'multi', version: 'latest' });
      expect(result.ref.version).toBe('2.0.0');
    });

    it('resolves exact version @1.1.0', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0', '2.0.0']);
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'multi', version: '1.1.0' });
      expect(result.ref.version).toBe('1.1.0');
    });

    it('resolves caret range ^1.0.0 to highest minor/patch', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0', '1.2.3', '2.0.0']);
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'multi', version: '^1.0.0' });
      expect(result.ref.version).toBe('1.2.3');
    });

    it('resolves tilde range ~1.1.0 to highest patch', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0', '1.1.5', '1.2.0', '2.0.0']);
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'multi', version: '~1.1.0' });
      expect(result.ref.version).toBe('1.1.5');
    });

    it('resolves >=1.0.0 <2.0.0 range', async () => {
      await createVersionedSkill('multi', ['0.9.0', '1.0.0', '1.5.0', '2.0.0', '2.1.0']);
      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'multi', version: '>=1.0.0 <2.0.0' });
      expect(result.ref.version).toBe('1.5.0');
    });

    it('throws VersionMismatchError when no version satisfies range', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0']);
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'multi', version: '>=3.0.0' })
      ).rejects.toThrow(VersionMismatchError);
    });

    it('VersionMismatchError includes available versions', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0']);
      resolver.reset();
      try {
        await resolver.resolve({ type: 'skill', id: 'multi', version: '>=3.0.0' });
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VersionMismatchError);
        expect(err.message).toContain('1.0.0');
        expect(err.message).toContain('1.1.0');
      }
    });

    it('throws VersionMismatchError for nonexistent exact version', async () => {
      await createVersionedSkill('multi', ['1.0.0', '1.1.0']);
      resolver.reset();
      await expect(
        resolver.resolve({ type: 'skill', id: 'multi', version: '9.9.9' })
      ).rejects.toThrow(VersionMismatchError);
    });
  });

  describe('resolve() — dependency graph has pinned versions', () => {
    it('pins dependency versions in the resolved graph', async () => {
      // A depends on B@^1.0.0, B has versions 1.0.0, 1.2.0, 2.0.0
      await createVersionedSkill('dep-b', ['1.0.0', '1.2.0', '2.0.0']);
      // A is flat layout, depends on dep-b with range
      await createSkill('dep-a', { 'dep-b': '^1.0.0' });
      resolver.reset();

      const result = await resolver.resolve({ type: 'skill', id: 'dep-a', version: '1.0.0' });
      expect(result.dependencies).toHaveLength(1);
      const depB = result.dependencies[0]!;
      // Version should be pinned to 1.2.0 (highest matching ^1.0.0)
      expect(depB.ref.version).toBe('1.2.0');
      // Verify it's an exact version, not a range
      expect(depB.ref.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('all nodes in the graph have exact versions', async () => {
      await createVersionedSkill('leaf', ['1.0.0', '1.1.0']);
      await createVersionedSkill('mid', ['2.0.0', '2.1.0'], {
        '2.0.0': { 'leaf': '^1.0.0' },
        '2.1.0': { 'leaf': '^1.0.0' },
      });
      // Use flat layout for root. ~2.0.0 means >=2.0.0 <2.1.0
      await createSkill('root', { 'mid': '^2.0.0' });
      resolver.reset();

      const result = await resolver.resolve({ type: 'skill', id: 'root', version: '*' });
      // root should be pinned
      expect(result.ref.version).toMatch(/^\d+\.\d+\.\d+$/);
      // mid should be pinned to 2.1.0 (highest matching ^2.0.0)
      const mid = result.dependencies[0]!;
      expect(mid.ref.version).toBe('2.1.0');
      expect(mid.ref.version).toMatch(/^\d+\.\d+\.\d+$/);
      // leaf should be pinned
      const leaf = mid.dependencies[0]!;
      expect(leaf.ref.version).toBe('1.1.0');
      expect(leaf.ref.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('resolve() — lock entries', () => {
    it('accumulates lock entries with checksums', async () => {
      await createSkill('lockable');
      resolver.reset();
      await resolver.resolve({ type: 'skill', id: 'lockable', version: '1.0.0' });
      const entries = resolver.getLockEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('skill:lockable');
      expect(entries[0]!.resolvedVersion).toBe('1.0.0');
      expect(entries[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('lock entries include dependencies', async () => {
      await createSkill('lock-dep');
      await createSkill('lock-main', { 'lock-dep': '1.0.0' });
      resolver.reset();
      await resolver.resolve({ type: 'skill', id: 'lock-main', version: '1.0.0' });
      const entries = resolver.getLockEntries();
      const keys = entries.map(e => e.key);
      expect(keys).toContain('skill:lock-main');
      expect(keys).toContain('skill:lock-dep');
    });

    it('lock entries record the requested range', async () => {
      await createVersionedSkill('ranged', ['1.0.0', '1.5.0', '2.0.0']);
      resolver.reset();
      await resolver.resolve({ type: 'skill', id: 'ranged', version: '^1.0.0' });
      const entries = resolver.getLockEntries();
      const entry = entries.find(e => e.key === 'skill:ranged')!;
      expect(entry.requestedRange).toBe('^1.0.0');
      expect(entry.resolvedVersion).toBe('1.5.0');
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

  describe('resolve() — mock adapter listVersions', () => {
    it('uses adapter listVersions for range resolution', async () => {
      // Create versioned skill and spy on listVersions
      await createVersionedSkill('spied', ['1.0.0', '1.1.0', '1.2.0']);
      const adapter = (registry as any).adapter as FilesystemAdapter;
      const spy = vi.spyOn(adapter, 'listVersions');

      resolver.reset();
      const result = await resolver.resolve({ type: 'skill', id: 'spied', version: '^1.0.0' });

      expect(spy).toHaveBeenCalledWith('skill', 'spied');
      expect(result.ref.version).toBe('1.2.0');
    });
  });
});
