// Handler for anvil_get_edges tool

import type { ResolvedEdge } from '../core/graph/edge-model.js'
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import type { IntentRegistry } from '../core/graph/intent-registry.js'
import type { AnvilError } from '../types/error.js'
import { makeError, ERROR_CODES } from '../types/error.js'

export type EdgeToolContext = {
  edgeStore: Neo4jEdgeStore
  intentRegistry: IntentRegistry
}

export interface GetEdgesParams {
  noteId: string
  intent?: string
}

export interface GetEdgesOutput {
  noteId: string
  edges: SerializedResolvedEdge[]
  total: number
}

/** JSON-safe representation of a ResolvedEdge (dates as ISO strings). */
export interface SerializedResolvedEdge {
  sourceId: string
  targetId: string
  intent: string
  description?: string
  createdAt: string
  updatedAt: string
  direction: 'outgoing' | 'incoming'
  displayLabel: string
  targetTitle?: string
  targetType?: string
}

/**
 * Handle anvil_get_edges request.
 * Retrieves all edges for a given entity (both directions),
 * optionally filtered by intent. Returns ResolvedEdge[] with
 * direction context and display labels.
 */
export async function handleGetEdges(
  ctx: EdgeToolContext,
  params: GetEdgesParams,
): Promise<GetEdgesOutput | AnvilError> {
  try {
    // 1. Validate required params
    if (!params.noteId) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'noteId is required',
      )
    }

    // 2. If intent filter is provided, validate it
    if (params.intent && !ctx.intentRegistry.validate(params.intent)) {
      const available = ctx.intentRegistry.list().map((i) => i.id)
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Unknown intent: ${params.intent}`,
        { allowed_values: available },
      )
    }

    // 3. Fetch edges from store
    const edges: ResolvedEdge[] = await ctx.edgeStore.getEdges(
      params.noteId,
      params.intent,
    )

    // 4. Serialize dates to ISO strings for JSON transport
    const serialized: SerializedResolvedEdge[] = edges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      intent: edge.intent,
      description: edge.description,
      createdAt: edge.createdAt.toISOString(),
      updatedAt: edge.updatedAt.toISOString(),
      direction: edge.direction,
      displayLabel: edge.displayLabel,
      targetTitle: edge.targetTitle,
      targetType: edge.targetType,
    }))

    // 5. Return result
    return {
      noteId: params.noteId,
      edges: serialized,
      total: serialized.length,
    }
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error fetching edges: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}
