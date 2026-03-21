import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as toYaml } from 'yaml';
import { ForgeCore } from './core.js';
import { saveGlobalConfig } from './config/global-config-loader.js';

describe('ForgeCore — integration', () => {
  let tmpDir: string;
  let forge: ForgeCore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-core-test-'));
    forge = new ForgeCore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createRegistrySkill(skillId: string) {
    const dir = path.join(tmpDir, 'registry', 'skills', skillId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
      id: skillId, name: `Skill ${skillId}`, version: '1.0.0',
      description: `The ${skillId} skill`, type: 'skill', tags: [], dependencies: {}, files: []
    }));
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${skillId}\nThis is the ${skillId} skill.`);
  }

  describe('init → add → install pipeline', () => {
    it('initializes workspace successfully', async () => {
      await forge.init('test-workspace');
      const config = await forge.getConfig();
      expect(config.name).toBe('test-workspace');
    });

    it('install → verify files on disk after full pipeline', async () => {
      await forge.init('test-workspace');
      await createRegistrySkill('developer');

      // Manually add skill to config
      const config = await forge.getConfig();
      config.artifacts.skills['developer'] = '1.0.0';
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      const report = await forge.install();
      expect(report.installed).toHaveLength(1);
      expect(report.installed[0]!.id).toBe('developer');

      // Verify file written to disk
      const skillFile = path.join(tmpDir, '.claude', 'skills', 'developer', 'SKILL.md');
      const exists = await fs.access(skillFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      const content = await fs.readFile(skillFile, 'utf-8');
      expect(content).toContain('developer');
    });

    it('dry run does not write files', async () => {
      await forge.init('test-workspace');
      await createRegistrySkill('developer');

      const config = await forge.getConfig();
      config.artifacts.skills['developer'] = '1.0.0';
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      const report = await forge.install({ dryRun: true });
      expect(report.filesWritten).toHaveLength(1);
      // File should NOT actually exist
      const skillFile = path.join(tmpDir, '.claude', 'skills', 'developer', 'SKILL.md');
      const exists = await fs.access(skillFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('list()', () => {
    it('returns empty list when nothing installed', async () => {
      await forge.init('test-workspace');
      const installed = await forge.list('installed');
      expect(installed).toHaveLength(0);
    });
  });

  describe('remove()', () => {
    it('removes artifact from config', async () => {
      await forge.init('test-workspace');
      const config = await forge.getConfig();
      config.artifacts.skills['developer'] = '1.0.0';
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      await forge.remove('skill:developer');
      const updated = await forge.getConfig();
      expect(updated.artifacts.skills['developer']).toBeUndefined();
    });
  });

  describe('buildRegistry() — multi-adapter wiring', () => {
    async function createRegistryAt(registryDir: string, skillId: string) {
      const dir = path.join(registryDir, 'skills', skillId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
        id: skillId, name: `Skill ${skillId}`, version: '1.0.0',
        description: `The ${skillId} skill`, type: 'skill', tags: [], dependencies: {}, files: [],
      }));
      await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${skillId}\nThis is ${skillId}.`);
    }

    it('uses filesystem registry from config', async () => {
      await forge.init('test-workspace');

      // Create a registry in a non-default location
      const externalReg = path.join(tmpDir, 'my-registry');
      await createRegistryAt(externalReg, 'custom-skill');

      // Update config to point at it
      const config = await forge.getConfig();
      config.registries = [{ type: 'filesystem' as const, name: 'local', path: externalReg }];
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      const results = await forge.search('custom-skill');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.ref.id).toBe('custom-skill');
    });

    it('composes multiple filesystem registries with priority ordering', async () => {
      await forge.init('test-workspace');

      // Primary registry has skill-a
      const primaryReg = path.join(tmpDir, 'primary-reg');
      await createRegistryAt(primaryReg, 'skill-a');

      // Secondary registry has skill-b
      const secondaryReg = path.join(tmpDir, 'secondary-reg');
      await createRegistryAt(secondaryReg, 'skill-b');

      const config = await forge.getConfig();
      config.registries = [
        { type: 'filesystem' as const, name: 'primary', path: primaryReg },
        { type: 'filesystem' as const, name: 'secondary', path: secondaryReg },
      ];
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      // Both skills should be discoverable
      const listResult = await forge.list('available');
      const ids = listResult.map(s => s.ref.id);
      expect(ids).toContain('skill-a');
      expect(ids).toContain('skill-b');
    });

    it('falls back to default registry when no registries configured', async () => {
      await forge.init('test-workspace');
      await createRegistrySkill('fallback-skill');

      // Config has no registries — should fall back to <root>/registry
      const results = await forge.search('fallback-skill');
      expect(results.length).toBeGreaterThan(0);
    });

    it('skips unsupported http registry with warning and uses remaining', async () => {
      await forge.init('test-workspace');

      const fsReg = path.join(tmpDir, 'fs-reg');
      await createRegistryAt(fsReg, 'fs-skill');

      const config = await forge.getConfig();
      config.registries = [
        { type: 'http' as const, name: 'remote', url: 'https://example.com/api' },
        { type: 'filesystem' as const, name: 'local', path: fsReg },
      ];
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      // Should still work — http registry is skipped, fs registry used
      const results = await forge.search('fs-skill');
      expect(results.length).toBeGreaterThan(0);
    });

    it('install works through composed registries', async () => {
      await forge.init('test-workspace');

      const externalReg = path.join(tmpDir, 'ext-registry');
      await createRegistryAt(externalReg, 'ext-skill');

      const config = await forge.getConfig();
      config.registries = [{ type: 'filesystem' as const, name: 'ext', path: externalReg }];
      config.artifacts.skills['ext-skill'] = '1.0.0';
      const wm = (forge as any).workspaceManager;
      await wm.writeConfig(config);

      const report = await forge.install();
      expect(report.installed).toHaveLength(1);
      expect(report.installed[0]!.id).toBe('ext-skill');

      // Verify file on disk
      const skillFile = path.join(tmpDir, '.claude', 'skills', 'ext-skill', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');
      expect(content).toContain('ext-skill');
    });
  });

  describe('global config merge', () => {
    let globalConfigPath: string;
    let globalForge: ForgeCore;

    beforeEach(async () => {
      globalConfigPath = path.join(tmpDir, '.forge-global', 'config.yaml');
      globalForge = new ForgeCore(tmpDir, { globalConfigPath });
    });

    async function createRegistryAt(registryDir: string, skillId: string) {
      const dir = path.join(registryDir, 'skills', skillId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'metadata.yaml'), toYaml({
        id: skillId, name: `Skill ${skillId}`, version: '1.0.0',
        description: `The ${skillId} skill`, type: 'skill', tags: [], dependencies: {}, files: [],
      }));
      await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${skillId}\nThis is ${skillId}.`);
    }

    it('uses global registries when workspace has none', async () => {
      await globalForge.init('test-workspace');

      // Create a global registry
      const globalReg = path.join(tmpDir, 'global-reg');
      await createRegistryAt(globalReg, 'global-skill');

      // Save global config
      await saveGlobalConfig({
        registries: [{ type: 'filesystem', name: 'global', path: globalReg }],
      }, globalConfigPath);

      // Clear workspace registries
      const config = await globalForge.getConfig();
      config.registries = [];
      const wm = (globalForge as any).workspaceManager;
      await wm.writeConfig(config);

      const results = await globalForge.search('global-skill');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.ref.id).toBe('global-skill');
    });

    it('workspace registries take priority over global', async () => {
      await globalForge.init('test-workspace');

      // Both have a registry named "shared" with different skills
      const workspaceReg = path.join(tmpDir, 'ws-reg');
      await createRegistryAt(workspaceReg, 'ws-skill');

      const globalReg = path.join(tmpDir, 'gl-reg');
      await createRegistryAt(globalReg, 'gl-skill');

      // Workspace config has "shared" registry
      const config = await globalForge.getConfig();
      config.registries = [{ type: 'filesystem' as const, name: 'shared', path: workspaceReg }];
      const wm = (globalForge as any).workspaceManager;
      await wm.writeConfig(config);

      // Global config also has "shared" registry (different path)
      await saveGlobalConfig({
        registries: [{ type: 'filesystem', name: 'shared', path: globalReg }],
      }, globalConfigPath);

      // Should only see workspace skill since names conflict → workspace wins
      const results = await globalForge.list('available');
      const ids = results.map(r => r.ref.id);
      expect(ids).toContain('ws-skill');
      expect(ids).not.toContain('gl-skill');
    });

    it('merges workspace and global registries with different names', async () => {
      await globalForge.init('test-workspace');

      const workspaceReg = path.join(tmpDir, 'ws-reg');
      await createRegistryAt(workspaceReg, 'ws-skill');

      const globalReg = path.join(tmpDir, 'gl-reg');
      await createRegistryAt(globalReg, 'gl-skill');

      const config = await globalForge.getConfig();
      config.registries = [{ type: 'filesystem' as const, name: 'workspace', path: workspaceReg }];
      const wm = (globalForge as any).workspaceManager;
      await wm.writeConfig(config);

      await saveGlobalConfig({
        registries: [{ type: 'filesystem', name: 'global', path: globalReg }],
      }, globalConfigPath);

      // Both skills should be visible
      const results = await globalForge.list('available');
      const ids = results.map(r => r.ref.id);
      expect(ids).toContain('ws-skill');
      expect(ids).toContain('gl-skill');
    });

    it('works with no global config file', async () => {
      await globalForge.init('test-workspace');
      await createRegistrySkill('local-skill');

      // No global config exists — should work fine with just workspace config
      const results = await globalForge.search('local-skill');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('parseRef()', () => {
    it('parses type:id@version', () => {
      const parse = (forge as any).parseRef.bind(forge);
      expect(parse('skill:developer@1.0.0')).toEqual({ type: 'skill', id: 'developer', version: '1.0.0' });
    });

    it('parses agent:id', () => {
      const parse = (forge as any).parseRef.bind(forge);
      expect(parse('agent:my-agent')).toEqual({ type: 'agent', id: 'my-agent', version: '*' });
    });

    it('parses bare id as skill', () => {
      const parse = (forge as any).parseRef.bind(forge);
      expect(parse('developer')).toEqual({ type: 'skill', id: 'developer', version: '*' });
    });
  });
});
