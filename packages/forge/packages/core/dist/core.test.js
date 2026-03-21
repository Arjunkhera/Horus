"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const yaml_1 = require("yaml");
const core_js_1 = require("./core.js");
const global_config_loader_js_1 = require("./config/global-config-loader.js");
(0, vitest_1.describe)('ForgeCore — integration', () => {
    let tmpDir;
    let forge;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-core-test-'));
        forge = new core_js_1.ForgeCore(tmpDir);
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    async function createRegistrySkill(skillId) {
        const dir = path_1.default.join(tmpDir, 'registry', 'skills', skillId);
        await fs_1.promises.mkdir(dir, { recursive: true });
        await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)({
            id: skillId, name: `Skill ${skillId}`, version: '1.0.0',
            description: `The ${skillId} skill`, type: 'skill', tags: [], dependencies: {}, files: []
        }));
        await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), `# ${skillId}\nThis is the ${skillId} skill.`);
    }
    (0, vitest_1.describe)('init → add → install pipeline', () => {
        (0, vitest_1.it)('initializes workspace successfully', async () => {
            await forge.init('test-workspace');
            const config = await forge.getConfig();
            (0, vitest_1.expect)(config.name).toBe('test-workspace');
        });
        (0, vitest_1.it)('install → verify files on disk after full pipeline', async () => {
            await forge.init('test-workspace');
            await createRegistrySkill('developer');
            // Manually add skill to config
            const config = await forge.getConfig();
            config.artifacts.skills['developer'] = '1.0.0';
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            const report = await forge.install();
            (0, vitest_1.expect)(report.installed).toHaveLength(1);
            (0, vitest_1.expect)(report.installed[0].id).toBe('developer');
            // Verify file written to disk
            const skillFile = path_1.default.join(tmpDir, '.claude', 'skills', 'developer', 'SKILL.md');
            const exists = await fs_1.promises.access(skillFile).then(() => true).catch(() => false);
            (0, vitest_1.expect)(exists).toBe(true);
            const content = await fs_1.promises.readFile(skillFile, 'utf-8');
            (0, vitest_1.expect)(content).toContain('developer');
        });
        (0, vitest_1.it)('dry run does not write files', async () => {
            await forge.init('test-workspace');
            await createRegistrySkill('developer');
            const config = await forge.getConfig();
            config.artifacts.skills['developer'] = '1.0.0';
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            const report = await forge.install({ dryRun: true });
            (0, vitest_1.expect)(report.filesWritten).toHaveLength(1);
            // File should NOT actually exist
            const skillFile = path_1.default.join(tmpDir, '.claude', 'skills', 'developer', 'SKILL.md');
            const exists = await fs_1.promises.access(skillFile).then(() => true).catch(() => false);
            (0, vitest_1.expect)(exists).toBe(false);
        });
    });
    (0, vitest_1.describe)('list()', () => {
        (0, vitest_1.it)('returns empty list when nothing installed', async () => {
            await forge.init('test-workspace');
            const installed = await forge.list('installed');
            (0, vitest_1.expect)(installed).toHaveLength(0);
        });
    });
    (0, vitest_1.describe)('remove()', () => {
        (0, vitest_1.it)('removes artifact from config', async () => {
            await forge.init('test-workspace');
            const config = await forge.getConfig();
            config.artifacts.skills['developer'] = '1.0.0';
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            await forge.remove('skill:developer');
            const updated = await forge.getConfig();
            (0, vitest_1.expect)(updated.artifacts.skills['developer']).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('buildRegistry() — multi-adapter wiring', () => {
        async function createRegistryAt(registryDir, skillId) {
            const dir = path_1.default.join(registryDir, 'skills', skillId);
            await fs_1.promises.mkdir(dir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)({
                id: skillId, name: `Skill ${skillId}`, version: '1.0.0',
                description: `The ${skillId} skill`, type: 'skill', tags: [], dependencies: {}, files: [],
            }));
            await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), `# ${skillId}\nThis is ${skillId}.`);
        }
        (0, vitest_1.it)('uses filesystem registry from config', async () => {
            await forge.init('test-workspace');
            // Create a registry in a non-default location
            const externalReg = path_1.default.join(tmpDir, 'my-registry');
            await createRegistryAt(externalReg, 'custom-skill');
            // Update config to point at it
            const config = await forge.getConfig();
            config.registries = [{ type: 'filesystem', name: 'local', path: externalReg }];
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            const results = await forge.search('custom-skill');
            (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(results[0].ref.id).toBe('custom-skill');
        });
        (0, vitest_1.it)('composes multiple filesystem registries with priority ordering', async () => {
            await forge.init('test-workspace');
            // Primary registry has skill-a
            const primaryReg = path_1.default.join(tmpDir, 'primary-reg');
            await createRegistryAt(primaryReg, 'skill-a');
            // Secondary registry has skill-b
            const secondaryReg = path_1.default.join(tmpDir, 'secondary-reg');
            await createRegistryAt(secondaryReg, 'skill-b');
            const config = await forge.getConfig();
            config.registries = [
                { type: 'filesystem', name: 'primary', path: primaryReg },
                { type: 'filesystem', name: 'secondary', path: secondaryReg },
            ];
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            // Both skills should be discoverable
            const listResult = await forge.list('available');
            const ids = listResult.map(s => s.ref.id);
            (0, vitest_1.expect)(ids).toContain('skill-a');
            (0, vitest_1.expect)(ids).toContain('skill-b');
        });
        (0, vitest_1.it)('falls back to default registry when no registries configured', async () => {
            await forge.init('test-workspace');
            await createRegistrySkill('fallback-skill');
            // Config has no registries — should fall back to <root>/registry
            const results = await forge.search('fallback-skill');
            (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('skips unsupported http registry with warning and uses remaining', async () => {
            await forge.init('test-workspace');
            const fsReg = path_1.default.join(tmpDir, 'fs-reg');
            await createRegistryAt(fsReg, 'fs-skill');
            const config = await forge.getConfig();
            config.registries = [
                { type: 'http', name: 'remote', url: 'https://example.com/api' },
                { type: 'filesystem', name: 'local', path: fsReg },
            ];
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            // Should still work — http registry is skipped, fs registry used
            const results = await forge.search('fs-skill');
            (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('install works through composed registries', async () => {
            await forge.init('test-workspace');
            const externalReg = path_1.default.join(tmpDir, 'ext-registry');
            await createRegistryAt(externalReg, 'ext-skill');
            const config = await forge.getConfig();
            config.registries = [{ type: 'filesystem', name: 'ext', path: externalReg }];
            config.artifacts.skills['ext-skill'] = '1.0.0';
            const wm = forge.workspaceManager;
            await wm.writeConfig(config);
            const report = await forge.install();
            (0, vitest_1.expect)(report.installed).toHaveLength(1);
            (0, vitest_1.expect)(report.installed[0].id).toBe('ext-skill');
            // Verify file on disk
            const skillFile = path_1.default.join(tmpDir, '.claude', 'skills', 'ext-skill', 'SKILL.md');
            const content = await fs_1.promises.readFile(skillFile, 'utf-8');
            (0, vitest_1.expect)(content).toContain('ext-skill');
        });
    });
    (0, vitest_1.describe)('global config merge', () => {
        let globalConfigPath;
        let globalForge;
        (0, vitest_1.beforeEach)(async () => {
            globalConfigPath = path_1.default.join(tmpDir, '.forge-global', 'config.yaml');
            globalForge = new core_js_1.ForgeCore(tmpDir, { globalConfigPath });
        });
        async function createRegistryAt(registryDir, skillId) {
            const dir = path_1.default.join(registryDir, 'skills', skillId);
            await fs_1.promises.mkdir(dir, { recursive: true });
            await fs_1.promises.writeFile(path_1.default.join(dir, 'metadata.yaml'), (0, yaml_1.stringify)({
                id: skillId, name: `Skill ${skillId}`, version: '1.0.0',
                description: `The ${skillId} skill`, type: 'skill', tags: [], dependencies: {}, files: [],
            }));
            await fs_1.promises.writeFile(path_1.default.join(dir, 'SKILL.md'), `# ${skillId}\nThis is ${skillId}.`);
        }
        (0, vitest_1.it)('uses global registries when workspace has none', async () => {
            await globalForge.init('test-workspace');
            // Create a global registry
            const globalReg = path_1.default.join(tmpDir, 'global-reg');
            await createRegistryAt(globalReg, 'global-skill');
            // Save global config
            await (0, global_config_loader_js_1.saveGlobalConfig)({
                registries: [{ type: 'filesystem', name: 'global', path: globalReg }],
            }, globalConfigPath);
            // Clear workspace registries
            const config = await globalForge.getConfig();
            config.registries = [];
            const wm = globalForge.workspaceManager;
            await wm.writeConfig(config);
            const results = await globalForge.search('global-skill');
            (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(results[0].ref.id).toBe('global-skill');
        });
        (0, vitest_1.it)('workspace registries take priority over global', async () => {
            await globalForge.init('test-workspace');
            // Both have a registry named "shared" with different skills
            const workspaceReg = path_1.default.join(tmpDir, 'ws-reg');
            await createRegistryAt(workspaceReg, 'ws-skill');
            const globalReg = path_1.default.join(tmpDir, 'gl-reg');
            await createRegistryAt(globalReg, 'gl-skill');
            // Workspace config has "shared" registry
            const config = await globalForge.getConfig();
            config.registries = [{ type: 'filesystem', name: 'shared', path: workspaceReg }];
            const wm = globalForge.workspaceManager;
            await wm.writeConfig(config);
            // Global config also has "shared" registry (different path)
            await (0, global_config_loader_js_1.saveGlobalConfig)({
                registries: [{ type: 'filesystem', name: 'shared', path: globalReg }],
            }, globalConfigPath);
            // Should only see workspace skill since names conflict → workspace wins
            const results = await globalForge.list('available');
            const ids = results.map(r => r.ref.id);
            (0, vitest_1.expect)(ids).toContain('ws-skill');
            (0, vitest_1.expect)(ids).not.toContain('gl-skill');
        });
        (0, vitest_1.it)('merges workspace and global registries with different names', async () => {
            await globalForge.init('test-workspace');
            const workspaceReg = path_1.default.join(tmpDir, 'ws-reg');
            await createRegistryAt(workspaceReg, 'ws-skill');
            const globalReg = path_1.default.join(tmpDir, 'gl-reg');
            await createRegistryAt(globalReg, 'gl-skill');
            const config = await globalForge.getConfig();
            config.registries = [{ type: 'filesystem', name: 'workspace', path: workspaceReg }];
            const wm = globalForge.workspaceManager;
            await wm.writeConfig(config);
            await (0, global_config_loader_js_1.saveGlobalConfig)({
                registries: [{ type: 'filesystem', name: 'global', path: globalReg }],
            }, globalConfigPath);
            // Both skills should be visible
            const results = await globalForge.list('available');
            const ids = results.map(r => r.ref.id);
            (0, vitest_1.expect)(ids).toContain('ws-skill');
            (0, vitest_1.expect)(ids).toContain('gl-skill');
        });
        (0, vitest_1.it)('works with no global config file', async () => {
            await globalForge.init('test-workspace');
            await createRegistrySkill('local-skill');
            // No global config exists — should work fine with just workspace config
            const results = await globalForge.search('local-skill');
            (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
        });
    });
    (0, vitest_1.describe)('parseRef()', () => {
        (0, vitest_1.it)('parses type:id@version', () => {
            const parse = forge.parseRef.bind(forge);
            (0, vitest_1.expect)(parse('skill:developer@1.0.0')).toEqual({ type: 'skill', id: 'developer', version: '1.0.0' });
        });
        (0, vitest_1.it)('parses agent:id', () => {
            const parse = forge.parseRef.bind(forge);
            (0, vitest_1.expect)(parse('agent:my-agent')).toEqual({ type: 'agent', id: 'my-agent', version: '*' });
        });
        (0, vitest_1.it)('parses bare id as skill', () => {
            const parse = forge.parseRef.bind(forge);
            (0, vitest_1.expect)(parse('developer')).toEqual({ type: 'skill', id: 'developer', version: '*' });
        });
    });
});
//# sourceMappingURL=core.test.js.map