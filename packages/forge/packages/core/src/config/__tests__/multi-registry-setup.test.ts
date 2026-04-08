import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as toYaml } from 'yaml';
import {
  loadGlobalConfig,
  saveGlobalConfig,
  ensureDefaultRegistries,
  DEFAULT_LOCAL_REGISTRY,
  DEFAULT_GLOBAL_REGISTRY,
} from '../global-config-loader.js';
import { RegistryConfigSchema, normalizeRegistryConfig } from '../../models/forge-config.js';
import type { RegistryConfig } from '../../models/forge-config.js';

describe('Multi-registry setup', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-multi-reg-'));
    configPath = path.join(tmpDir, 'config.yaml');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('DEFAULT_LOCAL_REGISTRY', () => {
    it('is a writable filesystem registry named "local"', () => {
      expect(DEFAULT_LOCAL_REGISTRY.type).toBe('filesystem');
      expect(DEFAULT_LOCAL_REGISTRY.name).toBe('local');
      expect((DEFAULT_LOCAL_REGISTRY as any).writable).toBe(true);
    });
  });

  describe('DEFAULT_GLOBAL_REGISTRY', () => {
    it('is a read-only git registry named "global"', () => {
      expect(DEFAULT_GLOBAL_REGISTRY.type).toBe('git');
      expect(DEFAULT_GLOBAL_REGISTRY.name).toBe('global');
      expect((DEFAULT_GLOBAL_REGISTRY as any).url).toBe(
        'https://github.com/Arjunkhera/Forge-Registry.git',
      );
      expect((DEFAULT_GLOBAL_REGISTRY as any).ref).toBe('master');
      expect((DEFAULT_GLOBAL_REGISTRY as any).writable).toBe(false);
    });
  });

  describe('ensureDefaultRegistries()', () => {
    it('adds local and global registries to an empty list', () => {
      const result = ensureDefaultRegistries([]);
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('local');
      expect(result[1]!.name).toBe('global');
    });

    it('preserves local first, global last ordering', () => {
      const result = ensureDefaultRegistries([]);
      expect(result[0]!.name).toBe('local');
      expect(result[result.length - 1]!.name).toBe('global');
    });

    it('does not duplicate local if already present', () => {
      const existing: RegistryConfig[] = [
        { type: 'filesystem', name: 'local', path: '/custom/path', writable: true },
      ];
      const result = ensureDefaultRegistries(existing);
      const locals = result.filter(r => r.name === 'local');
      expect(locals).toHaveLength(1);
      expect((locals[0] as any).path).toBe('/custom/path');
    });

    it('does not duplicate global if already present', () => {
      const existing: RegistryConfig[] = [
        {
          type: 'git',
          name: 'global',
          url: 'https://custom.com/reg.git',
          ref: 'main',
          path: 'registry',
          writable: false,
        },
      ];
      const result = ensureDefaultRegistries(existing);
      const globals = result.filter(r => r.name === 'global');
      expect(globals).toHaveLength(1);
      expect((globals[0] as any).url).toBe('https://custom.com/reg.git');
    });

    it('sandwiches user registries between local and global', () => {
      const existing: RegistryConfig[] = [
        {
          type: 'git',
          name: 'private',
          url: 'https://github.com/myorg/registry.git',
          ref: 'main',
          path: 'registry',
          writable: true,
          tokenEnv: 'MY_TOKEN',
        },
      ];
      const result = ensureDefaultRegistries(existing);
      expect(result).toHaveLength(3);
      expect(result[0]!.name).toBe('local');
      expect(result[1]!.name).toBe('private');
      expect(result[2]!.name).toBe('global');
    });

    it('enforces local-first even if local was in the middle', () => {
      const existing: RegistryConfig[] = [
        {
          type: 'git',
          name: 'private',
          url: 'https://github.com/myorg/registry.git',
          ref: 'main',
          path: 'registry',
          writable: true,
        },
        { type: 'filesystem', name: 'local', path: '/my/local', writable: true },
        {
          type: 'git',
          name: 'global',
          url: 'https://github.com/Arjunkhera/Forge-Registry.git',
          ref: 'master',
          path: 'registry',
          writable: false,
        },
      ];
      const result = ensureDefaultRegistries(existing);
      expect(result[0]!.name).toBe('local');
      expect(result[result.length - 1]!.name).toBe('global');
    });
  });

  describe('loadGlobalConfig() default registries', () => {
    it('includes local and global registries when file does not exist', async () => {
      const config = await loadGlobalConfig(configPath);
      expect(config.registries.length).toBeGreaterThanOrEqual(2);
      expect(config.registries[0]!.name).toBe('local');
      expect(config.registries[config.registries.length - 1]!.name).toBe('global');
    });

    it('includes local and global registries for empty config', async () => {
      await fs.writeFile(configPath, toYaml({}));
      const config = await loadGlobalConfig(configPath);
      expect(config.registries.length).toBeGreaterThanOrEqual(2);
      expect(config.registries[0]!.name).toBe('local');
      expect(config.registries[config.registries.length - 1]!.name).toBe('global');
    });

    it('includes local and global registries for malformed yaml', async () => {
      await fs.writeFile(configPath, '{{bad yaml');
      const config = await loadGlobalConfig(configPath);
      expect(config.registries.length).toBeGreaterThanOrEqual(2);
      expect(config.registries[0]!.name).toBe('local');
      expect(config.registries[config.registries.length - 1]!.name).toBe('global');
    });

    it('preserves user registries between local and global', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          {
            type: 'git',
            name: 'private',
            url: 'https://github.com/myorg/registry.git',
            ref: 'main',
            path: 'registry',
          },
        ],
      }));
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toHaveLength(3);
      expect(config.registries[0]!.name).toBe('local');
      expect(config.registries[1]!.name).toBe('private');
      expect(config.registries[2]!.name).toBe('global');
    });

    it('expands local filesystem registry path', async () => {
      const config = await loadGlobalConfig(configPath);
      const local = config.registries.find(r => r.name === 'local');
      expect(local).toBeDefined();
      expect((local as any).path).toBe(path.join(os.homedir(), '.Horus/data/registry'));
    });
  });

  describe('workspace inherits registries from global config', () => {
    it('global config registries are passed through to workspace forge.yaml', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          {
            type: 'git',
            name: 'private',
            url: 'https://github.com/myorg/registry.git',
            ref: 'main',
            path: 'registry',
            tokenEnv: 'FORGE_PRIVATE_REGISTRY_TOKEN',
            writable: true,
          },
        ],
      }));

      const config = await loadGlobalConfig(configPath);
      // Simulates what workspace-creator.ts does at line 214:
      // registries: globalConfig.registries
      const workspaceRegistries = config.registries;
      expect(workspaceRegistries).toHaveLength(3);
      expect(workspaceRegistries[0]!.name).toBe('local');
      expect(workspaceRegistries[1]!.name).toBe('private');
      expect(workspaceRegistries[2]!.name).toBe('global');
    });
  });

  describe('Registry config schema', () => {
    it('supports writable field on filesystem registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'filesystem',
        name: 'local',
        path: '/some/path',
        writable: true,
      });
      expect((reg as any).writable).toBe(true);
    });

    it('defaults writable to false', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'filesystem',
        name: 'local',
        path: '/some/path',
      });
      expect((reg as any).writable).toBe(false);
    });

    it('supports ref field on git registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'git',
        name: 'test',
        url: 'https://github.com/test/reg.git',
        ref: 'v2',
      });
      expect((reg as any).ref).toBe('v2');
    });

    it('supports legacy branch field on git registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'git',
        name: 'test',
        url: 'https://github.com/test/reg.git',
        branch: 'legacy-branch',
      });
      // branch is still accepted; ref defaults to 'main' but normalizeRegistryConfig fixes it
      const normalized = normalizeRegistryConfig(reg);
      expect((normalized as any).ref).toBe('legacy-branch');
    });

    it('supports tokenEnv field on git registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'git',
        name: 'private',
        url: 'https://github.com/myorg/reg.git',
        ref: 'main',
        tokenEnv: 'MY_TOKEN_ENV',
      });
      expect((reg as any).tokenEnv).toBe('MY_TOKEN_ENV');
    });

    it('supports writable field on git registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'git',
        name: 'private',
        url: 'https://github.com/myorg/reg.git',
        ref: 'main',
        writable: true,
      });
      expect((reg as any).writable).toBe(true);
    });

    it('supports tokenEnv field on http registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'http',
        name: 'remote',
        url: 'https://registry.example.com',
        tokenEnv: 'HTTP_TOKEN',
      });
      expect((reg as any).tokenEnv).toBe('HTTP_TOKEN');
    });

    it('supports writable field on http registries', () => {
      const reg = RegistryConfigSchema.parse({
        type: 'http',
        name: 'remote',
        url: 'https://registry.example.com',
        writable: true,
      });
      expect((reg as any).writable).toBe(true);
    });
  });

  describe('normalizeRegistryConfig()', () => {
    it('maps legacy branch to ref for git registries', () => {
      const reg: RegistryConfig = {
        type: 'git',
        name: 'test',
        url: 'https://github.com/test/reg.git',
        ref: 'main', // default
        branch: 'develop',
        path: 'registry',
        writable: false,
      };
      const normalized = normalizeRegistryConfig(reg);
      expect((normalized as any).ref).toBe('develop');
      expect((normalized as any).branch).toBeUndefined();
    });

    it('preserves ref when both ref and branch are set (ref wins if non-default)', () => {
      const reg: RegistryConfig = {
        type: 'git',
        name: 'test',
        url: 'https://github.com/test/reg.git',
        ref: 'v2',
        branch: 'develop',
        path: 'registry',
        writable: false,
      };
      const normalized = normalizeRegistryConfig(reg);
      // ref is non-default, so it wins
      expect((normalized as any).ref).toBe('v2');
    });

    it('is a no-op for filesystem registries', () => {
      const reg: RegistryConfig = {
        type: 'filesystem',
        name: 'local',
        path: '/some/path',
        writable: true,
      };
      const normalized = normalizeRegistryConfig(reg);
      expect(normalized).toEqual(reg);
    });
  });

  describe('Private registry support (full stack example)', () => {
    it('supports local + private + global registry ordering', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          { type: 'filesystem', name: 'local', path: '~/.Horus/data/registry', writable: true },
          {
            type: 'git',
            name: 'private',
            url: 'https://github.com/myorg/my-forge-registry.git',
            ref: 'main',
            tokenEnv: 'FORGE_PRIVATE_REGISTRY_TOKEN',
            writable: true,
          },
          {
            type: 'git',
            name: 'global',
            url: 'https://github.com/Arjunkhera/Forge-Registry.git',
            ref: 'master',
            writable: false,
          },
        ],
      }));

      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toHaveLength(3);
      expect(config.registries[0]!.name).toBe('local');
      expect(config.registries[0]!.type).toBe('filesystem');
      expect((config.registries[0] as any).writable).toBe(true);

      expect(config.registries[1]!.name).toBe('private');
      expect(config.registries[1]!.type).toBe('git');
      expect((config.registries[1] as any).writable).toBe(true);
      expect((config.registries[1] as any).tokenEnv).toBe('FORGE_PRIVATE_REGISTRY_TOKEN');

      expect(config.registries[2]!.name).toBe('global');
      expect(config.registries[2]!.type).toBe('git');
      expect((config.registries[2] as any).writable).toBe(false);
    });
  });
});
