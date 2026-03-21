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
const global_config_loader_js_1 = require("../global-config-loader.js");
(0, vitest_1.describe)('Global Config Loader', () => {
    let tmpDir;
    let configPath;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'forge-global-cfg-'));
        configPath = path_1.default.join(tmpDir, 'config.yaml');
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('loadGlobalConfig()', () => {
        (0, vitest_1.it)('returns empty config when file does not exist', async () => {
            const config = await (0, global_config_loader_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toEqual([]);
        });
        (0, vitest_1.it)('loads a valid config file', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({
                registries: [
                    { type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' },
                ],
            }));
            const config = await (0, global_config_loader_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('team');
            (0, vitest_1.expect)(config.registries[0].type).toBe('git');
        });
        (0, vitest_1.it)('returns empty config for malformed yaml', async () => {
            await fs_1.promises.writeFile(configPath, '{{not valid yaml');
            const config = await (0, global_config_loader_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toEqual([]);
        });
        (0, vitest_1.it)('handles config with no registries field', async () => {
            await fs_1.promises.writeFile(configPath, (0, yaml_1.stringify)({}));
            const config = await (0, global_config_loader_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(config.registries).toEqual([]);
        });
    });
    (0, vitest_1.describe)('saveGlobalConfig()', () => {
        (0, vitest_1.it)('creates parent directory and writes config', async () => {
            const nestedPath = path_1.default.join(tmpDir, 'sub', 'dir', 'config.yaml');
            await (0, global_config_loader_js_1.saveGlobalConfig)({
                registries: [
                    { type: 'filesystem', name: 'local', path: '/some/path' },
                ],
            }, nestedPath);
            const config = await (0, global_config_loader_js_1.loadGlobalConfig)(nestedPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('local');
        });
    });
    (0, vitest_1.describe)('addGlobalRegistry()', () => {
        (0, vitest_1.it)('adds a registry to empty config', async () => {
            const config = await (0, global_config_loader_js_1.addGlobalRegistry)({ type: 'git', name: 'team', url: 'https://github.com/org/reg.git', branch: 'main', path: 'registry' }, configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('team');
        });
        (0, vitest_1.it)('replaces existing registry with same name', async () => {
            await (0, global_config_loader_js_1.addGlobalRegistry)({ type: 'git', name: 'team', url: 'https://old-url.com/reg.git', branch: 'main', path: 'registry' }, configPath);
            const config = await (0, global_config_loader_js_1.addGlobalRegistry)({ type: 'git', name: 'team', url: 'https://new-url.com/reg.git', branch: 'main', path: 'registry' }, configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].url).toBe('https://new-url.com/reg.git');
        });
        (0, vitest_1.it)('persists to disk', async () => {
            await (0, global_config_loader_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'local', path: '/reg' }, configPath);
            const loaded = await (0, global_config_loader_js_1.loadGlobalConfig)(configPath);
            (0, vitest_1.expect)(loaded.registries).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('removeGlobalRegistry()', () => {
        (0, vitest_1.it)('removes a registry by name', async () => {
            await (0, global_config_loader_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'to-remove', path: '/reg' }, configPath);
            const config = await (0, global_config_loader_js_1.removeGlobalRegistry)('to-remove', configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(0);
        });
        (0, vitest_1.it)('no-ops if registry name not found', async () => {
            await (0, global_config_loader_js_1.addGlobalRegistry)({ type: 'filesystem', name: 'keep', path: '/reg' }, configPath);
            const config = await (0, global_config_loader_js_1.removeGlobalRegistry)('nonexistent', configPath);
            (0, vitest_1.expect)(config.registries).toHaveLength(1);
            (0, vitest_1.expect)(config.registries[0].name).toBe('keep');
        });
    });
});
//# sourceMappingURL=global-config-loader.test.js.map