/**
 * IngestPipeline — orchestrates entity creation through a staged pipeline.
 *
 * Stages execute in order: COPY -> VALIDATE -> PERSIST -> GRAPH_SYNC -> INDEX.
 * On failure at any stage, completed stages are rolled back in reverse order
 * using the shared {@link RollbackTracker} infrastructure.
 *
 * @module core/pipeline/ingest-pipeline
 */

import path from 'node:path'

import type { StorageBackend, Entity, EntityResult } from '../storage/storage-backend.js'
import type { FileStore, StoredFile } from '../storage/file-store.js'
import type { Neo4jEdgeStore } from '../graph/neo4j-edge-store.js'
import type { IntentRegistry } from '../graph/intent-registry.js'
import type { TypeRegistry } from '../../registry/type-registry.js'
import { validateEntity } from './stages/validate.js'
import {
  RollbackTracker,
  createPipelineError,
  type StageName,
  type PipelineError,
} from './rollback.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for the createEntity pipeline. */
export interface CreateEntityInput {
  /** Note type ID (e.g. 'task', 'note', 'story'). */
  type: string
  /** Frontmatter fields (title, status, priority, etc.). */
  fields: Record<string, unknown>
  /** Markdown body content. */
  body: string
  /** Optional edges to create alongside the entity. */
  edges?: Array<{ targetId: string; intent: string; description?: string }>
  /** Absolute path to a source file (file entities only). */
  sourcePath?: string
}

/** Successful result of the createEntity pipeline. */
export interface CreateEntityResult {
  entityId: string
  type: string
  title: string
  filePath: string
  status: 'created'
  edgesCreated: number
}

// Re-export PipelineError from rollback so consumers can catch it
export type { PipelineError }

// ---------------------------------------------------------------------------
// IngestPipeline
// ---------------------------------------------------------------------------

export class IngestPipeline {
  private readonly storageBackend: StorageBackend
  private readonly edgeStore: Neo4jEdgeStore
  private readonly intentRegistry: IntentRegistry
  private readonly typeRegistry: TypeRegistry
  private readonly fileStore?: FileStore
  private readonly searchIndexer?: (entity: Entity) => Promise<void>

  constructor(
    storageBackend: StorageBackend,
    edgeStore: Neo4jEdgeStore,
    intentRegistry: IntentRegistry,
    typeRegistry: TypeRegistry,
    fileStore?: FileStore,
    searchIndexer?: (entity: Entity) => Promise<void>,
  ) {
    this.storageBackend = storageBackend
    this.edgeStore = edgeStore
    this.intentRegistry = intentRegistry
    this.typeRegistry = typeRegistry
    this.fileStore = fileStore
    this.searchIndexer = searchIndexer
  }

  /**
   * Execute the full entity creation pipeline.
   *
   * Stages run in order: COPY -> VALIDATE -> PERSIST -> GRAPH_SYNC -> INDEX.
   * On failure, completed stages are rolled back in reverse via RollbackTracker.
   *
   * @throws {PipelineError} On any stage failure (after rollback completes).
   */
  async createEntity(input: CreateEntityInput): Promise<CreateEntityResult> {
    const tracker = new RollbackTracker()
    let storedFile: StoredFile | undefined
    let entityResult: EntityResult | undefined
    let edgesCreated = 0

    // Working copy of fields — stages may mutate this (COPY adds file metadata)
    const fields = { ...input.fields }

    // -----------------------------------------------------------------
    // 1. COPY (file entities only)
    // -----------------------------------------------------------------
    if (input.sourcePath) {
      if (!this.fileStore) {
        throw await createPipelineError(
          'COPY',
          'FileStore is required for file entities but was not provided',
          { sourcePath: input.sourcePath },
          tracker,
        )
      }

      const filename = path.basename(input.sourcePath)
      // Use a temporary entity ID — the real one is generated during PERSIST.
      // The file store namespaces by entityId/filename.
      const tempEntityId = `pending-${Date.now()}`

      try {
        storedFile = await this.fileStore.store(tempEntityId, filename, input.sourcePath)
      } catch (err) {
        throw await createPipelineError(
          'COPY',
          `Failed to store file: ${err instanceof Error ? err.message : String(err)}`,
          { sourcePath: input.sourcePath },
          tracker,
        )
      }

      const fileStoreRef = this.fileStore
      tracker.record({
        stage: 'COPY',
        undo: () => fileStoreRef.delete(storedFile!.entityId),
        description: `Delete copied file for temp entity ${tempEntityId}`,
      })

      // Enrich fields with file metadata
      fields.file_path = storedFile.storedPath
      fields.file_size = storedFile.size
      fields.mime_type = storedFile.mimeType
    }

    // -----------------------------------------------------------------
    // 2. VALIDATE
    // -----------------------------------------------------------------
    const edgeInputs = input.edges?.map((e) => ({
      sourceId: '', // Source not yet known; intent validation only
      targetId: e.targetId,
      intent: e.intent,
      description: e.description,
    }))

    try {
      const validation = await validateEntity(
        {
          type: input.type,
          fields,
          body: input.body,
          edges: edgeInputs,
          sourcePath: input.sourcePath,
        },
        this.typeRegistry,
        this.intentRegistry,
      )

      if (!validation.valid) {
        throw await createPipelineError(
          'VALIDATE',
          'Entity validation failed',
          { errors: validation.errors },
          tracker,
        )
      }
    } catch (err) {
      // Re-throw PipelineErrors as-is; wrap unexpected errors
      if (isPipelineError(err)) throw err
      throw await createPipelineError(
        'VALIDATE',
        err instanceof Error ? err.message : String(err),
        {},
        tracker,
      )
    }

    // VALIDATE is read-only — no undo action needed, but record for tracking
    tracker.record({
      stage: 'VALIDATE',
      undo: async () => {},
      description: 'Validation is read-only — no undo required',
    })

    // -----------------------------------------------------------------
    // 3. PERSIST
    // -----------------------------------------------------------------
    try {
      entityResult = await this.storageBackend.createEntity(
        input.type,
        fields,
        input.body,
      )
    } catch (err) {
      throw await createPipelineError(
        'PERSIST',
        `Storage write failed: ${err instanceof Error ? err.message : String(err)}`,
        { type: input.type },
        tracker,
      )
    }

    const entityId = entityResult.id
    const storageRef = this.storageBackend
    tracker.record({
      stage: 'PERSIST',
      undo: () => storageRef.deleteEntity(entityId),
      description: `Delete entity ${entityId} from storage`,
    })

    // -----------------------------------------------------------------
    // 4. GRAPH_SYNC
    // -----------------------------------------------------------------
    try {
      const title = (fields.title as string) || entityResult.title
      await this.edgeStore.upsertNode({
        id: entityId,
        title,
        type: input.type,
      })

      if (input.edges && input.edges.length > 0) {
        for (const edge of input.edges) {
          await this.edgeStore.createEdge({
            sourceId: entityId,
            targetId: edge.targetId,
            intent: edge.intent,
            description: edge.description,
          })
          edgesCreated++
        }
      }
    } catch (err) {
      throw await createPipelineError(
        'GRAPH_SYNC',
        `Graph sync failed: ${err instanceof Error ? err.message : String(err)}`,
        { entityId },
        tracker,
      )
    }

    const edgeStoreRef = this.edgeStore
    tracker.record({
      stage: 'GRAPH_SYNC',
      undo: () => edgeStoreRef.deleteNode(entityId),
      description: `Delete graph node and edges for entity ${entityId}`,
    })

    // -----------------------------------------------------------------
    // 5. INDEX (optional)
    // -----------------------------------------------------------------
    if (this.searchIndexer) {
      try {
        const entity = await this.storageBackend.getEntity(entityId)
        await this.searchIndexer(entity)
      } catch (err) {
        throw await createPipelineError(
          'INDEX',
          `Search indexing failed: ${err instanceof Error ? err.message : String(err)}`,
          { entityId },
          tracker,
        )
      }

      tracker.record({
        stage: 'INDEX',
        undo: async () => {
          // Search index is eventually consistent; the entity will be
          // missing from storage after PERSIST rollback and the next
          // index rebuild will clean up the orphan.
        },
        description: `Index entry for ${entityId} (cleanup deferred to rebuild)`,
      })
    }

    // -----------------------------------------------------------------
    // Success
    // -----------------------------------------------------------------
    return {
      entityId,
      type: entityResult.type,
      title: entityResult.title,
      filePath: entityResult.filePath,
      status: 'created',
      edgesCreated,
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Type guard for the PipelineError interface from rollback.ts.
 */
function isPipelineError(value: unknown): value is PipelineError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'stage' in value &&
    'rolledBack' in value &&
    'rollbackErrors' in value
  )
}
