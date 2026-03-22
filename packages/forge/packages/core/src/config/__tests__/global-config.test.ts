import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as toYaml } from 'yaml';
import {
  loadGlobalConfig,
  saveGlobalConfig,
  addGlobalRegistry,
  removeGlobalRegistry,
  expandPath,
  expandPaths,
} from '../index.js';
import { GlobalConfigSchema, type GlobalConfig } from '../../models/global-config.js';

describe('Global Config', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-global-cfg-'));
    configPath = path.join(tmpDir, 'config.yaml');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('expandPath()', () => {
    it('expands ~ to home directory', () => {
      const expanded = expandPath('~/Documents');
      expect(expanded).toBe(path.join(os.homedir(), 'Documents'));
    });

    it('expands ~ alone to home directory', () => {
      const expanded = expandPath('~');
      expect(expanded).toBe(os.homedir());
    });

    it('leaves absolute paths unchanged', () => {
      const absPath = '/absolute/path';
      expect(expandPath(absPath)).toBe(absPath);
    });

    it('leaves relative paths unchanged', () => {
      const relPath = 'relative/path';
      expect(expandPath(relPath)).toBe(relPath);
    });
  });

  describe('expandPaths()', () => {
    it('expands multiple paths', () => {
      const paths = ['~/Documents', '~/Projects', '/absolute/path', 'relative'];
      const expanded = expandPaths(paths);
      expect(expanded).toEqual([
        path.join(os.homedir(), 'Documents'),
        path.join(os.homedir(), 'Projects'),
        '/absolute/path',
        'relative',
      ]);
    });

    it('handles empty array', () => {
      expect(expandPaths([])).toEqual([]);
    });
  });

  describe('GlobalConfigSchema', () => {
    it('parses config with all four sections', () => {
      const raw = {
        registries: [
          { type: 'filesystem', name: 'local', path: '/reg' },
        ],
        workspace: {
          mount_path: '~/workspaces',
          default_config: 'my-config',
          retention_days: 60,
        },
        mcp_endpoints: {
          anvil: { url: 'http://localhost:3002', transport: 'http' },
          vault: { url: 'http://localhost:8000', transport: 'stdio' },
        },
        repos: {
          scan_paths: ['~/Repositories', '~/Projects'],
          index_path: '~/Horus/data/config/repos.json',
        },
      };
      const config = GlobalConfigSchema.parse(raw);
      expect(config.registries).toHaveLength(1);
      expect(config.workspace.mount_path).toBe('~/workspaces');
      expect(config.workspace.retention_days).toBe(60);
      expect(config.mcp_endpoints.anvil?.transport).toBe('http');
      expect(config.mcp_endpoints.vault?.transport).toBe('stdio');
      expect(config.repos.scan_paths).toEqual(['~/Repositories', '~/Projects']);
    });

    it('applies defaults for missing sections', () => {
      const raw = {
        registries: [
          { type: 'filesystem', name: 'local', path: '/reg' },
        ],
      };
      const config = GlobalConfigSchema.parse(raw);
      expect(config.registries).toHaveLength(1);
      expect(config.workspace.mount_path).toBe('~/forge-workspaces');
      expect(config.workspace.default_config).toBe('sdlc-default');
      expect(config.workspace.retention_days).toBe(30);
      expect(config.mcp_endpoints).toEqual({});
      expect(config.repos.scan_paths).toEqual([]);
      expect(config.repos.index_path).toBe('~/Horus/data/config/repos.json');
    });

    it('parses empty config with all defaults', () => {
      const config = GlobalConfigSchema.parse({});
      expect(config.registries).toEqual([]);
      expect(config.workspace.mount_path).toBe('~/forge-workspaces');
      expect(config.workspace.default_config).toBe('sdlc-default');
      expect(config.workspace.retention_days).toBe(30);
      expect(config.mcp_endpoints).toEqual({});
      expect(config.repos.scan_paths).toEqual([]);
      expect(config.repos.index_path).toBe('~/Horus/data/config/repos.json');
    });

    it('allows partial MCP endpoints', () => {
      const raw = {
        mcp_endpoints: {
          anvil: { url: 'http://localhost:3002', transport: 'http' },
        },
      };
      const config = GlobalConfigSchema.parse(raw);
      expect(config.mcp_endpoints.anvil).toBeDefined();
      expect(config.mcp_endpoints.vault).toBeUndefined();
    });
  });

  describe('loadGlobalConfig()', () => {
    it('returns empty config when file does not exist', async () => {
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toEqual([]);
      expect(config.workspace.mount_path).toBe('~/forge-workspaces');
    });

    it('loads a valid config file with all sections', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          { type: 'filesystem', name: 'local', path: '~/registry' },
        ],
        workspace: {
          mount_path: '~/my-workspaces',
          default_config: 'custom',
          retention_days: 45,
        },
        mcp_endpoints: {
          anvil: { url: 'http://localhost:3002', transport: 'http' },
        },
        repos: {
          scan_paths: ['~/Repos', '~/Projects'],
          index_path: '~/Horus/data/config/repos.json',
        },
      }));

      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toHaveLength(1);
      expect(config.workspace.mount_path).toBe(path.join(os.homedir(), 'my-workspaces'));
      expect(config.workspace.default_config).toBe('custom');
      expect(config.workspace.retention_days).toBe(45);
      expect(config.mcp_endpoints.anvil?.url).toBe('http://localhost:3002');
      expect(config.repos.scan_paths).toEqual([
        path.join(os.homedir(), 'Repos'),
        path.join(os.homedir(), 'Projects'),
      ]);
    });

    it('expands tilde paths in loaded config', async () => {
      await fs.writeFile(configPath, toYaml({
        workspace: {
          mount_path: '~/workspaces',
        },
        repos: {
          scan_paths: ['~/Repositories'],
          index_path: '~/Horus/data/config/repos.json',
        },
      }));

      const config = await loadGlobalConfig(configPath);
      expect(config.workspace.mount_path).toBe(path.join(os.homedir(), 'workspaces'));
      expect(config.repos.scan_paths[0]).toBe(path.join(os.homedir(), 'Repositories'));
      expect(config.repos.index_path).toBe(path.join(os.homedir(), 'Horus/data/config/repos.json'));
    });

    it('expands filesystem registry paths', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          { type: 'filesystem', name: 'local', path: '~/registry' },
        ],
      }));

      const config = await loadGlobalConfig(configPath);
      expect((config.registries[0] as any).path).toBe(path.join(os.homedir(), 'registry'));
    });

    it('returns empty config for malformed yaml', async () => {
      await fs.writeFile(configPath, '{{not valid yaml');
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toEqual([]);
    });

    it('handles config with no registries field', async () => {
      await fs.writeFile(configPath, toYaml({
        workspace: { mount_path: '~/workspaces' },
      }));
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toEqual([]);
      expect(config.workspace.mount_path).toBe(path.join(os.homedir(), 'workspaces'));
    });

    it('does not expand git registry URLs', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          {
            type: 'git',
            name: 'team',
            url: 'https://github.com/org/reg.git',
            branch: 'main',
            path: 'registry',
          },
        ],
      }));

      const config = await loadGlobalConfig(configPath);
      expect((config.registries[0] as any).url).toBe('https://github.com/org/reg.git');
    });
  });

  describe('saveGlobalConfig()', () => {
    it('creates parent directory and writes config', async () => {
      const nestedPath = path.join(tmpDir, 'sub', 'dir', 'config.yaml');
      await saveGlobalConfig({
        registries: [
          { type: 'filesystem', name: 'local', path: '/some/path' },
        ],
        workspace: { mount_path: '~/workspaces', default_config: 'default', retention_days: 30, store_path: '~/Horus/data/config/workspaces.json', sessions_path: '~/Horus/data/config/sessions.json', managed_repos_path: '~/Horus/data/repos', sessions_root: '~/Horus/data/sessions' },
        mcp_endpoints: {},
        repos: { scan_paths: [], index_path: '~/Horus/data/config/repos.json' },
      }, nestedPath);

      const config = await loadGlobalConfig(nestedPath);
      expect(config.registries).toHaveLength(1);
      expect(config.registries[0]!.name).toBe('local');
    });

    it('does not expand paths when saving', async () => {
      const configObj: GlobalConfig = GlobalConfigSchema.parse({
        registries: [],
        workspace: { mount_path: '~/workspaces', default_config: 'default', retention_days: 30 },
        mcp_endpoints: {},
        repos: { scan_paths: ['~/Repos'], index_path: '~/Horus/data/config/repos.json' },
      });

      await saveGlobalConfig(configObj, configPath);
      const rawYaml = await fs.readFile(configPath, 'utf-8');
      
      // Verify tilde paths are preserved in the file
      expect(rawYaml).toContain('~/workspaces');
      expect(rawYaml).toContain('~/Repos');
    });
  });

  describe('Round-trip: save and load', () => {
    it('preserves all config sections', async () => {
      const original: GlobalConfig = GlobalConfigSchema.parse({
        registries: [
          { type: 'filesystem', name: 'local', path: '/registry' },
        ],
        workspace: {
          mount_path: '/home/user/workspaces',
          default_config: 'my-config',
          retention_days: 45,
        },
        mcp_endpoints: {
          anvil: { url: 'http://localhost:3002', transport: 'http' },
        },
        repos: {
          scan_paths: ['/home/user/Repos', '/home/user/Projects'],
          index_path: '/home/user/.forge/repos.json',
        },
      });

      await saveGlobalConfig(original, configPath);
      const loaded = await loadGlobalConfig(configPath);

      expect(loaded.registries).toHaveLength(1);
      expect(loaded.workspace.mount_path).toBe('/home/user/workspaces');
      expect(loaded.workspace.default_config).toBe('my-config');
      expect(loaded.workspace.retention_days).toBe(45);
      expect(loaded.mcp_endpoints.anvil?.url).toBe('http://localhost:3002');
      expect(loaded.repos.scan_paths).toEqual(['/home/user/Repos', '/home/user/Projects']);
    });
  });

  describe('addGlobalRegistry()', () => {
    it('adds a registry to empty config', async () => {
      const config = await addGlobalRegistry(
        { type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' },
        configPath,
      );
      expect(config.registries).toHaveLength(1);
      expect(config.registries[0]!.name).toBe('team');
    });

    it('replaces existing registry with same name', async () => {
      await addGlobalRegistry(
        { type: 'git', name: 'team', url: 'https://old-url.com/reg.git', branch: 'main', path: 'registry' },
        configPath,
      );
      const config = await addGlobalRegistry(
        { type: 'git', name: 'team', url: 'https://new-url.com/reg.git', branch: 'main', path: 'registry' },
        configPath,
      );
      expect(config.registries).toHaveLength(1);
      expect((config.registries[0] as any).url).toBe('https://new-url.com/reg.git');
    });

    it('preserves other sections when adding registry', async () => {
      // Set up initial config
      await saveGlobalConfig({
        registries: [],
        workspace: { mount_path: '~/workspaces', default_config: 'custom', retention_days: 60, store_path: '~/Horus/data/config/workspaces.json', sessions_path: '~/Horus/data/config/sessions.json', managed_repos_path: '~/Horus/data/repos', sessions_root: '~/Horus/data/sessions' },
        mcp_endpoints: {},
        repos: { scan_paths: [], index_path: '~/Horus/data/config/repos.json' },
      }, configPath);

      // Add a registry
      const config = await addGlobalRegistry(
        { type: 'filesystem', name: 'local', path: '/registry' },
        configPath,
      );

      expect(config.registries).toHaveLength(1);
      expect(config.workspace.default_config).toBe('custom');
      expect(config.workspace.retention_days).toBe(60);
    });

    it('persists to disk', async () => {
      await addGlobalRegistry(
        { type: 'filesystem', name: 'local', path: '/reg' },
        configPath,
      );
      const loaded = await loadGlobalConfig(configPath);
      expect(loaded.registries).toHaveLength(1);
    });
  });

  describe('removeGlobalRegistry()', () => {
    it('removes a registry by name', async () => {
      await addGlobalRegistry(
        { type: 'filesystem', name: 'to-remove', path: '/reg' },
        configPath,
      );
      const config = await removeGlobalRegistry('to-remove', configPath);
      expect(config.registries).toHaveLength(0);
    });

    it('no-ops if registry name not found', async () => {
      await addGlobalRegistry(
        { type: 'filesystem', name: 'keep', path: '/reg' },
        configPath,
      );
      const config = await removeGlobalRegistry('nonexistent', configPath);
      expect(config.registries).toHaveLength(1);
      expect(config.registries[0]!.name).toBe('keep');
    });

    it('preserves other sections when removing registry', async () => {
      // Set up initial config with registry and workspace settings
      await saveGlobalConfig({
        registries: [
          { type: 'filesystem', name: 'local', path: '/registry' },
        ],
        workspace: { mount_path: '~/workspaces', default_config: 'custom', retention_days: 50, store_path: '~/Horus/data/config/workspaces.json', sessions_path: '~/Horus/data/config/sessions.json', managed_repos_path: '~/Horus/data/repos', sessions_root: '~/Horus/data/sessions' },
        mcp_endpoints: {},
        repos: { scan_paths: [], index_path: '~/Horus/data/config/repos.json' },
      }, configPath);

      const config = await removeGlobalRegistry('local', configPath);
      expect(config.registries).toHaveLength(0);
      expect(config.workspace.default_config).toBe('custom');
      expect(config.workspace.retention_days).toBe(50);
    });
  });

  describe('Backward compatibility', () => {
    it('loads registries-only config (legacy format)', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          { type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' },
        ],
      }));

      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toHaveLength(1);
      expect(config.registries[0]!.name).toBe('team');
      // New sections should have defaults
      expect(config.workspace.mount_path).toBe(path.join(os.homedir(), 'forge-workspaces'));
      expect(config.mcp_endpoints).toEqual({});
      expect(config.repos.scan_paths).toEqual([]);
    });
  });
});
