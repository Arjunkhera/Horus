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
import { AnvilWatcher } from './storage/watcher.js';
import { loadSearchConfig, createClient, bootstrapCollection } from '@horus/search';
import type { ToolContext } from './tools/create-note.js';
import type { TypeWatcher } from './watcher/type-watcher.js';
import type { TypesenseClient } from '@horus/search';

/**
 * Attempt to initialise Typesense: connect, bootstrap collection, return client.
 * Returns null if Typesense is unavailable — Anvil will fall back to FTS5.
 */
async function initTypesense(): Promise<TypesenseClient | null> {
  try {
    const cfg = loadSearchConfig();
    const client = createClient(cfg);
    await bootstrapCollection(client);
    process.stderr.write(
      JSON.stringify({
        level: 'info',
        message: `Typesense connected (${cfg.host}:${cfg.port})`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
    return client;
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        message: `Typesense unavailable — falling back to FTS5: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
    return null;
  }
}

/**
 * Full re-index: push all notes currently in SQLite into Typesense.
 * Uses the Typesense import API for bulk efficiency.
 */
async function reindexToTypesense(
  db: AnvilDatabase,
  client: TypesenseClient,
): Promise<void> {
  try {
    const rows = db.raw.getAll<{
      noteId: string;
      title: string;
      bodyText: string;
      type: string;
      status: string | null;
      priority: string | null;
      created: string;
      modified: string;
    }>(
      `SELECT
        note_id as noteId,
        title,
        body_text as bodyText,
        type,
        status,
        priority,
        created,
        modified
      FROM notes`,
    );

    if (!rows || rows.length === 0) return;

    // Fetch tags per note
    const allTags = db.raw.getAll<{ note_id: string; tag: string }>(
      `SELECT note_id, tag FROM note_tags`,
    );
    const tagsMap = new Map<string, string[]>();
    for (const row of allTags ?? []) {
      if (!tagsMap.has(row.note_id)) tagsMap.set(row.note_id, []);
      tagsMap.get(row.note_id)!.push(row.tag);
    }

    // Fetch project relationships per note
    const projectRels = db.raw.getAll<{ source_id: string; target_id: string }>(
      `SELECT source_id, target_id FROM relationships WHERE relation_type = 'project' AND target_id IS NOT NULL`,
    );
    const projectMap = new Map<string, string>();
    for (const rel of projectRels ?? []) {
      projectMap.set(rel.source_id, rel.target_id);
    }

    // Build documents
    const BODY_TRUNCATE = 20_000;
    const documents = rows.map((r) => ({
      id: r.noteId,
      source: 'anvil',
      source_type: r.type,
      title: r.title,
      body: (r.bodyText ?? '').slice(0, BODY_TRUNCATE),
      tags: tagsMap.get(r.noteId) ?? [],
      ...(r.status ? { status: r.status } : {}),
      ...(r.priority ? { priority: r.priority } : {}),
      ...(projectMap.get(r.noteId) ? { project_id: projectMap.get(r.noteId) } : {}),
      created_at: Math.floor(new Date(r.created).getTime() / 1000),
      modified_at: Math.floor(new Date(r.modified).getTime() / 1000),
    }));

    await client
      .collections('horus_documents')
      .documents()
      .import(documents as unknown as Record<string, unknown>[], { action: 'upsert' });

    process.stderr.write(
      JSON.stringify({
        level: 'info',
        message: `Typesense re-index complete: ${documents.length} notes`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        message: `Typesense re-index failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}

/**
 * Main entry point for the Anvil MCP server
 * 1. Loads configuration from CLI args, env vars, or config file
 * 2. Initializes core components (TypeRegistry, AnvilDatabase)
 * 3. Attempts Typesense bootstrap (graceful degradation to FTS5 on failure)
 * 4. Creates the MCP server with all tool handlers
 * 5. Sets up type watcher for hot reload
 * 6. Starts the configured transport (stdio or http)
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

  // Attempt Typesense bootstrap (non-fatal — degrades to filter-only queries)
  const typesenseClient = await initTypesense();

  // Initialize search engine (Typesense only — FTS5 removed)
  const { engine: searchEngine, mode: searchMode } = await createSearchEngine(
    typesenseClient ?? undefined,
  );
  process.stderr.write(
    JSON.stringify({
      level: 'info',
      message: `Search engine: ${searchMode}`,
      timestamp: new Date().toISOString(),
    }) + '\n',
  );

  // Create and start note watcher (startup catchup + live file watching)
  const watcher = new AnvilWatcher({
    vaultPath: config.vault_path,
    db: db.raw,
    registry,
    typesenseClient: typesenseClient ?? undefined,
  });
  await watcher.start();
  process.stderr.write(
    JSON.stringify({
      level: 'info',
      message: 'Note watcher started (startup catchup complete)',
      timestamp: new Date().toISOString(),
    }) + '\n',
  );

  // Startup re-index into Typesense (SQLite is up-to-date after watcher catchup)
  if (typesenseClient) {
    await reindexToTypesense(db, typesenseClient);
  }

  // Create tool context
  const ctx: ToolContext = {
    vaultPath: config.vault_path,
    registry,
    db,
    watcher,
    searchEngine,
    typesenseClient: typesenseClient ?? undefined,
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
    await watcher.stop();
    if (typeWatcher) {
      await typeWatcher.close();
    }
    db.close();
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
