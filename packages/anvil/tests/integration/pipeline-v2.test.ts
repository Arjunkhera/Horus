/**
 * T4 — Test suite: Ingestion Pipeline (validation, rollback, lifecycle)
 *
 * Covers Phase 4 (P4-S1 through P4-S4) of the Anvil V2 implementation.
 * Tests happy path creation, validation failures, rollback scenarios,
 * and update/delete entity lifecycle.
 *
 * Requires Neo4j at bolt://localhost:7687 and a real filesystem.
 * Typesense/search indexer is mocked.
 *
 * NOTE: The _core type definition marks `type` as required in fields,
 * so all pipeline createEntity calls must include `type` in the fields map.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import * as fss from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import neo4j, { Driver } from 'neo4j-driver'

import { LocalStorageBackend } from '../../src/core/storage/local-storage-backend.js'
import { LocalFileStore } from '../../src/core/storage/local-file-store.js'
import { IngestPipeline } from '../../src/core/pipeline/ingest-pipeline.js'
import { IntentRegistry, Neo4jEdgeStore } from '../../src/core/graph/index.js'
import { TypeRegistry } from '../../src/registry/type-registry.js'
import { handleCreateEntity } from '../../src/tools/create-entity.js'
import { handleUpdateEntity } from '../../src/tools/update-entity.js'
import { handleDeleteEntity } from '../../src/tools/delete-entity.js'
import { isAnvilError } from '../../src/types/error.js'

const mkdtempAsync = promisify(fss.mkdtemp)

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'horus-neo4j'
const DEFAULTS_DIR = join(process.cwd(), 'defaults')

// =============================================================================
// IngestPipeline Direct Tests
// =============================================================================

describe('IngestPipeline', () => {
  let tmpDir: string
  let vaultPath: string
  let dbPath: string
  let storageBackend: LocalStorageBackend
  let fileStore: LocalFileStore
  let driver: Driver
  let edgeStore: Neo4jEdgeStore
  let intentRegistry: IntentRegistry
  let typeRegistry: TypeRegistry
  let pipeline: IngestPipeline
  let indexedEntities: string[]

  beforeAll(async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    intentRegistry = new IntentRegistry()

    typeRegistry = new TypeRegistry()
    const err = await typeRegistry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) throw new Error(`Failed to load types: ${err.message}`)
  })

  afterAll(async () => {
    await driver.close()
  })

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-t4-pipeline-'))
    vaultPath = join(tmpDir, 'vault')
    dbPath = join(tmpDir, 'test.db')

    storageBackend = new LocalStorageBackend(vaultPath, dbPath)
    await storageBackend.initialize()

    fileStore = new LocalFileStore(join(tmpDir, 'data'))
    await fs.mkdir(join(tmpDir, 'data'), { recursive: true })

    edgeStore = new Neo4jEdgeStore(driver, intentRegistry)

    indexedEntities = []
    const mockIndexer = async (entity: any) => {
      indexedEntities.push(entity.id)
    }

    pipeline = new IngestPipeline(
      storageBackend,
      edgeStore,
      intentRegistry,
      typeRegistry,
      fileStore,
      mockIndexer,
    )

    // Clean Neo4j test data
    const session = driver.session()
    try {
      await session.run(
        "MATCH (n:AnvilEntity) WHERE n.title STARTS WITH 'Pipeline' OR n.title STARTS WITH 'Lifecycle' DETACH DELETE n",
      )
    } finally {
      await session.close()
    }
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  // ---------------------------------------------------------------------------
  // Happy Path
  // ---------------------------------------------------------------------------

  describe('Happy path', () => {
    it('should create a note entity through all stages', async () => {
      const result = await pipeline.createEntity({
        type: 'note',
        fields: { type: 'note', title: 'Pipeline Test Note', tags: ['test'] },
        body: 'Created via pipeline',
      })

      expect(result.entityId).toBeDefined()
      expect(result.type).toBe('note')
      expect(result.title).toBe('Pipeline Test Note')
      expect(result.filePath).toBeDefined()
      expect(result.status).toBe('created')
      expect(result.edgesCreated).toBe(0)

      // Verify entity in storage
      const entity = await storageBackend.getEntity(result.entityId)
      expect(entity.title).toBe('Pipeline Test Note')

      // Verify node in Neo4j
      const edges = await edgeStore.getEdges(result.entityId)
      expect(edges).toBeDefined()

      // Verify indexer was called
      expect(indexedEntities).toContain(result.entityId)
    })

    it('should create entity with edges', async () => {
      const target = await pipeline.createEntity({
        type: 'note',
        fields: { type: 'note', title: 'Pipeline Target' },
        body: 'Target',
      })

      const result = await pipeline.createEntity({
        type: 'note',
        fields: { type: 'note', title: 'Pipeline Source' },
        body: 'Source',
        edges: [
          { targetId: target.entityId, intent: 'mentions', description: 'Test link' },
        ],
      })

      expect(result.edgesCreated).toBe(1)

      const edges = await edgeStore.getEdges(result.entityId)
      const outgoing = edges.filter((e) => e.direction === 'outgoing')
      expect(outgoing.length).toBe(1)
      expect(outgoing[0].intent).toBe('mentions')
    })

    it('should create a file entity with COPY stage', async () => {
      const sourceFile = join(tmpDir, 'test-upload.txt')
      await fs.writeFile(sourceFile, 'File content for pipeline', 'utf-8')

      const result = await pipeline.createEntity({
        type: 'file',
        fields: {
          type: 'file',
          title: 'Pipeline File Test',
          mime_type: 'text/plain',
        },
        body: '',
        sourcePath: sourceFile,
      })

      expect(result.entityId).toBeDefined()
      expect(result.type).toBe('file')
    })

    it('should create bookmark entity', async () => {
      const result = await pipeline.createEntity({
        type: 'bookmark',
        fields: {
          type: 'bookmark',
          title: 'Pipeline Bookmark',
          url: 'https://example.com',
        },
        body: '',
      })

      expect(result.entityId).toBeDefined()
      expect(result.type).toBe('bookmark')
    })
  })

  // ---------------------------------------------------------------------------
  // Validation Failures
  // ---------------------------------------------------------------------------

  describe('Validation failures', () => {
    it('should reject unknown type with no side effects', async () => {
      try {
        await pipeline.createEntity({
          type: 'nonexistent_type',
          fields: { type: 'nonexistent_type', title: 'Bad Type' },
          body: 'Should fail',
        })
        expect.unreachable('Should have thrown')
      } catch (err: any) {
        expect(err.stage).toBe('VALIDATE')
        expect(err.rolledBack).toBeDefined()
      }
    })

    it('should reject invalid edge intent', async () => {
      try {
        await pipeline.createEntity({
          type: 'note',
          fields: { type: 'note', title: 'Bad Edge' },
          body: 'Body',
          edges: [{ targetId: 'some-id', intent: 'invalid_intent' }],
        })
        expect.unreachable('Should have thrown')
      } catch (err: any) {
        expect(err.stage).toBe('VALIDATE')
      }
    })

    it('should reject file entity with inaccessible sourcePath', async () => {
      try {
        await pipeline.createEntity({
          type: 'file',
          fields: { type: 'file', title: 'Missing File', mime_type: 'text/plain' },
          body: '',
          sourcePath: '/nonexistent/path/to/file.txt',
        })
        expect.unreachable('Should have thrown')
      } catch (err: any) {
        expect(['COPY', 'VALIDATE']).toContain(err.stage)
      }
    })

    it('should reject file entity with unsupported mime type', async () => {
      const sourceFile = join(tmpDir, 'test.exe')
      await fs.writeFile(sourceFile, 'binary', 'utf-8')

      try {
        await pipeline.createEntity({
          type: 'file',
          fields: { type: 'file', title: 'Bad Mime', mime_type: 'application/x-executable' },
          body: '',
          sourcePath: sourceFile,
        })
        expect.unreachable('Should have thrown')
      } catch (err: any) {
        expect(err.stage).toBe('VALIDATE')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Rollback Scenarios
  // ---------------------------------------------------------------------------

  describe('Rollback scenarios', () => {
    it('should include rollback info in pipeline errors', async () => {
      try {
        await pipeline.createEntity({
          type: 'nonexistent_type',
          fields: { type: 'nonexistent_type', title: 'Rollback Test' },
          body: 'Should fail at validate',
        })
        expect.unreachable('Should have thrown')
      } catch (err: any) {
        expect(err.stage).toBeDefined()
        expect(Array.isArray(err.rolledBack)).toBe(true)
        expect(Array.isArray(err.rollbackErrors)).toBe(true)
      }
    })

    it('should not leave orphan data after VALIDATE failure', async () => {
      const entitiesBefore = await storageBackend.listEntities()

      try {
        await pipeline.createEntity({
          type: 'nonexistent_type',
          fields: { type: 'nonexistent_type', title: 'Orphan Check' },
          body: 'Body',
        })
      } catch {
        // Expected
      }

      const entitiesAfter = await storageBackend.listEntities()
      expect(entitiesAfter.total).toBe(entitiesBefore.total)
    })
  })
})

// =============================================================================
// Tool Handler Tests — Create, Update & Delete
// =============================================================================

describe('Entity lifecycle via tool handlers', () => {
  let tmpDir: string
  let vaultPath: string
  let dbPath: string
  let storageBackend: LocalStorageBackend
  let fileStore: LocalFileStore
  let driver: Driver
  let edgeStore: Neo4jEdgeStore
  let intentRegistry: IntentRegistry
  let typeRegistry: TypeRegistry
  let indexedEntities: string[]
  let removedEntities: string[]

  beforeAll(async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    intentRegistry = new IntentRegistry()

    typeRegistry = new TypeRegistry()
    const err = await typeRegistry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) throw new Error(`Failed to load types: ${err.message}`)
  })

  afterAll(async () => {
    await driver.close()
  })

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-t4-lifecycle-'))
    vaultPath = join(tmpDir, 'vault')
    dbPath = join(tmpDir, 'test.db')

    storageBackend = new LocalStorageBackend(vaultPath, dbPath)
    await storageBackend.initialize()

    fileStore = new LocalFileStore(join(tmpDir, 'data'))
    await fs.mkdir(join(tmpDir, 'data'), { recursive: true })

    edgeStore = new Neo4jEdgeStore(driver, intentRegistry)

    indexedEntities = []
    removedEntities = []

    const session = driver.session()
    try {
      await session.run(
        "MATCH (n:AnvilEntity) WHERE n.title STARTS WITH 'Lifecycle' DETACH DELETE n",
      )
    } finally {
      await session.close()
    }
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  /** Helper to create an entity via handleCreateEntity with required fields */
  async function createEntity(type: string, title: string, fields?: Record<string, unknown>, body?: string) {
    const ctx = { storageBackend, edgeStore, intentRegistry, typeRegistry, fileStore }
    return handleCreateEntity(ctx, {
      type,
      title,
      fields: { type, ...fields },
      body,
    })
  }

  it('should create entity via handleCreateEntity', async () => {
    const result = await createEntity('note', 'Lifecycle Create')

    expect(isAnvilError(result)).toBe(false)
    if (!isAnvilError(result)) {
      expect(result.entityId).toBeDefined()
      expect(result.title).toBe('Lifecycle Create')
    }
  })

  it('should update entity fields via handleUpdateEntity', async () => {
    const created = await createEntity('task', 'Lifecycle Update', { status: 'open', priority: 'P1-high' })
    expect(isAnvilError(created)).toBe(false)
    if (isAnvilError(created)) return

    const updateCtx = {
      storageBackend,
      edgeStore,
      searchIndexer: async (e: any) => { indexedEntities.push(e.id) },
    }
    const updated = await handleUpdateEntity(
      { noteId: created.entityId, fields: { status: 'in_progress' } },
      updateCtx,
    )

    expect(isAnvilError(updated)).toBe(false)
    if (!isAnvilError(updated)) {
      expect(updated.noteId).toBe(created.entityId)
      expect(updated.updatedFields).toContain('status')
      expect(updated.updatedFields).toContain('modified')
    }

    const entity = await storageBackend.getEntity(created.entityId)
    expect(entity.fields.status).toBe('in_progress')
  })

  it('should update entity body via handleUpdateEntity', async () => {
    const created = await createEntity('note', 'Lifecycle Body Update', undefined, 'Original body')
    expect(isAnvilError(created)).toBe(false)
    if (isAnvilError(created)) return

    const updateCtx = { storageBackend, edgeStore }
    const updated = await handleUpdateEntity(
      { noteId: created.entityId, content: 'New body content' },
      updateCtx,
    )

    expect(isAnvilError(updated)).toBe(false)
    if (!isAnvilError(updated)) {
      expect(updated.updatedFields).toContain('body')
    }

    const entity = await storageBackend.getEntity(created.entityId)
    expect(entity.body).toBe('New body content')
  })

  it('should delete entity and cascade via handleDeleteEntity', async () => {
    const created = await createEntity('note', 'Lifecycle Delete', undefined, 'To be deleted')
    expect(isAnvilError(created)).toBe(false)
    if (isAnvilError(created)) return

    const deleteCtx = {
      storageBackend,
      edgeStore,
      fileStore,
      searchRemover: async (id: string) => { removedEntities.push(id) },
    }
    const deleted = await handleDeleteEntity(
      { noteId: created.entityId },
      deleteCtx,
    )

    expect(isAnvilError(deleted)).toBe(false)
    if (!isAnvilError(deleted)) {
      expect(deleted.deleted).toBe(true)
      expect(deleted.noteId).toBe(created.entityId)
    }

    await expect(storageBackend.getEntity(created.entityId)).rejects.toThrow()
  })

  it('should return error for non-existent entity update', async () => {
    const updateCtx = { storageBackend }
    const result = await handleUpdateEntity(
      { noteId: '00000000-0000-0000-0000-000000000000', fields: { status: 'done' } },
      updateCtx,
    )
    expect(isAnvilError(result)).toBe(true)
  })

  it('should return error for non-existent entity delete', async () => {
    const deleteCtx = { storageBackend }
    const result = await handleDeleteEntity(
      { noteId: '00000000-0000-0000-0000-000000000000' },
      deleteCtx,
    )
    expect(isAnvilError(result)).toBe(true)
  })
})
