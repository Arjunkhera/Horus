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
} from '../global-config-loader.js';

describe('Global Config Loader', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-global-cfg-'));
    configPath = path.join(tmpDir, 'config.yaml');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadGlobalConfig()', () => {
    it('returns empty config when file does not exist', async () => {
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toEqual([]);
    });

    it('loads a valid config file', async () => {
      await fs.writeFile(configPath, toYaml({
        registries: [
          { type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' },
        ],
      }));

      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toHaveLength(1);
      expect(config.registries[0]!.name).toBe('team');
      expect(config.registries[0]!.type).toBe('git');
    });

    it('returns empty config for malformed yaml', async () => {
      await fs.writeFile(configPath, '{{not valid yaml');
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toEqual([]);
    });

    it('handles config with no registries field', async () => {
      await fs.writeFile(configPath, toYaml({}));
      const config = await loadGlobalConfig(configPath);
      expect(config.registries).toEqual([]);
    });
  });

  describe('saveGlobalConfig()', () => {
    it('creates parent directory and writes config', async () => {
      const nestedPath = path.join(tmpDir, 'sub', 'dir', 'config.yaml');
      await saveGlobalConfig({
        registries: [
          { type: 'filesystem', name: 'local', path: '/some/path' },
        ],
      }, nestedPath);

      const config = await loadGlobalConfig(nestedPath);
      expect(config.registries).toHaveLength(1);
      expect(config.registries[0]!.name).toBe('local');
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
  });
});
