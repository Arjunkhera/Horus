import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as toYaml } from 'yaml';
import { FilesystemAdapter } from '../filesystem-adapter.js';
import { ArtifactNotFoundError, InvalidMetadataError } from '../errors.js';

describe('FilesystemAdapter', () => {
  let tmpDir: string;
  let adapter: FilesystemAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'));
    adapter = new FilesystemAdapter(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Helper to create a skill fixture (flat layout)
  async function createSkillFixture(
    id: string,
    overrides: Record<string, unknown> = {}
  ) {
    const dir = path.join(tmpDir, 'skills', id);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      id,
      name: `Skill ${id}`,
      version: '1.0.0',
      description: 'A test skill',
      type: 'skill',
      ...overrides,
    };
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml(meta));
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      `# Skill ${id}\nSome content.`
    );
  }

  // Helper to create a versioned skill fixture
  async function createVersionedSkillFixture(
    id: string,
    version: string,
    overrides: Record<string, unknown> = {}
  ) {
    const dir = path.join(tmpDir, 'skills', id, version);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      id,
      name: `Skill ${id}`,
      version,
      description: `A test skill v${version}`,
      type: 'skill',
      ...overrides,
    };
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml(meta));
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      `# Skill ${id} v${version}\nContent for ${version}.`
    );
  }

  // Helper to create an agent fixture
  async function createAgentFixture(
    id: string,
    overrides: Record<string, unknown> = {}
  ) {
    const dir = path.join(tmpDir, 'agents', id);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      id,
      name: `Agent ${id}`,
      version: '1.0.0',
      description: 'A test agent',
      type: 'agent',
      rootSkill: 'orchestrator',
      ...overrides,
    };
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml(meta));
    await fs.writeFile(
      path.join(dir, 'AGENT.md'),
      `# Agent ${id}\nSome content.`
    );
  }

  // Helper to create a plugin fixture
  async function createPluginFixture(
    id: string,
    overrides: Record<string, unknown> = {}
  ) {
    const dir = path.join(tmpDir, 'plugins', id);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: 'A test plugin',
      type: 'plugin',
      ...overrides,
    };
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml(meta));
  }

  describe('list()', () => {
    it('returns empty array when directory does not exist', async () => {
      const results = await adapter.list('skill');
      expect(results).toEqual([]);
    });

    it('returns parsed metadata for valid skills', async () => {
      await createSkillFixture('developer');
      await createSkillFixture('tester');
      const results = await adapter.list('skill');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id)).toContain('developer');
      expect(results.map((r) => r.id)).toContain('tester');
    });

    it('returns parsed metadata for valid agents', async () => {
      await createAgentFixture('orchestrator');
      await createAgentFixture('delegator');
      const results = await adapter.list('agent');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id)).toContain('orchestrator');
      expect(results.map((r) => r.id)).toContain('delegator');
    });

    it('returns parsed metadata for valid plugins', async () => {
      await createPluginFixture('anvil-sdlc');
      await createPluginFixture('debug-suite');
      const results = await adapter.list('plugin');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id)).toContain('anvil-sdlc');
      expect(results.map((r) => r.id)).toContain('debug-suite');
    });

    it('skips and logs error for malformed metadata.yaml', async () => {
      await createSkillFixture('valid-skill');
      // Create invalid entry
      const badDir = path.join(tmpDir, 'skills', 'bad-skill');
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(
        path.join(badDir, 'metadata.yaml'),
        'not: valid: yaml: [[['
      );
      const results = await adapter.list('skill');
      // Should still return the valid one
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('valid-skill');
    });

    it('skips entries with validation errors', async () => {
      await createSkillFixture('valid-skill');
      // Create entry missing required field (name)
      const badDir = path.join(tmpDir, 'skills', 'incomplete-skill');
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(
        path.join(badDir, 'metadata.yaml'),
        toYaml({ id: 'incomplete-skill', version: '1.0.0', type: 'skill' })
      );
      const results = await adapter.list('skill');
      // Should still return only the valid one
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('valid-skill');
    });

    it('returns latest version metadata for versioned layout', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '1.1.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      const results = await adapter.list('skill');
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('developer');
      expect(results[0]!.version).toBe('2.0.0');
    });

    it('handles mixed flat and versioned artifacts in same type dir', async () => {
      await createSkillFixture('flat-skill');
      await createVersionedSkillFixture('versioned-skill', '1.0.0');
      await createVersionedSkillFixture('versioned-skill', '2.0.0');
      const results = await adapter.list('skill');
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('flat-skill');
      expect(ids).toContain('versioned-skill');
      const versioned = results.find((r) => r.id === 'versioned-skill');
      expect(versioned!.version).toBe('2.0.0');
    });
  });

  describe('read()', () => {
    it('reads a full artifact bundle with metadata and content', async () => {
      await createSkillFixture('developer');
      const bundle = await adapter.read('skill', 'developer');
      expect(bundle.meta.id).toBe('developer');
      expect(bundle.content).toContain('# Skill developer');
      expect(bundle.contentPath).toBe('SKILL.md');
    });

    it('reads an agent bundle with AGENT.md content', async () => {
      await createAgentFixture('orchestrator');
      const bundle = await adapter.read('agent', 'orchestrator');
      expect(bundle.meta.id).toBe('orchestrator');
      expect(bundle.content).toContain('# Agent orchestrator');
      expect(bundle.contentPath).toBe('AGENT.md');
    });

    it('reads a plugin bundle without requiring content file', async () => {
      await createPluginFixture('anvil-sdlc');
      const bundle = await adapter.read('plugin', 'anvil-sdlc');
      expect(bundle.meta.id).toBe('anvil-sdlc');
      expect(bundle.content).toBe('');
      expect(bundle.contentPath).toBe('PLUGIN.md');
    });

    it('throws ArtifactNotFoundError when artifact does not exist', async () => {
      await expect(adapter.read('skill', 'nonexistent')).rejects.toThrow(
        ArtifactNotFoundError
      );
    });

    it('treats SKILL.md as opaque string — does not parse it', async () => {
      await createSkillFixture('opaque');
      const dir = path.join(tmpDir, 'skills', 'opaque');
      const rawContent = '# Some {{template}} content\n---\nkey: value\n---';
      await fs.writeFile(path.join(dir, 'SKILL.md'), rawContent);
      const bundle = await adapter.read('skill', 'opaque');
      expect(bundle.content).toBe(rawContent);
    });

    it('throws InvalidMetadataError for invalid metadata', async () => {
      const dir = path.join(tmpDir, 'skills', 'bad');
      await fs.mkdir(dir, { recursive: true });
      // Missing required fields
      await fs.writeFile(
        path.join(dir, 'metadata.yaml'),
        toYaml({ id: 'bad', type: 'skill' })
      );
      await expect(adapter.read('skill', 'bad')).rejects.toThrow(
        InvalidMetadataError
      );
    });

    it('preserves special characters and formatting in content', async () => {
      await createSkillFixture('special');
      const dir = path.join(tmpDir, 'skills', 'special');
      const specialContent = `# Header
\`\`\`typescript
interface Foo {
  bar: string;
  baz: number;
}
\`\`\`

Some text with "quotes" and 'apostrophes'.
Tabs:	here	and	there.
`;
      await fs.writeFile(path.join(dir, 'SKILL.md'), specialContent);
      const bundle = await adapter.read('skill', 'special');
      expect(bundle.content).toBe(specialContent);
    });

    it('reads latest version from versioned layout when no version specified', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '1.1.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      const bundle = await adapter.read('skill', 'developer');
      expect(bundle.meta.id).toBe('developer');
      expect(bundle.meta.version).toBe('2.0.0');
      expect(bundle.content).toContain('v2.0.0');
    });

    it('reads specific version when @version suffix is provided', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '1.1.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      const bundle = await adapter.read('skill', 'developer@1.1.0');
      expect(bundle.meta.id).toBe('developer');
      expect(bundle.meta.version).toBe('1.1.0');
      expect(bundle.content).toContain('v1.1.0');
    });

    it('throws ArtifactNotFoundError for nonexistent version', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await expect(
        adapter.read('skill', 'developer@9.9.9')
      ).rejects.toThrow(ArtifactNotFoundError);
    });

    it('correctly resolves latest across unordered semver versions', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '10.0.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      const bundle = await adapter.read('skill', 'developer');
      expect(bundle.meta.version).toBe('10.0.0');
    });

    it('handles prerelease versions in semver sort', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '2.0.0-beta.1');
      await createVersionedSkillFixture('developer', '2.0.0');
      const bundle = await adapter.read('skill', 'developer');
      expect(bundle.meta.version).toBe('2.0.0');
    });
  });

  describe('exists()', () => {
    it('returns true when artifact exists', async () => {
      await createSkillFixture('developer');
      expect(await adapter.exists('skill', 'developer')).toBe(true);
    });

    it('returns false when artifact does not exist', async () => {
      expect(await adapter.exists('skill', 'nonexistent')).toBe(false);
    });

    it('returns true for agent that exists', async () => {
      await createAgentFixture('orchestrator');
      expect(await adapter.exists('agent', 'orchestrator')).toBe(true);
    });

    it('returns true for plugin that exists', async () => {
      await createPluginFixture('anvil-sdlc');
      expect(await adapter.exists('plugin', 'anvil-sdlc')).toBe(true);
    });

    it('returns true for versioned artifact without version suffix', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      expect(await adapter.exists('skill', 'developer')).toBe(true);
    });

    it('returns true for specific existing version', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      expect(await adapter.exists('skill', 'developer@1.0.0')).toBe(true);
    });

    it('returns false for nonexistent version', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      expect(await adapter.exists('skill', 'developer@9.9.9')).toBe(false);
    });
  });

  describe('write()', () => {
    it('creates artifact directory and writes metadata and content', async () => {
      const bundle = {
        meta: {
          id: 'new-skill',
          name: 'New Skill',
          version: '1.0.0',
          description: 'Test',
          type: 'skill' as const,
          tags: [],
          dependencies: {},
          files: [],
        },
        content: '# New Skill\nHello.',
        contentPath: 'SKILL.md',
      };
      await adapter.write('skill', 'new-skill', bundle);
      expect(await adapter.exists('skill', 'new-skill')).toBe(true);
      const readBack = await adapter.read('skill', 'new-skill');
      expect(readBack.meta.id).toBe('new-skill');
      expect(readBack.content).toBe('# New Skill\nHello.');
    });

    it('writes agent with AGENT.md', async () => {
      const bundle = {
        meta: {
          id: 'new-agent',
          name: 'New Agent',
          version: '1.0.0',
          description: 'Test',
          type: 'agent' as const,
          rootSkill: 'orchestrator',
          tags: [],
          skills: [],
          dependencies: {},
        },
        content: '# New Agent\nHello.',
        contentPath: 'AGENT.md',
      };
      await adapter.write('agent', 'new-agent', bundle);
      expect(await adapter.exists('agent', 'new-agent')).toBe(true);
      const readBack = await adapter.read('agent', 'new-agent');
      expect(readBack.meta.id).toBe('new-agent');
      expect(readBack.content).toBe('# New Agent\nHello.');
    });

    it('writes plugin without content file', async () => {
      const bundle = {
        meta: {
          id: 'new-plugin',
          name: 'New Plugin',
          version: '1.0.0',
          description: 'Test',
          type: 'plugin' as const,
          tags: [],
          skills: [],
          agents: [],
        },
        content: '',
        contentPath: 'PLUGIN.md',
      };
      await adapter.write('plugin', 'new-plugin', bundle);
      expect(await adapter.exists('plugin', 'new-plugin')).toBe(true);
      const readBack = await adapter.read('plugin', 'new-plugin');
      expect(readBack.meta.id).toBe('new-plugin');
    });

    it('overwrites existing artifact', async () => {
      await createSkillFixture('overwrite-test');
      const bundle = {
        meta: {
          id: 'overwrite-test',
          name: 'Updated Name',
          version: '2.0.0',
          description: 'Updated description',
          type: 'skill' as const,
          tags: ['updated'],
          dependencies: {},
          files: [],
        },
        content: '# Updated\nNew content',
        contentPath: 'SKILL.md',
      };
      await adapter.write('skill', 'overwrite-test', bundle);
      const readBack = await adapter.read('skill', 'overwrite-test');
      expect(readBack.meta.name).toBe('Updated Name');
      expect(readBack.meta.version).toBe('2.0.0');
      expect(readBack.content).toBe('# Updated\nNew content');
    });

    it('creates nested directories as needed', async () => {
      const bundle = {
        meta: {
          id: 'nested-skill',
          name: 'Nested Skill',
          version: '1.0.0',
          description: 'Test',
          type: 'skill' as const,
          tags: [],
          dependencies: {},
          files: [],
        },
        content: '# Nested',
        contentPath: 'SKILL.md',
      };
      // Start with empty directory
      await adapter.write('skill', 'nested-skill', bundle);
      const exists = await adapter.exists('skill', 'nested-skill');
      expect(exists).toBe(true);
    });

    it('writes to versioned directory when artifact already uses versioned layout', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      const bundle = {
        meta: {
          id: 'developer',
          name: 'Skill developer',
          version: '2.0.0',
          description: 'Updated',
          type: 'skill' as const,
          tags: [],
          dependencies: {},
          files: [],
        },
        content: '# Developer v2\nNew version.',
        contentPath: 'SKILL.md',
      };
      await adapter.write('skill', 'developer', bundle);
      // Both versions should now exist
      const versions = await adapter.listVersions('skill', 'developer');
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('2.0.0');
      // Reading without version should get latest
      const latest = await adapter.read('skill', 'developer');
      expect(latest.meta.version).toBe('2.0.0');
      // Reading old version should still work
      const old = await adapter.read('skill', 'developer@1.0.0');
      expect(old.meta.version).toBe('1.0.0');
    });
  });

  describe('multiple artifact types', () => {
    it('maintains separate directories for skills and agents', async () => {
      await createSkillFixture('multi-test');
      await createAgentFixture('multi-test');
      const skills = await adapter.list('skill');
      const agents = await adapter.list('agent');
      expect(skills).toHaveLength(1);
      expect(agents).toHaveLength(1);
      expect(skills[0]!.id).toBe('multi-test');
      expect(agents[0]!.id).toBe('multi-test');
    });

    it('reads correct artifact even with same ID in different types', async () => {
      await createSkillFixture('shared-id');
      await createAgentFixture('shared-id');
      const skill = await adapter.read('skill', 'shared-id');
      const agent = await adapter.read('agent', 'shared-id');
      expect(skill.meta.type).toBe('skill');
      expect(agent.meta.type).toBe('agent');
      expect(skill.contentPath).toBe('SKILL.md');
      expect(agent.contentPath).toBe('AGENT.md');
    });
  });

  describe('listVersions()', () => {
    it('returns empty array for flat layout artifact', async () => {
      await createSkillFixture('flat-skill');
      const versions = await adapter.listVersions('skill', 'flat-skill');
      expect(versions).toEqual([]);
    });

    it('returns empty array for nonexistent artifact', async () => {
      const versions = await adapter.listVersions('skill', 'nonexistent');
      expect(versions).toEqual([]);
    });

    it('returns sorted versions descending for versioned artifact', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      await createVersionedSkillFixture('developer', '1.1.0');
      const versions = await adapter.listVersions('skill', 'developer');
      expect(versions).toEqual(['2.0.0', '1.1.0', '1.0.0']);
    });

    it('handles prerelease versions correctly', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '2.0.0-beta.1');
      await createVersionedSkillFixture('developer', '2.0.0');
      const versions = await adapter.listVersions('skill', 'developer');
      expect(versions).toEqual(['2.0.0', '2.0.0-beta.1', '1.0.0']);
    });

    it('strips @version suffix from id before looking up', async () => {
      await createVersionedSkillFixture('developer', '1.0.0');
      await createVersionedSkillFixture('developer', '2.0.0');
      const versions = await adapter.listVersions('skill', 'developer@1.0.0');
      expect(versions).toEqual(['2.0.0', '1.0.0']);
    });
  });

  describe('readResourceFile()', () => {
    it('reads resource file from flat layout', async () => {
      await createSkillFixture('with-resource');
      const resDir = path.join(tmpDir, 'skills', 'with-resource', 'resources');
      await fs.mkdir(resDir, { recursive: true });
      await fs.writeFile(path.join(resDir, 'data.txt'), 'hello resource');
      const content = await adapter.readResourceFile('skill', 'with-resource', 'resources/data.txt');
      expect(content).toBe('hello resource');
    });

    it('reads resource file from versioned layout (latest)', async () => {
      await createVersionedSkillFixture('with-resource', '1.0.0');
      await createVersionedSkillFixture('with-resource', '2.0.0');
      const resDir = path.join(tmpDir, 'skills', 'with-resource', '2.0.0', 'resources');
      await fs.mkdir(resDir, { recursive: true });
      await fs.writeFile(path.join(resDir, 'data.txt'), 'v2 resource');
      const content = await adapter.readResourceFile('skill', 'with-resource', 'resources/data.txt');
      expect(content).toBe('v2 resource');
    });

    it('reads resource file from specific version', async () => {
      await createVersionedSkillFixture('with-resource', '1.0.0');
      await createVersionedSkillFixture('with-resource', '2.0.0');
      const resDir = path.join(tmpDir, 'skills', 'with-resource', '1.0.0', 'resources');
      await fs.mkdir(resDir, { recursive: true });
      await fs.writeFile(path.join(resDir, 'data.txt'), 'v1 resource');
      const content = await adapter.readResourceFile('skill', 'with-resource@1.0.0', 'resources/data.txt');
      expect(content).toBe('v1 resource');
    });

    it('returns null for missing resource file', async () => {
      await createSkillFixture('no-resource');
      const content = await adapter.readResourceFile('skill', 'no-resource', 'resources/missing.txt');
      expect(content).toBeNull();
    });
  });

  describe('version detection', () => {
    it('treats directory with metadata.yaml as flat even if it also has semver-named dirs', async () => {
      // If metadata.yaml exists at root level, it's flat
      await createSkillFixture('hybrid');
      // Also create a versioned-looking subdirectory
      const vDir = path.join(tmpDir, 'skills', 'hybrid', '1.0.0');
      await fs.mkdir(vDir, { recursive: true });
      // Should still read from flat layout
      const bundle = await adapter.read('skill', 'hybrid');
      expect(bundle.meta.id).toBe('hybrid');
      expect(bundle.meta.version).toBe('1.0.0');
    });

    it('ignores non-semver directories in versioned layout detection', async () => {
      // Create an artifact dir with some non-semver subdirs and semver ones
      const baseDir = path.join(tmpDir, 'skills', 'mixed-dirs');
      await fs.mkdir(baseDir, { recursive: true });
      // Non-semver dir
      const otherDir = path.join(baseDir, 'docs');
      await fs.mkdir(otherDir, { recursive: true });
      // Semver dir
      await createVersionedSkillFixture('mixed-dirs', '1.0.0');
      const versions = await adapter.listVersions('skill', 'mixed-dirs');
      expect(versions).toEqual(['1.0.0']);
      // Non-semver dir should be ignored
      expect(versions).not.toContain('docs');
    });
  });
});
