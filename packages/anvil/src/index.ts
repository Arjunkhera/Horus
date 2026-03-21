#!/usr/bin/env node
// Anvil MCP Server entry point
// Initializes core components and starts the MCP server with the configured transport

import { loadServerConfig, vaultPaths } from './config.js';
import { discoverPluginTypeDirs } from './registry/plugin-discovery.js';
import { TypeRegistry } from './registry/type-registry.js';
import { AnvilDatabase } from './index/sqlite.js';
import { createMcpServer } from './mcp/server.js';
import { startStdio } from './mcp/transports/stdio.js';
import { startHttp } from './mcp/transports/http.js';
import { createTypeWatcher } from './watcher/type-watcher.js';
import { createSearchEngine } from './core/search/index.js';
import type { ToolContext } from './tools/create-note.js';
import type { TypeWatcher } from './watcher/type-watcher.js';

/**
 * Main entry point for the Anvil MCP server
 * 1. Loads configuration from CLI args, env vars, or config file
 * 2. Initializes core components (TypeRegistry, AnvilDatabase)
 * 3. Creates the MCP server with all tool handlers
 * 4. Sets up type watcher for hot reload
 * 5. Starts the configured transport (stdio or http)
 */
async function main(): Promise<void> {
  // Load configuration
  const config = loadServerConfig(process.argv.slice(2));

  if (!config.vault_path) {
    console.error(
      'Error: vault_path not configured. Use --vault, ANVIL_VAULT_PATH env var, or ~/.anvil/server.yaml'
    );
    process.exit(1);
  }

  // Get vault paths
  const paths = vaultPaths(config.vault_path);

  // Discover plugin type directories
  const pluginTypeDirs = await discoverPluginTypeDirs(config.vault_path);

  // Build directory array: vault types first (highest precedence), then plugin types (alphabetical), then additional dirs
  const typesDirs = [paths.typesDir, ...pluginTypeDirs, ...(config.additional_type_dirs || [])];

  // Initialize TypeRegistry
  const registry = new TypeRegistry();
  const typeLoadErr = await registry.loadTypes(typesDirs);
  if (typeLoadErr && 'error' in typeLoadErr) {
    console.error(`Failed to load types: ${typeLoadErr.message}`);
    process.exit(1);
  }

  // Initialize AnvilDatabase
  const db = AnvilDatabase.create(paths.indexDb);

  // Cache types in database
  for (const type of registry.getAllTypes()) {
    db.upsertType(type);
  }

  // Initialize search engine (QMD semantic if available, FTS fallback)
  const { engine: searchEngine, mode: searchMode } = await createSearchEngine(db.raw, {
    qmdCollection: process.env.ANVIL_QMD_COLLECTION,
    qmdPath: process.env.QMD_PATH,
  });
  process.stderr.write(JSON.stringify({ level: 'info', message: `Search engine: ${searchMode}`, timestamp: new Date().toISOString() }) + '\n');

  // Create tool context
  const ctx: ToolContext = {
    vaultPath: config.vault_path,
    registry,
    db,
    searchEngine,
  };

  // Set up type watcher for hot reload
  let typeWatcher: TypeWatcher | null = null;
  try {
    typeWatcher = createTypeWatcher({
      vaultPath: config.vault_path,
      initialTypeDirs: typesDirs,
      onReload: async (updatedDirs) => {
        const reloadErr = await registry.reload(updatedDirs);
        if (!reloadErr) {
          // Update database cache with new types
          for (const type of registry.getAllTypes()) {
            db.upsertType(type);
          }
        }
      },
      debounceMs: 500,
    });
  } catch (err) {
    console.warn('[index] Failed to set up type watcher:', err);
    // Continue anyway, the server can run without hot reload
  }

  // Set up signal handlers for graceful shutdown
  const shutdown = async () => {
    console.info('[index] Shutting down...');
    if (typeWatcher) {
      await typeWatcher.close();
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Determine transport and start server
  const transport = config.transport || 'stdio';
  const port = config.port || parseInt(process.env.ANVIL_PORT || '8100', 10);
  const host = config.host || process.env.ANVIL_HOST || '0.0.0.0';

  if (transport === 'http') {
    // Pass a factory so each MCP session gets its own Server instance
    await startHttp(() => createMcpServer(ctx), { port, host });
  } else {
    const server = createMcpServer(ctx);
    await startStdio(server);
  }
}

// Run the server
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
