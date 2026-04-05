// Type definition file watcher with plugin directory discovery and debouncing

import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { discoverPluginTypeDirs } from '../registry/plugin-discovery.js';

/**
 * Options for creating a TypeWatcher
 */
export type TypeWatcherOptions = {
  vaultPath: string; // for watching plugins parent dir
  initialTypeDirs: string[]; // initial list of type dirs to watch
  onReload: (dirs: string[]) => Promise<void>; // callback — receives updated dir list
  debounceMs?: number; // default 500
};

/**
 * TypeWatcher interface returned from createTypeWatcher
 */
export type TypeWatcher = {
  close: () => Promise<void>;
};

/**
 * Create a TypeWatcher that monitors type definition directories for changes.
 * Watches all directories in initialTypeDirs for .yaml file changes.
 * Also watches {vaultPath}/.anvil/plugins/ for new subdirectory creation.
 * When a new plugin directory appears with a types/ subdir, adds it to the watch list and triggers a reload.
 * Debounces type reloads (default 500ms) to handle bulk file writes.
 *
 * Returns a { close() } handle for cleanup.
 */
export function createTypeWatcher(opts: TypeWatcherOptions): TypeWatcher {
  const {
    vaultPath,
    initialTypeDirs,
    onReload,
    debounceMs = 500,
  } = opts;

  const pluginsDir = path.join(vaultPath, '.anvil', 'plugins');

  // Track watchers for each type directory
  const typeWatchers = new Map<string, FSWatcher>();

  // Track all currently watched directories
  let currentDirs = new Set(initialTypeDirs);

  // Debounce timer for reload
  let debounceTimer: NodeJS.Timeout | null = null;

  /**
   * Trigger a reload with debouncing
   */
  function scheduleReload(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      // Re-discover plugin directories to get updated list
      const pluginDirs = await discoverPluginTypeDirs(vaultPath);
      const vaultTypesDir = path.join(vaultPath, '.anvil', 'types');
      const customTypesDir = path.join(vaultPath, 'custom-types');
      const updatedDirs = [vaultTypesDir, ...pluginDirs, customTypesDir];

      // Check if the list changed
      const newDirsSet = new Set(updatedDirs);
      if (newDirsSet.size !== currentDirs.size || ![...newDirsSet].every(d => currentDirs.has(d))) {
        // Directory list changed, update watchers
        await updateWatchers(updatedDirs);
        currentDirs = newDirsSet;
      }

      // Call reload callback with updated directory list
      try {
        await onReload(updatedDirs);
      } catch (err) {
        console.error('[type-watcher] Reload failed:', err);
      }
    }, debounceMs);
  }

  /**
   * Watch a specific type directory for .yaml file changes
   */
  function watchTypeDir(dir: string): void {
    if (typeWatchers.has(dir)) {
      // Already watching this directory
      return;
    }

    const watcher = chokidar.watch(dir, {
      persistent: true,
      ignoreInitial: true,
    });

    // Helper to check if a file is a .yaml file
    const isYamlFile = (filePath: string): boolean => filePath.endsWith('.yaml');

    watcher.on('add', (filePath: string) => {
      if (isYamlFile(filePath)) {
        console.debug(`[type-watcher] File added in ${dir}`);
        scheduleReload();
      }
    });

    watcher.on('change', (filePath: string) => {
      if (isYamlFile(filePath)) {
        console.debug(`[type-watcher] File changed in ${dir}`);
        scheduleReload();
      }
    });

    watcher.on('unlink', (filePath: string) => {
      if (isYamlFile(filePath)) {
        console.debug(`[type-watcher] File removed in ${dir}`);
        scheduleReload();
      }
    });

    watcher.on('error', (err) => {
      console.error(`[type-watcher] Error watching ${dir}:`, err);
    });

    typeWatchers.set(dir, watcher);
    console.debug(`[type-watcher] Started watching ${dir}`);
  }

  /**
   * Watch the plugins directory for new subdirectories
   */
  function watchPluginsDir(): FSWatcher {
    const pluginWatcher = chokidar.watch(pluginsDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 1, // Only watch immediate subdirectories
      ignored: (path: string) => {
        // Only watch for new directories, not all changes
        return path.includes('/types/');
      },
    });

    pluginWatcher.on('addDir', (dir: string) => {
      const typesPath = path.join(dir, 'types');
      console.debug(`[type-watcher] New plugin directory detected: ${dir}`);
      // Trigger re-discovery which will pick up new types dirs
      scheduleReload();
    });

    pluginWatcher.on('unlinkDir', (dir: string) => {
      console.debug(`[type-watcher] Plugin directory removed: ${dir}`);
      scheduleReload();
    });

    pluginWatcher.on('error', (err) => {
      console.error(`[type-watcher] Error watching plugins dir:`, err);
    });

    return pluginWatcher;
  }

  /**
   * Update the set of watched directories
   */
  async function updateWatchers(dirs: string[]): Promise<void> {
    const dirsSet = new Set(dirs);

    // Close watchers for directories no longer in the list
    for (const [dir, watcher] of typeWatchers) {
      if (!dirsSet.has(dir)) {
        await watcher.close();
        typeWatchers.delete(dir);
        console.debug(`[type-watcher] Stopped watching ${dir}`);
      }
    }

    // Start watchers for new directories
    for (const dir of dirs) {
      if (!typeWatchers.has(dir)) {
        watchTypeDir(dir);
      }
    }
  }

  // Start watching initial directories
  for (const dir of initialTypeDirs) {
    watchTypeDir(dir);
  }

  // Start watching plugins directory for new plugins
  let pluginWatcher: FSWatcher | null = null;
  try {
    pluginWatcher = watchPluginsDir();
  } catch (err) {
    // Plugins directory might not exist yet, that's okay
    console.debug('[type-watcher] Could not watch plugins directory (may not exist yet)');
  }

  // Return close handle
  return {
    async close(): Promise<void> {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      // Close all type directory watchers
      for (const watcher of typeWatchers.values()) {
        await watcher.close();
      }
      typeWatchers.clear();

      // Close plugin watcher
      if (pluginWatcher) {
        await pluginWatcher.close();
        pluginWatcher = null;
      }

      console.debug('[type-watcher] Closed all watchers');
    },
  };
}
