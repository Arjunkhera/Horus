import { type GlobalConfig } from '../models/global-config.js';
import type { RegistryConfig } from '../models/forge-config.js';
/**
 * Default location for the global Forge configuration.
 * Config lives under ~/Horus/data/config/ alongside other Horus data.
 * Legacy path (~/.forge/config.yaml) is auto-migrated by the entrypoint on first run.
 */
export declare const GLOBAL_CONFIG_DIR: string;
export declare const GLOBAL_CONFIG_PATH: string;
/**
 * Load the global Forge configuration from ~/Horus/data/config/forge.yaml.
 * Returns an empty config (no registries) if the file doesn't exist.
 * Expands all tilde paths to absolute paths.
 *
 * @param configPath - Override the default path (useful for testing).
 */
export declare function loadGlobalConfig(configPath?: string): Promise<GlobalConfig>;
/**
 * Save a global config to ~/Horus/data/config/forge.yaml.
 * Creates the config directory if it doesn't exist.
 * Does NOT expand paths — stores them as-is (tilde format is fine).
 *
 * @param config - The global config to write (can be partial, will be validated).
 * @param configPath - Override the default path (useful for testing).
 */
export declare function saveGlobalConfig(config: Partial<GlobalConfig>, configPath?: string): Promise<void>;
/**
 * Add a registry to the global config. Deduplicates by name.
 *
 * @param registry - The registry config to add.
 * @param configPath - Override the default path (useful for testing).
 */
export declare function addGlobalRegistry(registry: RegistryConfig, configPath?: string): Promise<GlobalConfig>;
/**
 * Remove a registry from the global config by name.
 *
 * @param registryName - The name of the registry to remove.
 * @param configPath - Override the default path (useful for testing).
 */
export declare function removeGlobalRegistry(registryName: string, configPath?: string): Promise<GlobalConfig>;
//# sourceMappingURL=global-config-loader.d.ts.map