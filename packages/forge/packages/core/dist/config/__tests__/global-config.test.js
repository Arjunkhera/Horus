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
const index_js_1 = require("../index.js");
const global_config_js_1 = require("../../models/global-config.js");
(0, vitest_1.describe)('Global Config', () => {
    let tmpDir;
    let configPath;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-global-cfg-'));
        configPath = path_1.default.join(tmpDir, 'config.yaml');
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('expandPath()', () => {
        (0, vitest_1.it)('expands ~ to home directory', () => {
            const expanded = (0, index_js_1.expandPath)('~/Documents');
            (0, vitest_1.expect)(expanded).toBe(path_1.default.join(os_1.default.homedir(), 'Documents'));
        });
        (0, vitest_1.it)('expands ~ alone to home directory', () => {
            const expanded = (0, index_js_1.expandPath)('~');
            (0, vitest_1.expect)(expanded).toBe(os_1.default.homedir());
        });
        (0, vitest_1.it)('leaves absolute paths unchanged', () => {
            const absPath = '/absolute/path';
            (0, vitest_1.expect)((0, index_js_1.expandPath)(absPath)).toBe(absPath);
        });
        (0, vitest_1.it)('leaves relative paths unchanged', () => {
            const relPath = 'relative/path';
            (0, vitest_1.expect)((0, index_js_1.expandPath)(relPath)).toBe(relPath);
        });
    });
    (0, vitest_1.describe)('expandPaths()', () => {
        (0, vitest_1.it)('expands multiple paths', () => {
            const paths = ['~/Documents', '~/Projects', '/absolute/path', 'relative'];
            const expanded = (0, index_js_1.expandPaths)(paths);
            (0, vitest_1.expect)(expanded).toEqual([
                path_1.default.join(os_1.default.homedir(), 'Documents'),
                path_1.default.join(os_1.default.homedir(), 'Projects'),
                '/absolute/path',
                'relative',
            ]);
        });
        (0, vitest_1.it)('handles empty array', () => {
            (0, vitest_1.expect)((0, index_js_1.expandPaths)([])).toEqual([]);
        });
    });
    (0, vitest_1.describe)('GlobalConfigSchema', () => {
        (0, vitest_1.it)('parses config with all four sections', () => {
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
            const config = global_config_js_1.GlobalConfigSchema.parse(raw);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe('~/workspaces');
            (0, vitest_1.expect)(config.workspace.retention_days).toBe(60);
            (0, vitest_1.expect)(config.mcp_endpoints.anvil?.transport).toBe('http');
            (0, vitest_1.expect)(config.mcp_endpoints.vault?.transport).toBe('stdio');
            (0, vitest_1.expect)(config.repos.scan_paths).toEqual(['~/Repositories', '~/Projects']);
        });
        (0, vitest_1.it)('applies defaults for missing sections', () => {
            const raw = {
                registries: [
                    { type: 'filesystem', name: 'local', path: '/reg' },
                ],
            };
            const config = global_config_js_1.GlobalConfigSchema.parse(raw);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe('~/forge-workspaces');
            (0, vitest_1.expect)(config.workspace.default_config).toBe('sdlc-default');
            (0, vitest_1.expect)(config.workspace.retention_days).toBe(30);
            (0, vitest_1.expect)(config.mcp_endpoints).toEqual({});
            (0, vitest_1.expect)(config.repos.scan_paths).toEqual([]);
            (0, vitest_1.expect)(config.repos.index_path).toBe('~/Horus/data/config/repos.json');
        });
        (0, vitest_1.it)('parses empty config with all defaults', () => {
            const config = global_config_js_1.GlobalConfigSchema.parse({});
            (0, vitest_1.expect)(config.registries).toEqual([]);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe('~/forge-workspaces');
            (0, vitest_1.expect)(config.workspace.default_config).toBe('sdlc-default');
            (0, vitest_1.expect)(config.workspace.retention_days).toBe(30);
            (0, vitest_1.expect)(config.mcp_endpoints).toEqual({});
            (0, vitest_1.expect)(config.repos.scan_paths).toEqual([]);
            (0, vitest_1.expect)(config.repos.index_path).toBe('~/Horus/data/config/repos.json');
        });
        (0, vitest_1.it)('allows partial MCP endpoints', () => {
            const raw = {
                mcp_endpoints: {
                    anvil: { url: 'http://localhost:3002', transport: 'http' },
                },
            };
            const config = global_config_js_1.GlobalConfigSchema.parse(raw);
            (0, vitest_1.expect)(config.mcp_endpoints.anvil).toBeDefined();
            (0, vitest_1.expect)(config.mcp_endpoints.vault).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('loadGlobalConfig()', () => {
        (0, vitest_1.it)('returns empty config when file does not exist', async () => {
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toEqual([]);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe('~/forge-workspaces');
        });
        (0, vitest_1.it)('loads a valid config file with all sections', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
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
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe(path_1.default.join(os_1.default.homedir(), 'my-workspaces'));
            (0, vitest_1.expect)(config.workspace.default_config).toBe('custom');
            (0, vitest_1.expect)(config.workspace.retention_days).toBe(45);
            (0, vitest_1.expect)(config.mcp_endpoints.anvil?.url).toBe('http://localhost:3002');
            (0, vitest_1.expect)(config.repos.scan_paths).toEqual([
                path_1.default.join(os_1.default.homedir(), 'Repos'),
                path_1.default.join(os_1.default.homedir(), 'Projects'),
            ]);
        });
        (0, vitest_1.it)('expands tilde paths in loaded config', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
                workspace: {
                    mount_path: '~/workspaces',
                },
                repos: {
                    scan_paths: ['~/Repositories'],
                    index_path: '~/Horus/data/config/repos.json',
                },
            }));
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe(path_1.default.join(os_1.default.homedir(), 'workspaces'));
            (0, vitest_1.expect)(config.repos.scan_paths[0]).toBe(path_1.default.join(os_1.default.homedir(), 'Repositories'));
            (0, vitest_1.expect)(config.repos.index_path).toBe(path_1.default.join(os_1.default.homedir(), 'Horus/data/config/repos.json'));
        });
        (0, vitest_1.it)('expands filesystem registry paths', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
                registries: [
                    { type: 'filesystem', name: 'local', path: '~/registry' },
                ],
            }));
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries[0].path).toBe(path_1.default.join(os_1.default.homedir(), 'registry'));
        });
        (0, vitest_1.it)('returns empty config for malformed yaml', async () => {
            await fs_1.promises.writeFile(configPath, '{{not valid yaml');
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toEqual([]);
        });
        (0, vitest_1.it)('handles config with no registries field', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
                workspace: { mount_path: '~/workspaces' },
            }));
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toEqual([]);
            (0, vitest_1.expect)(config.workspace.mount_path).toBe(path_1.default.join(os_1.default.homedir(), 'workspaces'));
        });
        (0, vitest_1.it)('does not expand git registry URLs', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
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
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries[0].url).toBe('https://github.com/org/reg.git');
        });
    });
    (0, vitest_1.describe)('saveGlobalConfig()', () => {
        (0, vitest_1.it)('creates parent directory and writes config', async () => {
            const nestedPath = path_1.default.join(tmpDir, 'sub', 'dir', 'config.yaml');
            await (0, index_js_1.saveGlobalConfig)({
                registries: [
                    { type: 'filesystem', name: 'local', path: '/some/path' },
                ],
                workspace: { mount_path: '~/workspaces', default_config: 'default', retention_days: 30, store_path: '~/Horus/data/config/workspaces.json', sessions_path: '~/Horus/data/config/sessions.json', managed_repos_path: '~/Horus/data/repos', sessions_root: '~/Horus/data/sessions', max_sessions: 20 },
                mcp_endpoints: {},
                repos: { scan_paths: [], index_path: '~/Horus/data/config/repos.json' },
            }, nestedPath);
            const config = await (0, index_js_1.loadGlobalConfig)(nestedPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('local');
        });
        (0, vitest_1.it)('does not expand paths when saving', async () => {
            const configObj = global_config_js_1.GlobalConfigSchema.parse({
                registries: [],
                workspace: { mount_path: '~/workspaces', default_config: 'default', retention_days: 30 },
                mcp_endpoints: {},
                repos: { scan_paths: ['~/Repos'], index_path: '~/Horus/data/config/repos.json' },
            });
            await (0, index_js_1.saveGlobalConfig)(configObj, configPath);
            const rawYaml = await fs_1.promises.readFile(configPath, 'utf-8');
            // Verify tilde paths are preserved in the file
            (0, vitest_1.expect)(rawYaml).toContain('~/workspaces');
            (0, vitest_1.expect)(rawYaml).toContain('~/Repos');
        });
    });
    (0, vitest_1.describe)('Round-trip: save and load', () => {
        (0, vitest_1.it)('preserves all config sections', async () => {
            const original = global_config_js_1.GlobalConfigSchema.parse({
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
            await (0, index_js_1.saveGlobalConfig)(original, configPath);
            const loaded = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(loaded.registries).toHaveLength(1);
            (0, vitest_1.expect)(loaded.workspace.mount_path).toBe('/home/user/workspaces');
            (0, vitest_1.expect)(loaded.workspace.default_config).toBe('my-config');
            (0, vitest_1.expect)(loaded.workspace.retention_days).toBe(45);
            (0, vitest_1.expect)(loaded.mcp_endpoints.anvil?.url).toBe('http://localhost:3002');
            (0, vitest_1.expect)(loaded.repos.scan_paths).toEqual(['/home/user/Repos', '/home/user/Projects']);
        });
    });
    (0, vitest_1.describe)('addGlobalRegistry()', () => {
        (0, vitest_1.it)('adds a registry to empty config', async () => {
            const config = await (0, index_js_1.addGlobalRegistry)({ type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' }, configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('team');
        });
        (0, vitest_1.it)('replaces existing registry with same name', async () => {
            await (0, index_js_1.addGlobalRegistry)({ type: 'git', name: 'team', url: 'https://old-url.com/reg.git', branch: 'main', path: 'registry' }, configPath);
            const config = await (0, index_js_1.addGlobalRegistry)({ type: 'git', name: 'team', url: 'https://new-url.com/reg.git', branch: 'main', path: 'registry' }, configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].url).toBe('https://new-url.com/reg.git');
        });
        (0, vitest_1.it)('preserves other sections when adding registry', async () => {
            // Set up initial config
            await (0, index_js_1.saveGlobalConfig)({
                registries: [],
                workspace: { mount_path: '~/workspaces', default_config: 'custom', retention_days: 60, store_path: '~/Horus/data/config/workspaces.json', sessions_path: '~/Horus/data/config/sessions.json', managed_repos_path: '~/Horus/data/repos', sessions_root: '~/Horus/data/sessions', max_sessions: 20 },
                mcp_endpoints: {},
                repos: { scan_paths: [], index_path: '~/Horus/data/config/repos.json' },
            }, configPath);
            // Add a registry
            const config = await (0, index_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'local', path: '/registry' }, configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.workspace.default_config).toBe('custom');
            (0, vitest_1.expect)(config.workspace.retention_days).toBe(60);
        });
        (0, vitest_1.it)('persists to disk', async () => {
            await (0, index_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'local', path: '/reg' }, configPath);
            const loaded = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(loaded.registries).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('removeGlobalRegistry()', () => {
        (0, vitest_1.it)('removes a registry by name', async () => {
            await (0, index_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'to-remove', path: '/reg' }, configPath);
            const config = await (0, index_js_1.removeGlobalRegistry)('to-remove', configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(0);
        });
        (0, vitest_1.it)('no-ops if registry name not found', async () => {
            await (0, index_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'keep', path: '/reg' }, configPath);
            const config = await (0, index_js_1.removeGlobalRegistry)('nonexistent', configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('keep');
        });
        (0, vitest_1.it)('preserves other sections when removing registry', async () => {
            // Set up initial config with registry and workspace settings
            await (0, index_js_1.saveGlobalConfig)({
                registries: [
                    { type: 'filesystem', name: 'local', path: '/registry' },
                ],
                workspace: { mount_path: '~/workspaces', default_config: 'custom', retention_days: 50, store_path: '~/Horus/data/config/workspaces.json', sessions_path: '~/Horus/data/config/sessions.json', managed_repos_path: '~/Horus/data/repos', sessions_root: '~/Horus/data/sessions', max_sessions: 20 },
                mcp_endpoints: {},
                repos: { scan_paths: [], index_path: '~/Horus/data/config/repos.json' },
            }, configPath);
            const config = await (0, index_js_1.removeGlobalRegistry)('local', configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(0);
            (0, vitest_1.expect)(config.workspace.default_config).toBe('custom');
            (0, vitest_1.expect)(config.workspace.retention_days).toBe(50);
        });
    });
    (0, vitest_1.describe)('Backward compatibility', () => {
        (0, vitest_1.it)('loads registries-only config (legacy format)', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
                registries: [
                    { type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' },
                ],
            }));
            const config = await (0, index_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('team');
            // New sections should have defaults
            (0, vitest_1.expect)(config.workspace.mount_path).toBe(path_1.default.join(os_1.default.homedir(), 'forge-workspaces'));
            (0, vitest_1.expect)(config.mcp_endpoints).toEqual({});
            (0, vitest_1.expect)(config.repos.scan_paths).toEqual([]);
        });
    });
});
//# sourceMappingURL=global-config.test.js.map