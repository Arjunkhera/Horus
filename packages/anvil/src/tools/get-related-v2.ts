// Handler for anvil_get_related V2 — reads from Neo4j instead of SQLite relationships

import type { ResolvedEdge } from '../core/graph/edge-model.js'
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import type { IntentRegistry } from '../core/graph/intent-registry.js'
import type { AnvilError } from '../types/error.js'
import { makeError, ERROR_CODES } from '../types/error.js'

export type GetRelatedV2Context = {
  edgeStore: Neo4jEdgeStore
  intentRegistry: IntentRegistry
}

export interface GetRelatedV2Params {
  noteId: string
  intent?: string
}

/** JSON-safe edge with backward-compatible fields for existing consumers. */
export interface SerializedRelatedEdge {
  sourceId: string
  targetId: string
  intent: string
  displayLabel: string
  description?: string
  direction: 'outgoing' | 'incoming'
  targetTitle?: string
  targetType?: string
  createdAt: string
  updatedAt: string
  /** Backward-compat alias: maps to `intent` so V1 consumers still work. */
  relationType: string
}

export interface GetRelatedV2Output {
  noteId: string
  forward: SerializedRelatedEdge[]
  reverse: SerializedRelatedEdge[]
}

/**
 * Serialize a ResolvedEdge to a JSON-safe object with backward-compatible fields.
 */
function serializeEdge(edge: ResolvedEdge): SerializedRelatedEdge {
  return {
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    intent: edge.intent,
    displayLabel: edge.displayLabel,
    description: edge.description,
    direction: edge.direction,
    targetTitle: edge.targetTitle,
    targetType: edge.targetType,
    createdAt: edge.createdAt.toISOString(),
    updatedAt: edge.updatedAt.toISOString(),
    // V1 compat — agents that read `relationType` still get a value
    relationType: edge.intent,
  }
}

/**
 * Handle anvil_get_related V2 request.
 *
 * Replaces the V1 handler that read from the SQLite `relationships` table.
 * V2 reads exclusively from Neo4j via the edge store, which is the single
 * source of truth for connections in Anvil V2.
 *
 * Results are grouped into `forward` (outgoing) and `reverse` (incoming)
 * arrays for backward compatibility with agents that expect that shape.
 */
export async function handleGetRelatedV2(
  ctx: GetRelatedV2Context,
  params: GetRelatedV2Params,
): Promise<GetRelatedV2Output | AnvilError> {
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

    // 3. Fetch edges from Neo4j
    const edges: ResolvedEdge[] = await ctx.edgeStore.getEdges(
      params.noteId,
      params.intent,
    )

    // 4. Group by direction
    const forward: SerializedRelatedEdge[] = []
    const reverse: SerializedRelatedEdge[] = []

    for (const edge of edges) {
      const serialized = serializeEdge(edge)
      if (edge.direction === 'outgoing') {
        forward.push(serialized)
      } else {
        reverse.push(serialized)
      }
    }

    // 5. Return grouped result
    return {
      noteId: params.noteId,
      forward,
      reverse,
    }
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error fetching related edges: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}
