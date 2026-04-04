// Handler for anvil_delete_edge tool

import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import type { IntentRegistry } from '../core/graph/intent-registry.js'
import type { AnvilError } from '../types/error.js'
import { makeError, ERROR_CODES } from '../types/error.js'

export type EdgeToolContext = {
  edgeStore: Neo4jEdgeStore
  intentRegistry: IntentRegistry
}

export interface DeleteEdgeParams {
  sourceId: string
  targetId: string
  intent?: string
}

export interface DeleteEdgeOutput {
  deleted: true
  sourceId: string
  targetId: string
  intent: string | null
}

/**
 * Handle anvil_delete_edge request.
 * Deletes one or more edges between two entities. When intent is provided,
 * only the matching edge is removed; when omitted, all edges between the
 * pair are deleted.
 */
export async function handleDeleteEdge(
  ctx: EdgeToolContext,
  params: DeleteEdgeParams,
): Promise<DeleteEdgeOutput | AnvilError> {
  try {
    // 1. Validate required params
    if (!params.sourceId) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'sourceId is required',
      )
    }
    if (!params.targetId) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'targetId is required',
      )
    }

    // 2. If intent is provided, validate it against the registry
    if (params.intent && !ctx.intentRegistry.validate(params.intent)) {
      const available = ctx.intentRegistry.list().map((i) => i.id)
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Unknown intent: ${params.intent}`,
        { allowed_values: available },
      )
    }

    // 3. Delete edge(s)
    await ctx.edgeStore.deleteEdge(
      params.sourceId,
      params.targetId,
      params.intent,
    )

    // 4. Return confirmation
    return {
      deleted: true,
      sourceId: params.sourceId,
      targetId: params.targetId,
      intent: params.intent ?? null,
    }
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error deleting edge: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}
