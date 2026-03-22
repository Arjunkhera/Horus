"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_CONFIG_PATH = exports.GLOBAL_CONFIG_DIR = void 0;
exports.loadGlobalConfig = loadGlobalConfig;
exports.saveGlobalConfig = saveGlobalConfig;
exports.addGlobalRegistry = addGlobalRegistry;
exports.removeGlobalRegistry = removeGlobalRegistry;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const yaml_1 = require("yaml");
const global_config_js_1 = require("../models/global-config.js");
const path_utils_js_1 = require("./path-utils.js");
/**
 * Default location for the global Forge configuration.
 * Config lives under ~/Horus/data/config/ alongside other Horus data.
 * Legacy path (~/.forge/config.yaml) is auto-migrated by the entrypoint on first run.
 */
exports.GLOBAL_CONFIG_DIR = path_1.default.join(os_1.default.homedir(), 'Horus', 'data', 'config');
exports.GLOBAL_CONFIG_PATH = path_1.default.join(exports.GLOBAL_CONFIG_DIR, 'forge.yaml');
/**
 * Load the global Forge configuration from ~/Horus/data/config/forge.yaml.
 * Returns an empty config (no registries) if the file doesn't exist.
 * Expands all tilde paths to absolute paths.
 *
 * @param configPath - Override the default path (useful for testing).
 */
async function loadGlobalConfig(configPath = exports.GLOBAL_CONFIG_PATH) {
    try {
        const raw = await fs_1.promises.readFile(configPath, 'utf-8');
        const parsed = (0, yaml_1.parse)(raw);
        const config = global_config_js_1.GlobalConfigSchema.parse(parsed);
        // Expand all tilde paths to absolute paths
        if (config.workspace.mount_path) {
            config.workspace.mount_path = (0, path_utils_js_1.expandPath)(config.workspace.mount_path);
        }
        if (config.workspace.store_path) {
            config.workspace.store_path = (0, path_utils_js_1.expandPath)(config.workspace.store_path);
        }
        if (config.workspace.sessions_path) {
            config.workspace.sessions_path = (0, path_utils_js_1.expandPath)(config.workspace.sessions_path);
        }
        if (config.workspace.managed_repos_path) {
            config.workspace.managed_repos_path = (0, path_utils_js_1.expandPath)(config.workspace.managed_repos_path);
        }
        if (config.workspace.sessions_root) {
            config.workspace.sessions_root = (0, path_utils_js_1.expandPath)(config.workspace.sessions_root);
        }
        if (config.repos.index_path) {
            config.repos.index_path = (0, path_utils_js_1.expandPath)(config.repos.index_path);
        }
        config.repos.scan_paths = config.repos.scan_paths.map(path_utils_js_1.expandPath);
        // Expand registry paths for filesystem registries
        for (const registry of config.registries) {
            if (registry.type === 'filesystem') {
                registry.path = (0, path_utils_js_1.expandPath)(registry.path);
            }
        }
        return config;
    }
    catch (err) {
        if (err?.code === 'ENOENT') {
            // No global config — return empty defaults
            return global_config_js_1.GlobalConfigSchema.parse({});
        }
        // File exists but is malformed — warn and return empty
        console.warn(`[Forge] Warning: Could not parse global config at ${configPath}: ${err.message}. Using defaults.`);
        return global_config_js_1.GlobalConfigSchema.parse({});
    }
}
/**
 * Save a global config to ~/Horus/data/config/forge.yaml.
 * Creates the config directory if it doesn't exist.
 * Does NOT expand paths — stores them as-is (tilde format is fine).
 *
 * @param config - The global config to write (can be partial, will be validated).
 * @param configPath - Override the default path (useful for testing).
 */
async function saveGlobalConfig(config, configPath = exports.GLOBAL_CONFIG_PATH) {
    const dir = path_1.default.dirname(configPath);
    await fs_1.promises.mkdir(dir, { recursive: true });
    // Parse to ensure it's valid and fill in defaults
    const validated = global_config_js_1.GlobalConfigSchema.parse(config);
    const yaml = (0, yaml_1.stringify)(validated);
    await fs_1.promises.writeFile(configPath, yaml, 'utf-8');
}
/**
 * Add a registry to the global config. Deduplicates by name.
 *
 * @param registry - The registry config to add.
 * @param configPath - Override the default path (useful for testing).
 */
async function addGlobalRegistry(registry, configPath = exports.GLOBAL_CONFIG_PATH) {
    const config = await loadGlobalConfig(configPath);
    // Remove any existing registry with the same name
    config.registries = config.registries.filter(r => r.name !== registry.name);
    config.registries.push(registry);
    await saveGlobalConfig(config, configPath);
    return config;
}
/**
 * Remove a registry from the global config by name.
 *
 * @param registryName - The name of the registry to remove.
 * @param configPath - Override the default path (useful for testing).
 */
async function removeGlobalRegistry(registryName, configPath = exports.GLOBAL_CONFIG_PATH) {
    const config = await loadGlobalConfig(configPath);
    config.registries = config.registries.filter(r => r.name !== registryName);
    await saveGlobalConfig(config, configPath);
    return config;
}
//# sourceMappingURL=global-config-loader.js.map