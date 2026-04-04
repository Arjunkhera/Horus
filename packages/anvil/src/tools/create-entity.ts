/**
 * MCP tool handler for anvil_create_entity.
 *
 * Wraps {@link IngestPipeline.createEntity} and translates its result
 * (or PipelineError) into the AnvilError / success shape expected by
 * the MCP server dispatch layer.
 *
 * @module tools/create-entity
 */

import type { AnvilError } from '../types/error.js'
import { makeError, ERROR_CODES } from '../types/error.js'
import {
  IngestPipeline,
  type CreateEntityInput,
  type CreateEntityResult,
  type PipelineError,
} from '../core/pipeline/ingest-pipeline.js'
import type { StorageBackend, Entity } from '../core/storage/storage-backend.js'
import type { FileStore } from '../core/storage/file-store.js'
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import type { IntentRegistry } from '../core/graph/intent-registry.js'
import type { TypeRegistry } from '../registry/type-registry.js'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Dependencies required by the create-entity tool handler.
 *
 * Follows the same context-injection pattern as the existing V1 tool
 * handlers (see create-note.ts) so the MCP server can construct and
 * pass this at registration time.
 */
export type CreateEntityContext = {
  storageBackend: StorageBackend
  edgeStore: Neo4jEdgeStore
  intentRegistry: IntentRegistry
  typeRegistry: TypeRegistry
  fileStore?: FileStore
  searchIndexer?: (entity: Entity) => Promise<void>
}

// ---------------------------------------------------------------------------
// Input / Output types (for the MCP layer)
// ---------------------------------------------------------------------------

export interface CreateEntityParams {
  type: string
  title: string
  fields?: Record<string, unknown>
  body?: string
  edges?: Array<{ targetId: string; intent: string; description?: string }>
  sourcePath?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle an `anvil_create_entity` tool call.
 *
 * Constructs a one-shot {@link IngestPipeline} from the provided context
 * and delegates to its `createEntity` method. Pipeline failures are
 * mapped to structured {@link AnvilError} responses.
 */
export async function handleCreateEntity(
  ctx: CreateEntityContext,
  params: CreateEntityParams,
): Promise<CreateEntityResult | AnvilError> {
  try {
    // Build pipeline input — merge title into fields so storageBackend sees it
    const fields: Record<string, unknown> = { ...params.fields }
    fields.title = params.title

    const input: CreateEntityInput = {
      type: params.type,
      fields,
      body: params.body ?? '',
      edges: params.edges,
      sourcePath: params.sourcePath,
    }

    const pipeline = new IngestPipeline(
      ctx.storageBackend,
      ctx.edgeStore,
      ctx.intentRegistry,
      ctx.typeRegistry,
      ctx.fileStore,
      ctx.searchIndexer,
    )

    return await pipeline.createEntity(input)
  } catch (err) {
    if (isPipelineError(err)) {
      return makeError(
        mapStageToErrorCode(err.stage),
        err.message,
        {
          fields: [
            {
              field: err.stage,
              message: JSON.stringify(err.details),
            },
            ...err.rollbackErrors.map((re) => ({
              field: `rollback:${re.stage}`,
              message: re.error,
            })),
          ],
        },
      )
    }

    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error creating entity: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Type guard for the PipelineError interface.
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

/**
 * Map a pipeline stage to the most appropriate AnvilError code.
 */
function mapStageToErrorCode(stage: string): (typeof ERROR_CODES)[keyof typeof ERROR_CODES] {
  switch (stage) {
    case 'COPY':
      return ERROR_CODES.IO_ERROR
    case 'VALIDATE':
      return ERROR_CODES.VALIDATION_ERROR
    case 'PERSIST':
      return ERROR_CODES.SERVER_ERROR
    case 'GRAPH_SYNC':
      return ERROR_CODES.SERVER_ERROR
    case 'INDEX':
      return ERROR_CODES.SERVER_ERROR
    default:
      return ERROR_CODES.SERVER_ERROR
  }
}
