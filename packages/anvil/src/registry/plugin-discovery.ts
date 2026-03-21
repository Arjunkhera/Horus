/**
 * Plugin Type Directory Discovery
 *
 * Establishes the convention that plugins contribute type definitions via
 * `.anvil/plugins/{pluginName}/types/` directories. This module scans for
 * matching directories under a vault's `.anvil/plugins/` path and returns
 * their absolute paths in deterministic (alphabetical) order.
 *
 * This enables Forge (and other plugin managers) to install plugin types by
 * writing YAML files into the plugin's types directory, without requiring
 * manual configuration.
 *
 * Convention:
 * - Each plugin is a directory under `.anvil/plugins/`
 * - Plugin types are in `{pluginDir}/types/` as YAML files
 * - If `.anvil/plugins/{name}/plugin.json` exists, the plugin is considered
 *   "installed" and is logged (informational only)
 * - If `{pluginDir}/types/` doesn't exist, the plugin is silently skipped
 * - Plugins are processed in alphabetical order by name, ensuring deterministic
 *   precedence: first plugin (alphabetically) wins on type ID conflicts
 */

import * as fs from 'node:fs';
import path from 'node:path';

/**
 * Discover all plugin type directories under a vault path.
 *
 * Returns a sorted list of absolute paths to `{pluginDir}/types/` directories
 * that exist and are readable. Directories are sorted alphabetically by plugin
 * name for deterministic ordering.
 *
 * If `.anvil/plugins/` does not exist, returns an empty array.
 * If a plugin directory exists but has no `types/` subdirectory, it is silently skipped.
 *
 * @param vaultPath - Absolute path to the vault root
 * @returns Promise resolving to sorted array of absolute paths to plugin types directories
 */
export async function discoverPluginTypeDirs(vaultPath: string): Promise<string[]> {
  const pluginsDir = path.join(vaultPath, '.anvil', 'plugins');

  // Check if plugins directory exists
  try {
    const stat = await fs.promises.stat(pluginsDir);
    if (!stat.isDirectory()) {
      console.debug(`Plugins path is not a directory: ${pluginsDir}`);
      return [];
    }
  } catch (err) {
    // ENOENT or permission error: skip silently
    const isNotFound = (err as unknown as Record<string, unknown>)['code'] === 'ENOENT';
    if (isNotFound) {
      // No plugins directory — expected case, silent
      return [];
    }
    // Permission or other error: log at debug level and skip
    console.debug(`Could not read plugins directory: ${pluginsDir}`);
    return [];
  }

  // List plugin directories under .anvil/plugins/
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
  } catch (err) {
    console.debug(`Could not list plugins directory: ${pluginsDir}`);
    return [];
  }

  const pluginTypeDirs: string[] = [];

  // Process each entry
  for (const entry of entries) {
    const pluginName = entry.name;
    const pluginPath = path.join(pluginsDir, pluginName);

    // Skip non-directories
    if (!entry.isDirectory()) {
      continue;
    }

    // Check if types/ exists
    const typesDir = path.join(pluginPath, 'types');
    try {
      const typesStat = await fs.promises.stat(typesDir);
      if (!typesStat.isDirectory()) {
        // Exists but not a directory, skip
        continue;
      }

      // Check for optional plugin.json manifest
      const manifestPath = path.join(pluginPath, 'plugin.json');
      try {
        await fs.promises.stat(manifestPath);
        // Manifest exists: log at info level
        console.info(`Discovered plugin: ${pluginName}`);
      } catch {
        // No manifest: skip the info log (not an error)
      }

      pluginTypeDirs.push(typesDir);
    } catch (err) {
      const isNotFound = (err as unknown as Record<string, unknown>)['code'] === 'ENOENT';
      if (isNotFound) {
        // types/ doesn't exist: skip silently (expected for plugins without type definitions)
        continue;
      }
      // Other error (permission, symlink, etc.): skip with debug log
      console.debug(`Could not read types directory for plugin '${pluginName}': ${(err as Error).message}`);
    }
  }

  // Sort alphabetically by plugin name (derived from path basename)
  pluginTypeDirs.sort((a, b) => {
    const nameA = path.basename(path.dirname(a)); // Get plugin name from parent of types/
    const nameB = path.basename(path.dirname(b));
    return nameA.localeCompare(nameB);
  });

  return pluginTypeDirs;
}
