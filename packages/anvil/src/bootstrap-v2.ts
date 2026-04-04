/**
 * V2 Bootstrap — initializes all V2 subsystems in dependency order.
 *
 * This module is the V2 counterpart of the startup sequence in index.ts.
 * It focuses exclusively on subsystem initialization; MCP server creation
 * and transport setup remain in index.ts.
 *
 * Usage:
 *   const ctx = await bootstrapV2(config)
 *
 * Shutdown:
 *   await shutdownV2(ctx)
 *
 * @module bootstrap-v2
 */

import neo4j, { type Driver } from 'neo4j-driver'

import { vaultPaths } from './config.js'
import { discoverPluginTypeDirs } from './registry/plugin-discovery.js'
import { TypeRegistry } from './registry/type-registry.js'
import { LocalStorageBackend } from './core/storage/local-storage-backend.js'
import { LocalFileStore } from './core/storage/local-file-store.js'
import { Neo4jEdgeStore } from './core/graph/neo4j-edge-store.js'
import { IntentRegistry } from './core/graph/intent-registry.js'
import { EdgeBackup } from './core/graph/edge-backup.js'
import { SchemaBuilder } from './core/search/schema-builder.js'
import { IngestPipeline } from './core/pipeline/ingest-pipeline.js'
import {
  loadSearchConfig,
  loadEmbeddingConfig,
  createClient,
  bootstrapCollection,
} from '@horus/search'
import type { TypesenseClient } from '@horus/search'
import type { ServerConfig } from './types/index.js'

// ---------------------------------------------------------------------------
// V2Context — the bag of initialized subsystems
// ---------------------------------------------------------------------------

export interface V2Context {
  storageBackend: LocalStorageBackend
  fileStore: LocalFileStore
  registry: TypeRegistry
  edgeStore: Neo4jEdgeStore
  intentRegistry: IntentRegistry
  edgeBackup: EdgeBackup
  schemaBuilder: SchemaBuilder
  pipeline: IngestPipeline
  neo4jDriver: Driver
  typesenseAvailable: boolean
}

// ---------------------------------------------------------------------------
// Structured logging helper
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function log(level: LogLevel, message: string): void {
  process.stderr.write(
    JSON.stringify({ level, message, timestamp: new Date().toISOString() }) + '\n',
  )
}

// ---------------------------------------------------------------------------
// Neo4j environment helpers
// ---------------------------------------------------------------------------

function neo4jUri(): string {
  return process.env.NEO4J_URI || process.env.NEO4J_BOLT_URL || 'bolt://localhost:7687'
}

function neo4jAuth(): neo4j.AuthToken {
  const user = process.env.NEO4J_USER || 'neo4j'
  const pass = process.env.NEO4J_PASSWORD || 'neo4j'
  return neo4j.auth.basic(user, pass)
}

// ---------------------------------------------------------------------------
// bootstrapV2
// ---------------------------------------------------------------------------

/**
 * Initialize all V2 subsystems in dependency order.
 *
 * Startup sequence:
 *  1. LocalStorageBackend (vault + SQLite)
 *  2. LocalFileStore (binary files)
 *  3. TypeRegistry (defaults + custom + plugins)
 *  4. Migration check (V1 -> V2 if needed)
 *  5. Neo4j connection (HARD — fails startup)
 *  6. IntentRegistry
 *  7. Neo4jEdgeStore
 *  8. EdgeBackup (import from edges.json if graph is empty)
 *  9. SchemaBuilder
 * 10. Typesense schema sync + reindex (SOFT — degrades gracefully)
 * 11. IngestPipeline
 * 12. Return V2Context
 */
export async function bootstrapV2(config: ServerConfig): Promise<V2Context> {
  if (!config.vault_path) {
    throw new Error(
      'vault_path not configured. Use --vault, ANVIL_VAULT_PATH env var, or ~/.anvil/server.yaml',
    )
  }

  const paths = vaultPaths(config.vault_path)

  // -------------------------------------------------------------------------
  // 1. LocalStorageBackend
  // -------------------------------------------------------------------------
  log('info', 'Initializing storage backend...')
  const storageBackend = new LocalStorageBackend(config.vault_path, paths.indexDb)
  await storageBackend.initialize()
  log('info', 'Storage backend initialized')

  // -------------------------------------------------------------------------
  // 2. LocalFileStore
  // -------------------------------------------------------------------------
  const dataRoot = paths.localDir
  const fileStore = new LocalFileStore(dataRoot)
  log('info', `File store ready (${dataRoot})`)

  // -------------------------------------------------------------------------
  // 3. TypeRegistry
  // -------------------------------------------------------------------------
  log('info', 'Loading type registry...')
  const pluginTypeDirs = await discoverPluginTypeDirs(config.vault_path)
  const typesDirs = [
    paths.typesDir,
    ...pluginTypeDirs,
    ...(config.additional_type_dirs || []),
  ]

  const registry = new TypeRegistry()
  const typeLoadErr = await registry.loadTypes(typesDirs)
  if (typeLoadErr && 'error' in (typeLoadErr as any)) {
    throw new Error(
      `Failed to load types: ${(typeLoadErr as any).message}`,
    )
  }
  log('info', `Type registry loaded (${registry.getAllTypes().length} types)`)

  // -------------------------------------------------------------------------
  // 4. Migration check — deferred until after Neo4j + edgeStore (needs both)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 5. Neo4j connection (HARD dependency)
  // -------------------------------------------------------------------------
  const uri = neo4jUri()
  log('info', `Connecting to Neo4j at ${uri}...`)

  const driver = neo4j.driver(uri, neo4jAuth())

  try {
    // Verify connectivity with a test query
    const session = driver.session()
    try {
      await session.run('RETURN 1 AS ok')
    } finally {
      await session.close()
    }
    log('info', `Neo4j connected (${uri})`)
  } catch (err) {
    // HARD failure — close the driver and throw
    await driver.close().catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Neo4j is required but unavailable at ${uri}: ${msg}`,
    )
  }

  // -------------------------------------------------------------------------
  // 6. IntentRegistry
  // -------------------------------------------------------------------------
  const intentRegistry = new IntentRegistry()
  log('info', `Intent registry initialized (${intentRegistry.list().length} intents)`)

  // -------------------------------------------------------------------------
  // 7. Neo4jEdgeStore
  // -------------------------------------------------------------------------
  const edgeStore = new Neo4jEdgeStore(driver, intentRegistry)
  log('info', 'Edge store created')

  // -------------------------------------------------------------------------
  // 4b. Migration check (V1 -> V2) — now that we have db + edgeStore
  // -------------------------------------------------------------------------
  await checkMigration(config.vault_path, paths.localDir, storageBackend, edgeStore)

  // -------------------------------------------------------------------------
  // 8. EdgeBackup — import from edges.json if graph is empty
  // -------------------------------------------------------------------------
  const edgeBackup = new EdgeBackup(edgeStore, config.vault_path)

  try {
    if (await edgeBackup.shouldImport()) {
      log('info', 'Empty Neo4j graph detected — importing edges from backup...')
      const result = await edgeBackup.importFromFile()
      log('info', `Edge import complete: ${result.imported} edges imported`)
    }
  } catch (err) {
    // Edge import failure is not fatal — the graph starts empty
    const msg = err instanceof Error ? err.message : String(err)
    log('warn', `Edge import failed (non-fatal): ${msg}`)
  }

  // -------------------------------------------------------------------------
  // 9. SchemaBuilder
  // -------------------------------------------------------------------------
  const schemaBuilder = new SchemaBuilder(registry)
  log('info', 'Schema builder created')

  // -------------------------------------------------------------------------
  // 10. Typesense schema sync + reindex (SOFT dependency)
  // -------------------------------------------------------------------------
  let typesenseAvailable = false
  let typesenseClient: TypesenseClient | null = null

  try {
    const searchCfg = loadSearchConfig()
    const embeddingConfig = loadEmbeddingConfig()
    typesenseClient = createClient(searchCfg)
    await bootstrapCollection(typesenseClient, embeddingConfig)

    log(
      'info',
      `Typesense connected (${searchCfg.host}:${searchCfg.port})${embeddingConfig ? ' — embeddings enabled' : ''}`,
    )

    // Build/alter collection schema from type registry
    const computedSchema = schemaBuilder.buildCollectionSchema()

    try {
      const existing = await typesenseClient
        .collections('horus_documents')
        .retrieve()

      const diff = schemaBuilder.diffSchema(
        existing.fields as Array<{ name: string; type: string; facet?: boolean }>,
        computedSchema.fields as Array<{ name: string; type: string; facet?: boolean }>,
      )

      if (diff.action === 'additive' && diff.fieldsToAdd) {
        log('info', `Adding ${diff.fieldsToAdd.length} new fields to Typesense schema`)
        await typesenseClient
          .collections('horus_documents')
          .update({ fields: diff.fieldsToAdd as any })
      } else if (diff.action === 'recreate') {
        log('warn', `Schema change requires collection recreation: ${diff.changedFields?.join(', ')}`)
        await typesenseClient.collections('horus_documents').delete()
        await typesenseClient.collections().create(computedSchema)
        log('info', 'Typesense collection recreated')
      }
    } catch (schemaErr: any) {
      // Collection may not exist yet — create it
      if (schemaErr?.httpStatus === 404 || schemaErr?.message?.includes('Not Found')) {
        await typesenseClient.collections().create(computedSchema)
        log('info', 'Typesense collection created')
      } else {
        throw schemaErr
      }
    }

    // Full reindex: SQLite -> Typesense
    await reindexFromStorage(storageBackend, schemaBuilder, typesenseClient)

    typesenseAvailable = true
  } catch (err) {
    // SOFT failure — degrade gracefully
    const msg = err instanceof Error ? err.message : String(err)
    log('warn', `Typesense unavailable — search degraded: ${msg}`)
    typesenseClient = null
    typesenseAvailable = false
  }

  // -------------------------------------------------------------------------
  // 11. IngestPipeline
  // -------------------------------------------------------------------------
  const searchIndexer = typesenseClient
    ? buildSearchIndexer(schemaBuilder, typesenseClient)
    : undefined

  const pipeline = new IngestPipeline(
    storageBackend,
    edgeStore,
    intentRegistry,
    registry,
    fileStore,
    searchIndexer,
  )
  log('info', 'Ingest pipeline created')

  // -------------------------------------------------------------------------
  // 12. Return V2Context
  // -------------------------------------------------------------------------
  log('info', 'V2 bootstrap complete')

  return {
    storageBackend,
    fileStore,
    registry,
    edgeStore,
    intentRegistry,
    edgeBackup,
    schemaBuilder,
    pipeline,
    neo4jDriver: driver,
    typesenseAvailable,
  }
}

// ---------------------------------------------------------------------------
// shutdownV2
// ---------------------------------------------------------------------------

/**
 * Gracefully shut down all V2 subsystems.
 */
export async function shutdownV2(ctx: V2Context): Promise<void> {
  log('info', 'Shutting down V2 subsystems...')

  // Close Neo4j driver (also closes the edge store)
  try {
    await ctx.neo4jDriver.close()
    log('info', 'Neo4j driver closed')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('warn', `Neo4j driver close failed: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

const V2_VERSION_MARKER = 'v2'

/**
 * Check if a V1 -> V2 migration is needed and run it.
 *
 * Reads `.anvil/.local/version` — if absent or "v1", runs the migration.
 * After migration, writes "v2" to the version marker.
 */
async function checkMigration(
  vaultPath: string,
  localDir: string,
  storageBackend: LocalStorageBackend,
  edgeStore: Neo4jEdgeStore,
): Promise<void> {
  const { promises: fs } = await import('fs')
  const path = await import('path')
  const versionFile = path.join(localDir, 'version')

  let currentVersion = ''
  try {
    currentVersion = (await fs.readFile(versionFile, 'utf-8')).trim()
  } catch {
    // File does not exist — treat as pre-V2
  }

  if (currentVersion === V2_VERSION_MARKER) {
    log('info', 'Version marker is V2 — no migration needed')
    return
  }

  log('info', `Version marker: "${currentVersion || '(none)'}" — checking migration...`)

  try {
    // Dynamically import the migration module — it may not exist yet
    // (in-progress development). If absent, just write the version marker.
    const { migrateV1ToV2 } = await import('./core/migration/v1-to-v2.js')
    const report = await migrateV1ToV2({
      vaultPath,
      db: (storageBackend as any).database,
      edgeStore,
    })
    log('info', `V1 -> V2 migration complete: ${report.edgesMigrated} edges migrated, ${report.edgesFailed} failed`)
  } catch (err: any) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
      log('info', 'Migration module not yet available — skipping migration')
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      log('warn', `Migration failed (non-fatal): ${msg}`)
    }
  }

  // Write the V2 version marker so we don't re-run migration
  await fs.mkdir(localDir, { recursive: true })
  await fs.writeFile(versionFile, V2_VERSION_MARKER + '\n', 'utf-8')
  log('info', 'Version marker set to V2')
}

// ---------------------------------------------------------------------------
// Search reindex helper
// ---------------------------------------------------------------------------

/**
 * Full reindex: read all entities from SQLite via the storage backend,
 * build Typesense documents via SchemaBuilder, and bulk-upsert.
 */
async function reindexFromStorage(
  storageBackend: LocalStorageBackend,
  schemaBuilder: SchemaBuilder,
  client: TypesenseClient,
): Promise<void> {
  try {
    // Fetch all entities through the storage backend (paginated)
    const BATCH_SIZE = 500
    let offset = 0
    let totalIndexed = 0

    while (true) {
      const { entities, total } = await storageBackend.listEntities(
        undefined,
        undefined,
        BATCH_SIZE,
        offset,
      )

      if (entities.length === 0) break

      // Build Typesense documents using SchemaBuilder for type-aware mapping
      const documents = entities.map((entity) => {
        // Convert Entity back to a Note-like shape for SchemaBuilder.buildDocument
        const noteShape = {
          noteId: entity.id,
          type: entity.type,
          title: entity.title,
          body: entity.body,
          tags: entity.tags,
          created: entity.created.toISOString(),
          modified: entity.modified.toISOString(),
          status: entity.fields.status as string | undefined,
          priority: entity.fields.priority as string | undefined,
          due: entity.fields.due as string | undefined,
          effort: entity.fields.effort as number | undefined,
          fields: entity.fields,
          filePath: entity.filePath,
          related: [],
        }
        return schemaBuilder.buildDocument(noteShape as any)
      })

      await client
        .collections('horus_documents')
        .documents()
        .import(documents as unknown as Record<string, unknown>[], { action: 'upsert' })

      totalIndexed += documents.length
      offset += BATCH_SIZE

      if (offset >= total) break
    }

    if (totalIndexed > 0) {
      log('info', `Typesense reindex complete: ${totalIndexed} documents`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('warn', `Typesense reindex failed: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// Search indexer factory
// ---------------------------------------------------------------------------

/**
 * Build a search indexer function for the IngestPipeline.
 * Returns an async function that indexes a single entity into Typesense.
 */
function buildSearchIndexer(
  schemaBuilder: SchemaBuilder,
  client: TypesenseClient,
): (entity: import('./core/storage/storage-backend.js').Entity) => Promise<void> {
  return async (entity) => {
    const noteShape = {
      noteId: entity.id,
      type: entity.type,
      title: entity.title,
      body: entity.body,
      tags: entity.tags,
      created: entity.created.toISOString(),
      modified: entity.modified.toISOString(),
      status: entity.fields.status as string | undefined,
      priority: entity.fields.priority as string | undefined,
      due: entity.fields.due as string | undefined,
      effort: entity.fields.effort as number | undefined,
      fields: entity.fields,
      filePath: entity.filePath,
      related: [],
    }

    const doc = schemaBuilder.buildDocument(noteShape as any)

    await client
      .collections('horus_documents')
      .documents()
      .upsert(doc as unknown as Record<string, unknown>)
  }
}
