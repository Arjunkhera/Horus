import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Resolver } from '../resolver.js';
import { Registry } from '../../registry/registry.js';
import { FilesystemAdapter } from '../../adapters/filesystem-adapter.js';
import { ArtifactNotFoundError, InheritanceDepthError } from '../../adapters/errors.js';

/** Minimal JSON-to-YAML serialiser (flat enough for test metadata). */
function toYaml(obj: Record<string, unknown>, indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of val) {
          if (typeof item === 'object' && item !== null) {
            lines.push(`${pad}  - ${toYaml(item as Record<string, unknown>, indent + 2).trimStart()}`);
          } else {
            lines.push(`${pad}  - ${JSON.stringify(item)}`);
          }
        }
      }
    } else if (typeof val === 'object') {
      if (Object.keys(val as object).length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(toYaml(val as Record<string, unknown>, indent + 1));
      }
    } else if (typeof val === 'string') {
      lines.push(`${pad}${key}: ${JSON.stringify(val)}`);
    } else {
      lines.push(`${pad}${key}: ${val}`);
    }
  }
  return lines.join('\n');
}

describe('Resolver — workspace inheritance', () => {
  let tmpDir: string;
  let resolver: Resolver;
  let registry: Registry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-inherit-test-'));
    registry = new Registry(new FilesystemAdapter(tmpDir));
    resolver = new Resolver(registry);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Create a workspace-config artifact in the registry */
  async function createWorkspaceConfig(
    id: string,
    overrides: Record<string, unknown> = {},
  ) {
    const dir = path.join(tmpDir, 'workspace-configs', id);
    await fs.mkdir(dir, { recursive: true });
    const meta = {
      id,
      name: `Config ${id}`,
      version: '1.0.0',
      description: `The ${id} workspace config`,
      type: 'workspace-config',
      plugins: [],
      skills: [],
      personas: [],
      mcp_servers: {},
      settings: {},
      git_workflow: {},
      ...overrides,
    };
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml(meta));
    await fs.writeFile(path.join(dir, 'README.md'), `# ${id}`);
  }

  /** Create a flat-layout skill for dependency resolution */
  async function createSkill(id: string, version = '1.0.0') {
    const dir = path.join(tmpDir, 'skills', id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
      id, name: `Skill ${id}`, version,
      description: `The ${id} skill`, type: 'skill', tags: [], dependencies: {}, files: [],
    }));
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${id}`);
  }

  /** Create a flat-layout plugin for dependency resolution */
  async function createPlugin(id: string, skills: string[] = []) {
    const dir = path.join(tmpDir, 'plugins', id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
      id, name: `Plugin ${id}`, version: '1.0.0',
      description: `The ${id} plugin`, type: 'plugin', skills, agents: [],
    }));
  }

  it('child extends parent: merged config has parent plugins + child additions', async () => {
    await createPlugin('parent-plugin');
    await createPlugin('child-plugin');

    await createWorkspaceConfig('base-config', {
      plugins: ['parent-plugin'],
      skills: ['parent-skill'],
    });
    await createSkill('parent-skill');
    await createSkill('child-skill');

    await createWorkspaceConfig('child-config', {
      extends: 'base-config@1.0.0',
      plugins: ['child-plugin'],
      skills: ['child-skill'],
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'child-config',
      version: '*',
    });

    const meta = result.bundle.meta as any;
    expect(meta.plugins).toContain('parent-plugin');
    expect(meta.plugins).toContain('child-plugin');
    expect(meta.skills).toContain('parent-skill');
    expect(meta.skills).toContain('child-skill');
  });

  it('child overrides parent mcp_server config', async () => {
    await createWorkspaceConfig('base-config', {
      mcp_servers: {
        anvil: { description: 'Parent anvil', required: true },
        vault: { description: 'Parent vault', required: true },
      },
    });

    await createWorkspaceConfig('child-config', {
      extends: 'base-config@1.0.0',
      mcp_servers: {
        anvil: { description: 'Child anvil override', required: false },
        forge: { description: 'Child-only forge', required: true },
      },
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'child-config',
      version: '*',
    });

    const meta = result.bundle.meta as any;
    // Child overrides anvil
    expect(meta.mcp_servers.anvil.description).toBe('Child anvil override');
    expect(meta.mcp_servers.anvil.required).toBe(false);
    // Parent's vault is inherited
    expect(meta.mcp_servers.vault.description).toBe('Parent vault');
    // Child adds forge
    expect(meta.mcp_servers.forge.description).toBe('Child-only forge');
  });

  it('child overrides parent setting', async () => {
    await createWorkspaceConfig('base-config', {
      settings: { retention_days: 30, naming_convention: 'kebab' },
    });

    await createWorkspaceConfig('child-config', {
      extends: 'base-config@1.0.0',
      settings: { retention_days: 7 },
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'child-config',
      version: '*',
    });

    const meta = result.bundle.meta as any;
    expect(meta.settings.retention_days).toBe(7);
    expect(meta.settings.naming_convention).toBe('kebab');
  });

  it('deduplicated union for plugins: same plugin, child version wins', async () => {
    // Parent has shared-plugin (no version in ref string)
    // Child also has shared-plugin — child's ref should win
    await createPlugin('shared-plugin');

    await createWorkspaceConfig('base-config', {
      plugins: ['shared-plugin'],
    });

    await createWorkspaceConfig('child-config', {
      extends: 'base-config@1.0.0',
      plugins: ['shared-plugin'],  // child's version wins (same ref here, but tests dedup)
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'child-config',
      version: '*',
    });

    const meta = result.bundle.meta as any;
    // Should appear exactly once
    const sharedCount = meta.plugins.filter((p: string) => p === 'shared-plugin').length;
    expect(sharedCount).toBe(1);
  });

  it('single-level enforcement: throws InheritanceDepthError', async () => {
    await createWorkspaceConfig('grandparent-config', {
      plugins: [],
    });

    await createWorkspaceConfig('parent-config', {
      extends: 'grandparent-config@1.0.0',
      plugins: [],
    });

    await createWorkspaceConfig('child-config', {
      extends: 'parent-config@1.0.0',
      plugins: [],
    });

    resolver.reset();
    await expect(
      resolver.resolve({
        type: 'workspace-config',
        id: 'child-config',
        version: '*',
      }),
    ).rejects.toThrow(InheritanceDepthError);
  });

  it('workspace-config without extends works unchanged', async () => {
    await createPlugin('my-plugin');
    await createSkill('my-skill');

    await createWorkspaceConfig('standalone-config', {
      plugins: ['my-plugin'],
      skills: ['my-skill'],
      settings: { retention_days: 14 },
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'standalone-config',
      version: '*',
    });

    const meta = result.bundle.meta as any;
    expect(meta.plugins).toEqual(['my-plugin']);
    expect(meta.skills).toEqual(['my-skill']);
    expect(meta.settings.retention_days).toBe(14);
    // No extends in the result
    expect(meta.extends).toBeUndefined();
  });

  it('parent not found throws ArtifactNotFoundError', async () => {
    await createWorkspaceConfig('orphan-config', {
      extends: 'nonexistent-parent@1.0.0',
    });

    resolver.reset();
    await expect(
      resolver.resolve({
        type: 'workspace-config',
        id: 'orphan-config',
        version: '*',
      }),
    ).rejects.toThrow(ArtifactNotFoundError);
  });

  it('child identity fields are preserved, not merged from parent', async () => {
    await createWorkspaceConfig('base-config', {
      author: 'parent-author',
      license: 'MIT',
      tags: ['parent-tag'],
    });

    await createWorkspaceConfig('child-config', {
      extends: 'base-config@1.0.0',
      author: 'child-author',
      tags: ['child-tag'],
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'child-config',
      version: '*',
    });

    const meta = result.bundle.meta as any;
    expect(meta.id).toBe('child-config');
    expect(meta.name).toBe('Config child-config');
    expect(meta.author).toBe('child-author');
    // Tags are identity fields — always from child
    expect(meta.tags).toEqual(['child-tag']);
  });

  it('merged config dependencies (plugins/skills) are fully resolved', async () => {
    // Parent brings a plugin, child brings a skill
    await createPlugin('inherited-plugin');
    await createSkill('direct-skill');

    await createWorkspaceConfig('base-config', {
      plugins: ['inherited-plugin'],
    });

    await createWorkspaceConfig('child-config', {
      extends: 'base-config@1.0.0',
      skills: ['direct-skill'],
    });

    resolver.reset();
    const result = await resolver.resolve({
      type: 'workspace-config',
      id: 'child-config',
      version: '*',
    });

    // The resolved artifact should have dependencies from both parent's plugins and child's skills
    const depIds = result.dependencies.map(d => d.ref.id);
    expect(depIds).toContain('inherited-plugin');
    expect(depIds).toContain('direct-skill');
  });
});
