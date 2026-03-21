import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as toYaml } from 'yaml';
import { Registry } from '../registry.js';
import { FilesystemAdapter } from '../../adapters/filesystem-adapter.js';
import { ArtifactNotFoundError } from '../../adapters/errors.js';

describe('Registry', () => {
  let tmpDir: string;
  let registry: Registry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-registry-test-'));
    registry = new Registry(new FilesystemAdapter(tmpDir));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSkill(id: string, overrides: Record<string, unknown> = {}) {
    const dir = path.join(tmpDir, 'skills', id);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      id,
      name: overrides.name ?? `Skill ${id}`,
      version: '1.0.0',
      description: overrides.description ?? `Description for ${id}`,
      type: 'skill',
      tags: overrides.tags ?? [],
      ...overrides,
    };
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml(meta));
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${id}`);
  }

  describe('search()', () => {
    it('returns empty array when nothing matches', async () => {
      await createSkill('developer');
      const results = await registry.search('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('finds by exact id match with highest score', async () => {
      await createSkill('developer');
      await createSkill('tester');
      const results = await registry.search('developer');
      expect(results[0]!.ref.id).toBe('developer');
      expect(results[0]!.matchedOn).toContain('id');
    });

    it('finds by name substring match', async () => {
      await createSkill('dev', { name: 'Developer Skill' });
      const results = await registry.search('developer');
      expect(results).toHaveLength(1);
      expect(results[0]!.matchedOn).toContain('name');
    });

    it('finds by description substring match', async () => {
      await createSkill('dev', { description: 'Implements stories and writes tests' });
      const results = await registry.search('stories');
      expect(results).toHaveLength(1);
      expect(results[0]!.matchedOn).toContain('description');
    });

    it('finds by tag match', async () => {
      await createSkill('dev', { tags: ['development', 'sdlc'] });
      const results = await registry.search('sdlc');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.matchedOn).toContain('tags');
    });

    it('ranks exact id match higher than substring match', async () => {
      await createSkill('dev');
      await createSkill('developer');
      const results = await registry.search('dev');
      // 'dev' has exact id match, 'developer' has substring id match
      expect(results[0]!.ref.id).toBe('dev');
    });

    it('filters by type', async () => {
      await createSkill('dev');
      // Create an agent too
      const agentDir = path.join(tmpDir, 'agents', 'dev-agent');
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(agentDir, 'metadata.yaml'), toYaml({
        id: 'dev-agent', name: 'Dev Agent', version: '1.0.0',
        description: 'Development agent', type: 'agent', rootSkill: 'dev', tags: []
      }));
      const results = await registry.search('dev', 'skill');
      expect(results.every(r => r.ref.type === 'skill')).toBe(true);
    });

    it('returns results sorted by score descending', async () => {
      await createSkill('dev', { name: 'dev', description: 'dev related' }); // many matches
      await createSkill('tester', { description: 'dev integration' }); // just description
      const results = await registry.search('dev');
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[results.length - 1]!.score);
    });
  });

  describe('get()', () => {
    it('returns bundle for existing artifact', async () => {
      await createSkill('developer');
      const bundle = await registry.get({ type: 'skill', id: 'developer', version: '1.0.0' });
      expect(bundle.meta.id).toBe('developer');
    });

    it('throws ArtifactNotFoundError for missing artifact', async () => {
      await expect(
        registry.get({ type: 'skill', id: 'nonexistent', version: '1.0.0' })
      ).rejects.toThrow(ArtifactNotFoundError);
    });
  });

  describe('list()', () => {
    it('returns empty list when no artifacts', async () => {
      const summaries = await registry.list();
      expect(summaries).toHaveLength(0);
    });

    it('returns summaries for all artifact types', async () => {
      await createSkill('dev');
      const agentDir = path.join(tmpDir, 'agents', 'my-agent');
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(agentDir, 'metadata.yaml'), toYaml({
        id: 'my-agent', name: 'My Agent', version: '1.0.0',
        description: 'An agent', type: 'agent', rootSkill: 'dev', tags: []
      }));
      const summaries = await registry.list();
      expect(summaries).toHaveLength(2);
    });

    it('filters by type when specified', async () => {
      await createSkill('dev');
      const summaries = await registry.list('skill');
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.ref.type).toBe('skill');
    });

    it('summaries include name, description, tags', async () => {
      await createSkill('dev', { name: 'Developer', description: 'Implements stories', tags: ['sdlc'] });
      const summaries = await registry.list('skill');
      expect(summaries[0]!.name).toBe('Developer');
      expect(summaries[0]!.description).toBe('Implements stories');
      expect(summaries[0]!.tags).toContain('sdlc');
    });
  });

  describe('publish()', () => {
    it('writes artifact to adapter', async () => {
      const bundle = {
        meta: { id: 'new-skill', name: 'New Skill', version: '1.0.0', description: 'Test', type: 'skill' as const, tags: [], dependencies: {}, files: [] },
        content: '# New Skill',
        contentPath: 'SKILL.md',
      };
      await registry.publish('skill', 'new-skill', bundle);
      const exists = await new FilesystemAdapter(tmpDir).exists('skill', 'new-skill');
      expect(exists).toBe(true);
    });
  });
});
