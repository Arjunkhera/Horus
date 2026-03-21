import { describe, it, expect } from 'vitest';
import { WorkspaceConfigMetaSchema } from '../workspace-config-meta.js';

describe('WorkspaceConfigMeta Schema', () => {
  it('should parse full valid workspace config', () => {
    const valid = {
      id: 'sdlc-default',
      name: 'Default SDLC Workspace Config',
      version: '1.0.0',
      description: 'Standard workspace configuration for SDLC workflows',
      type: 'workspace-config' as const,
      author: 'Forge Team',
      license: 'MIT',
      tags: ['sdlc', 'default'],
      plugins: ['anvil-sdlc-v2'],
      skills: ['developer', 'tester'],
      mcp_servers: {
        anvil: { description: 'Anvil MCP server', required: true },
        vault: { description: 'Vault MCP server', required: false },
      },
      settings: {
        retention_days: 30,
        naming_convention: 'kebab-case',
      },
      git_workflow: {
        branch_pattern: 'feature/{id}-{slug}',
        base_branch: 'develop',
        stash_before_checkout: true,
        commit_format: 'conventional' as const,
        pr_template: true,
        signed_commits: false,
      },
    };
    const result = WorkspaceConfigMetaSchema.parse(valid);
    expect(result.id).toBe('sdlc-default');
    expect(result.type).toBe('workspace-config');
    expect(result.plugins).toEqual(['anvil-sdlc-v2']);
    expect(result.skills).toEqual(['developer', 'tester']);
    expect(result.mcp_servers.anvil.required).toBe(true);
    expect(result.git_workflow.base_branch).toBe('develop');
  });

  it('should apply default values for optional fields', () => {
    const minimal = {
      id: 'test-config',
      name: 'Test Config',
      version: '1.0.0',
      description: 'A test configuration',
      type: 'workspace-config' as const,
    };
    const result = WorkspaceConfigMetaSchema.parse(minimal);
    expect(result.tags).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.mcp_servers).toEqual({});
    expect(result.settings).toEqual({});
    expect(result.git_workflow.branch_pattern).toBe('{subtype}/{id}-{slug}');
    expect(result.git_workflow.base_branch).toBe('main');
    expect(result.git_workflow.commit_format).toBe('conventional');
    expect(result.git_workflow.pr_template).toBe(true);
    expect(result.git_workflow.signed_commits).toBe(false);
  });

  it('should apply git workflow defaults individually', () => {
    const config = {
      id: 'partial-config',
      name: 'Partial',
      version: '1.0.0',
      description: 'Partial git workflow',
      type: 'workspace-config' as const,
      git_workflow: {
        base_branch: 'staging',
      },
    };
    const result = WorkspaceConfigMetaSchema.parse(config);
    expect(result.git_workflow.base_branch).toBe('staging');
    expect(result.git_workflow.branch_pattern).toBe('{subtype}/{id}-{slug}');
    expect(result.git_workflow.commit_format).toBe('conventional');
  });

  it('should reject invalid semver', () => {
    const invalid = {
      id: 'test-config',
      name: 'Test',
      version: '1.0',
      description: 'Bad version',
      type: 'workspace-config' as const,
    };
    expect(() => WorkspaceConfigMetaSchema.parse(invalid)).toThrow();
  });

  it('should reject non-kebab-case IDs', () => {
    const invalid = {
      id: 'MyConfig',
      name: 'Test',
      version: '1.0.0',
      description: 'Bad id',
      type: 'workspace-config' as const,
    };
    expect(() => WorkspaceConfigMetaSchema.parse(invalid)).toThrow();
  });

  it('should reject empty ID', () => {
    const invalid = {
      id: '',
      name: 'Test',
      version: '1.0.0',
      description: 'Empty id',
      type: 'workspace-config' as const,
    };
    expect(() => WorkspaceConfigMetaSchema.parse(invalid)).toThrow();
  });

  it('should accept plugins array', () => {
    const config = {
      id: 'test-config',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      type: 'workspace-config' as const,
      plugins: ['plugin-a', 'plugin-b', 'plugin-c'],
    };
    const result = WorkspaceConfigMetaSchema.parse(config);
    expect(result.plugins).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
  });

  it('should accept skills array', () => {
    const config = {
      id: 'test-config',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      type: 'workspace-config' as const,
      skills: ['skill-a', 'skill-b'],
    };
    const result = WorkspaceConfigMetaSchema.parse(config);
    expect(result.skills).toEqual(['skill-a', 'skill-b']);
  });

  it('should accept MCP servers config', () => {
    const config = {
      id: 'test-config',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      type: 'workspace-config' as const,
      mcp_servers: {
        server1: { description: 'Server 1', required: true },
        server2: { description: 'Server 2', required: false },
      },
    };
    const result = WorkspaceConfigMetaSchema.parse(config);
    expect(result.mcp_servers.server1.required).toBe(true);
    expect(result.mcp_servers.server2.required).toBe(false);
  });

  it('should apply MCP server required defaults', () => {
    const config = {
      id: 'test-config',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      type: 'workspace-config' as const,
      mcp_servers: {
        server1: { description: 'Server 1' },
      },
    };
    const result = WorkspaceConfigMetaSchema.parse(config);
    expect(result.mcp_servers.server1.required).toBe(true);
  });

  it('should accept optional fields', () => {
    const config = {
      id: 'full-config',
      name: 'Full Config',
      version: '1.0.0',
      description: 'Complete metadata',
      type: 'workspace-config' as const,
      author: 'John Doe',
      license: 'Apache-2.0',
      tags: ['tag1', 'tag2'],
    };
    const result = WorkspaceConfigMetaSchema.parse(config);
    expect(result.author).toBe('John Doe');
    expect(result.license).toBe('Apache-2.0');
    expect(result.tags).toEqual(['tag1', 'tag2']);
  });

  it('should reject invalid type literal', () => {
    const invalid = {
      id: 'test-config',
      name: 'Test',
      version: '1.0.0',
      description: 'Wrong type',
      type: 'skill',
    };
    expect(() => WorkspaceConfigMetaSchema.parse(invalid)).toThrow();
  });

  it('should accept different commit formats', () => {
    for (const format of ['conventional', 'freeform']) {
      const config = {
        id: 'test-config',
        name: 'Test',
        version: '1.0.0',
        description: 'Test',
        type: 'workspace-config' as const,
        git_workflow: {
          commit_format: format as any,
        },
      };
      expect(() => WorkspaceConfigMetaSchema.parse(config)).not.toThrow();
    }
  });

  it('should reject invalid commit format', () => {
    const config = {
      id: 'test-config',
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      type: 'workspace-config' as const,
      git_workflow: {
        commit_format: 'invalid' as any,
      },
    };
    expect(() => WorkspaceConfigMetaSchema.parse(config)).toThrow();
  });
});
