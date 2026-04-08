import { describe, it, expect } from 'vitest';
import { mergeWorkspaceConfigs } from '../merge-workspace-configs.js';
import type { WorkspaceConfigMeta } from '../../models/workspace-config-meta.js';

function makeConfig(overrides: Partial<WorkspaceConfigMeta> = {}): WorkspaceConfigMeta {
  return {
    id: 'test',
    name: 'Test Config',
    version: '1.0.0',
    description: 'A test config',
    type: 'workspace-config',
    tags: [],
    plugins: [],
    skills: [],
    personas: [],
    mcp_servers: {},
    settings: {},
    git_workflow: {
      branch_pattern: '{subtype}/{id}-{slug}',
      base_branch: 'main',
      stash_before_checkout: true,
      commit_format: 'conventional',
      pr_template: true,
      signed_commits: false,
    },
    ...overrides,
  } as WorkspaceConfigMeta;
}

describe('mergeWorkspaceConfigs', () => {
  it('identity fields always come from child', () => {
    const parent = makeConfig({
      id: 'parent',
      name: 'Parent',
      version: '2.0.0',
      description: 'Parent desc',
      author: 'parent-author',
      license: 'MIT',
      tags: ['parent-tag'],
    });
    const child = makeConfig({
      id: 'child',
      name: 'Child',
      version: '1.0.0',
      description: 'Child desc',
      author: 'child-author',
      tags: ['child-tag'],
    });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.id).toBe('child');
    expect(merged.name).toBe('Child');
    expect(merged.version).toBe('1.0.0');
    expect(merged.description).toBe('Child desc');
    expect(merged.author).toBe('child-author');
    expect(merged.tags).toEqual(['child-tag']);
    // License not set on child — comes from child (undefined)
    expect(merged.license).toBeUndefined();
  });

  it('plugins: deduplicated union, child version wins', () => {
    const parent = makeConfig({ plugins: ['pluginA@1.0.0', 'pluginB@1.0.0'] });
    const child = makeConfig({ plugins: ['pluginA@2.0.0', 'pluginC@1.0.0'] });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.plugins).toContain('pluginA@2.0.0');
    expect(merged.plugins).toContain('pluginB@1.0.0');
    expect(merged.plugins).toContain('pluginC@1.0.0');
    expect(merged.plugins).not.toContain('pluginA@1.0.0');
    expect(merged.plugins).toHaveLength(3);
  });

  it('skills: deduplicated union, child version wins', () => {
    const parent = makeConfig({ skills: ['dev@1.0.0', 'test@1.0.0'] });
    const child = makeConfig({ skills: ['dev@2.0.0', 'review@1.0.0'] });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.skills).toContain('dev@2.0.0');
    expect(merged.skills).toContain('test@1.0.0');
    expect(merged.skills).toContain('review@1.0.0');
    expect(merged.skills).toHaveLength(3);
  });

  it('personas: deduplicated union, child version wins', () => {
    const parent = makeConfig({ personas: ['architect'] });
    const child = makeConfig({ personas: ['developer', 'architect'] });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.personas).toContain('architect');
    expect(merged.personas).toContain('developer');
    expect(merged.personas).toHaveLength(2);
  });

  it('mcp_servers: merge by key, child overrides existing', () => {
    const parent = makeConfig({
      mcp_servers: {
        anvil: { description: 'Parent anvil', required: true },
        vault: { description: 'Parent vault', required: true },
      },
    });
    const child = makeConfig({
      mcp_servers: {
        anvil: { description: 'Child anvil', required: false },
        forge: { description: 'Child forge', required: true },
      },
    });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.mcp_servers.anvil.description).toBe('Child anvil');
    expect(merged.mcp_servers.anvil.required).toBe(false);
    expect(merged.mcp_servers.vault.description).toBe('Parent vault');
    expect(merged.mcp_servers.forge.description).toBe('Child forge');
  });

  it('settings: deep merge, child overrides specific keys', () => {
    const parent = makeConfig({
      settings: { retention_days: 30, naming_convention: 'kebab' },
    });
    const child = makeConfig({
      settings: { retention_days: 7 },
    });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.settings.retention_days).toBe(7);
    expect(merged.settings.naming_convention).toBe('kebab');
  });

  it('git_workflow: deep merge, child overrides specific keys', () => {
    const parent = makeConfig({
      git_workflow: {
        branch_pattern: 'feat/{id}',
        base_branch: 'main',
        stash_before_checkout: true,
        commit_format: 'conventional' as const,
        pr_template: true,
        signed_commits: false,
      },
    });
    const child = makeConfig({
      git_workflow: {
        branch_pattern: '{subtype}/{id}-{slug}',
        base_branch: 'develop',
        stash_before_checkout: true,
        commit_format: 'freeform' as const,
        pr_template: true,
        signed_commits: false,
      },
    });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.git_workflow.base_branch).toBe('develop');
    expect(merged.git_workflow.commit_format).toBe('freeform');
    expect(merged.git_workflow.branch_pattern).toBe('{subtype}/{id}-{slug}');
  });

  it('claude_permissions: deep merge', () => {
    const parent = makeConfig({
      claude_permissions: { allow: ['read'], deny: ['delete'] },
    });
    const child = makeConfig({
      claude_permissions: { allow: ['read', 'write'], deny: [] },
    });

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.claude_permissions?.allow).toEqual(['read', 'write']);
    expect(merged.claude_permissions?.deny).toEqual([]);
  });

  it('claude_permissions: undefined on both sides returns undefined', () => {
    const parent = makeConfig({});
    const child = makeConfig({});

    const merged = mergeWorkspaceConfigs(parent, child);
    expect(merged.claude_permissions).toBeUndefined();
  });

  it('empty child arrays do not wipe parent arrays', () => {
    const parent = makeConfig({ plugins: ['a', 'b'], skills: ['c'] });
    const child = makeConfig({ plugins: [], skills: [] });

    const merged = mergeWorkspaceConfigs(parent, child);
    // Empty child + non-empty parent => parent entries are preserved (union)
    expect(merged.plugins).toEqual(['a', 'b']);
    expect(merged.skills).toEqual(['c']);
  });
});
