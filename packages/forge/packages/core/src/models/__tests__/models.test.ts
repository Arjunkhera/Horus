import { describe, it, expect } from 'vitest';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  WorkspaceConfigMetaSchema,
  ForgeConfigSchema,
  LockFileSchema,
  SemVerSchema,
} from '../index.js';

describe('SkillMeta Schema', () => {
  it('should parse valid skill metadata', () => {
    const valid = {
      id: 'developer',
      name: 'Developer Skill',
      version: '1.0.0',
      description: 'Implements stories',
      type: 'skill' as const,
      tags: ['development', 'sdlc'],
    };
    const result = SkillMetaSchema.parse(valid);
    expect(result.id).toBe('developer');
    expect(result.tags).toEqual(['development', 'sdlc']);
  });

  it('should apply default values for tags and dependencies', () => {
    const minimal = {
      id: 'test-skill',
      name: 'Test',
      version: '1.0.0',
      description: 'A test skill',
      type: 'skill' as const,
    };
    const result = SkillMetaSchema.parse(minimal);
    expect(result.tags).toEqual([]);
    expect(result.dependencies).toEqual({});
  });

  it('should reject invalid semver', () => {
    const invalid = {
      id: 'test',
      name: 'Test',
      version: '1.0',
      description: 'Bad version',
      type: 'skill' as const,
    };
    expect(() => SkillMetaSchema.parse(invalid)).toThrow();
  });

  it('should reject non-kebab-case IDs', () => {
    const invalid = {
      id: 'MySkill',
      name: 'Test',
      version: '1.0.0',
      description: 'Bad id',
      type: 'skill' as const,
    };
    expect(() => SkillMetaSchema.parse(invalid)).toThrow();
  });

  it('should reject IDs with spaces', () => {
    const invalid = {
      id: 'skill skill',
      name: 'Test',
      version: '1.0.0',
      description: 'Bad id',
      type: 'skill' as const,
    };
    expect(() => SkillMetaSchema.parse(invalid)).toThrow();
  });

  it('should accept valid semver variations', () => {
    const versions = ['1.0.0', '2.1.0-beta.1', '0.0.1-rc.1+build.123'];
    for (const version of versions) {
      const data = {
        id: 'test',
        name: 'Test',
        version,
        description: 'Test',
        type: 'skill' as const,
      };
      expect(() => SkillMetaSchema.parse(data)).not.toThrow();
    }
  });

  it('should accept optional fields', () => {
    const full = {
      id: 'full-skill',
      name: 'Full Skill',
      version: '1.0.0',
      description: 'Complete metadata',
      type: 'skill' as const,
      author: 'John Doe',
      license: 'MIT',
      tags: ['tag1'],
      dependencies: { 'other-skill': '^1.0.0' },
      files: ['index.ts', 'types.ts'],
      homepage: 'https://example.com',
      repository: 'https://github.com/example/repo',
    };
    const result = SkillMetaSchema.parse(full);
    expect(result.author).toBe('John Doe');
    expect(result.license).toBe('MIT');
    expect(result.files).toEqual(['index.ts', 'types.ts']);
  });
});

describe('AgentMeta Schema', () => {
  it('should parse valid agent metadata', () => {
    const valid = {
      id: 'sdlc-agent',
      name: 'SDLC Agent',
      version: '1.0.0',
      description: 'Manages software development lifecycle',
      type: 'agent' as const,
      rootSkill: 'orchestrator',
    };
    const result = AgentMetaSchema.parse(valid);
    expect(result.id).toBe('sdlc-agent');
    expect(result.rootSkill).toBe('orchestrator');
  });

  it('should apply default values', () => {
    const minimal = {
      id: 'test-agent',
      name: 'Test',
      version: '1.0.0',
      description: 'A test agent',
      type: 'agent' as const,
      rootSkill: 'root',
    };
    const result = AgentMetaSchema.parse(minimal);
    expect(result.tags).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.dependencies).toEqual({});
  });

  it('should reject missing rootSkill', () => {
    const invalid = {
      id: 'test-agent',
      name: 'Test',
      version: '1.0.0',
      description: 'Missing root',
      type: 'agent' as const,
    };
    expect(() => AgentMetaSchema.parse(invalid)).toThrow();
  });

  it('should accept skills array', () => {
    const valid = {
      id: 'test-agent',
      name: 'Test',
      version: '1.0.0',
      description: 'Test agent',
      type: 'agent' as const,
      rootSkill: 'orchestrator',
      skills: ['developer', 'tester'],
    };
    const result = AgentMetaSchema.parse(valid);
    expect(result.skills).toEqual(['developer', 'tester']);
  });
});

describe('PluginMeta Schema', () => {
  it('should parse valid plugin metadata', () => {
    const valid = {
      id: 'anvil-sdlc',
      name: 'Anvil SDLC Plugin',
      version: '1.0.0',
      description: 'Software development lifecycle tools',
      type: 'plugin' as const,
      skills: ['developer', 'tester'],
      agents: ['sdlc-agent'],
    };
    const result = PluginMetaSchema.parse(valid);
    expect(result.id).toBe('anvil-sdlc');
    expect(result.skills).toContain('developer');
  });

  it('should apply defaults for arrays', () => {
    const minimal = {
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'A test plugin',
      type: 'plugin' as const,
    };
    const result = PluginMetaSchema.parse(minimal);
    expect(result.skills).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it('should reject non-literal type', () => {
    const invalid = {
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      description: 'Wrong type',
      type: 'skill',
    };
    expect(() => PluginMetaSchema.parse(invalid)).toThrow();
  });
});

describe('ForgeConfig Schema', () => {
  it('should parse valid config with defaults', () => {
    const config = {
      name: 'my-workspace',
    };
    const result = ForgeConfigSchema.parse(config);
    expect(result.name).toBe('my-workspace');
    expect(result.version).toBe('0.1.0');
    expect(result.target).toBe('claude-code');
    expect(result.registries).toEqual([]);
    expect(result.outputDir).toBe('.');
  });

  it('should parse filesystem registry', () => {
    const config = {
      name: 'my-workspace',
      registries: [
        {
          type: 'filesystem' as const,
          name: 'local',
          path: './registry',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    expect(result.registries).toHaveLength(1);
    const reg = result.registries[0];
    if (reg.type === 'filesystem') {
      expect(reg.path).toBe('./registry');
    }
  });

  it('should parse git registry with defaults', () => {
    const config = {
      name: 'my-workspace',
      registries: [
        {
          type: 'git' as const,
          name: 'remote',
          url: 'https://github.com/example/registry.git',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    const reg = result.registries[0];
    expect(reg.type).toBe('git');
    if (reg.type === 'git') {
      expect(reg.branch).toBe('main');
      expect(reg.path).toBe('registry');
    }
  });

  it('should parse git registry with custom values', () => {
    const config = {
      name: 'my-workspace',
      registries: [
        {
          type: 'git' as const,
          name: 'remote',
          url: 'https://github.com/example/registry.git',
          branch: 'develop',
          path: 'custom-registry',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    const reg = result.registries[0];
    if (reg.type === 'git') {
      expect(reg.branch).toBe('develop');
      expect(reg.path).toBe('custom-registry');
    }
  });

  it('should parse http registry', () => {
    const config = {
      name: 'my-workspace',
      registries: [
        {
          type: 'http' as const,
          name: 'api',
          url: 'https://api.example.com/registry',
          token: 'secret-token',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    const reg = result.registries[0];
    if (reg.type === 'http') {
      expect(reg.token).toBe('secret-token');
    }
  });

  it('should accept all target enum values', () => {
    for (const target of ['claude-code', 'cursor', 'plugin']) {
      const config = {
        name: 'test',
        target,
      };
      expect(() => ForgeConfigSchema.parse(config)).not.toThrow();
    }
  });

  it('should parse artifacts with all types', () => {
    const config = {
      name: 'test',
      artifacts: {
        skills: { 'my-skill': 'skill:my-skill@1.0.0' },
        agents: { 'my-agent': 'agent:my-agent@1.0.0' },
        plugins: { 'my-plugin': 'plugin:my-plugin@1.0.0' },
      },
    };
    const result = ForgeConfigSchema.parse(config);
    expect(result.artifacts.skills).toHaveProperty('my-skill');
    expect(result.artifacts.agents).toHaveProperty('my-agent');
    expect(result.artifacts.plugins).toHaveProperty('my-plugin');
  });

  it('should reject invalid registry type', () => {
    const config = {
      name: 'test',
      registries: [
        {
          type: 'unknown',
          name: 'bad',
          url: 'https://example.com',
        },
      ],
    };
    expect(() => ForgeConfigSchema.parse(config)).toThrow();
  });
});

describe('LockFile Schema', () => {
  it('should parse valid lockfile', () => {
    const lock = {
      version: '1' as const,
      lockedAt: new Date().toISOString(),
      artifacts: {},
    };
    const result = LockFileSchema.parse(lock);
    expect(result.version).toBe('1');
  });

  it('should parse lockfile with artifacts', () => {
    const now = new Date().toISOString();
    const lock = {
      version: '1' as const,
      lockedAt: now,
      artifacts: {
        'developer@1.0.0': {
          id: 'developer',
          type: 'skill' as const,
          version: '1.0.0',
          registry: 'local',
          sha256: 'a'.repeat(64),
          files: ['index.ts'],
          resolvedAt: now,
        },
      },
    };
    const result = LockFileSchema.parse(lock);
    expect(result.artifacts).toHaveProperty('developer@1.0.0');
  });

  it('should reject invalid SHA-256', () => {
    const now = new Date().toISOString();
    const lock = {
      version: '1' as const,
      lockedAt: now,
      artifacts: {
        'test@1.0.0': {
          id: 'test',
          type: 'skill' as const,
          version: '1.0.0',
          registry: 'local',
          sha256: 'not-valid-sha',
          resolvedAt: now,
        },
      },
    };
    expect(() => LockFileSchema.parse(lock)).toThrow();
  });

  it('should accept valid SHA-256 (64 hex chars)', () => {
    const now = new Date().toISOString();
    // Create a valid 64-character hex string (SHA-256)
    const validSha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const lock = {
      version: '1' as const,
      lockedAt: now,
      artifacts: {
        'test@1.0.0': {
          id: 'test',
          type: 'skill' as const,
          version: '1.0.0',
          registry: 'local',
          sha256: validSha,
          resolvedAt: now,
        },
      },
    };
    const result = LockFileSchema.parse(lock);
    expect(result.artifacts['test@1.0.0'].sha256).toBe(validSha);
  });

  it('should apply file defaults', () => {
    const now = new Date().toISOString();
    const lock = {
      version: '1' as const,
      lockedAt: now,
      artifacts: {
        'test@1.0.0': {
          id: 'test',
          type: 'skill' as const,
          version: '1.0.0',
          registry: 'local',
          sha256: 'a'.repeat(64),
          resolvedAt: now,
        },
      },
    };
    const result = LockFileSchema.parse(lock);
    expect(result.artifacts['test@1.0.0'].files).toEqual([]);
  });
});

describe('SemVer Schema', () => {
  it('should accept valid semver strings', () => {
    const valid = ['1.0.0', '2.1.0', '0.0.1', '10.20.30'];
    for (const version of valid) {
      expect(() => SemVerSchema.parse(version)).not.toThrow();
    }
  });

  it('should accept semver with prerelease', () => {
    const valid = ['1.0.0-alpha', '1.0.0-beta.1', '1.0.0-rc.1', '2.0.0-0'];
    for (const version of valid) {
      expect(() => SemVerSchema.parse(version)).not.toThrow();
    }
  });

  it('should accept semver with build metadata', () => {
    const valid = ['1.0.0+build', '1.0.0+build.1', '1.0.0+20130313144700'];
    for (const version of valid) {
      expect(() => SemVerSchema.parse(version)).not.toThrow();
    }
  });

  it('should accept semver with prerelease and build', () => {
    expect(() => SemVerSchema.parse('1.0.0-beta+build')).not.toThrow();
  });

  it('should reject invalid formats', () => {
    const invalid = ['1.0', '1', 'v1.0.0', '1.0.0.0', 'not-a-version'];
    for (const version of invalid) {
      expect(() => SemVerSchema.parse(version)).toThrow();
    }
  });
});

describe('Discriminated Union - RegistryConfig', () => {
  it('should correctly discriminate filesystem registry', () => {
    const config = {
      name: 'test',
      registries: [
        {
          type: 'filesystem' as const,
          name: 'local',
          path: '/some/path',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    const reg = result.registries[0];
    expect(reg.type).toBe('filesystem');
    if (reg.type === 'filesystem') {
      expect(reg.path).toBe('/some/path');
    }
  });

  it('should correctly discriminate git registry', () => {
    const config = {
      name: 'test',
      registries: [
        {
          type: 'git' as const,
          name: 'remote',
          url: 'https://github.com/example/repo.git',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    const reg = result.registries[0];
    expect(reg.type).toBe('git');
    if (reg.type === 'git') {
      expect('url' in reg).toBe(true);
      expect('branch' in reg).toBe(true);
    }
  });

  it('should correctly discriminate http registry', () => {
    const config = {
      name: 'test',
      registries: [
        {
          type: 'http' as const,
          name: 'api',
          url: 'https://api.example.com',
        },
      ],
    };
    const result = ForgeConfigSchema.parse(config);
    const reg = result.registries[0];
    expect(reg.type).toBe('http');
    if (reg.type === 'http') {
      expect('url' in reg).toBe(true);
    }
  });
});
