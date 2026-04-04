// Handler for anvil_create_edge tool

import type { AnvilEdge, CreateEdgeInput } from '../core/graph/edge-model.js'
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import type { IntentRegistry } from '../core/graph/intent-registry.js'
import type { AnvilError } from '../types/error.js'
import { makeError, ERROR_CODES } from '../types/error.js'

export type EdgeToolContext = {
  edgeStore: Neo4jEdgeStore
  intentRegistry: IntentRegistry
}

export interface CreateEdgeParams {
  sourceId: string
  targetId: string
  intent: string
  description?: string
}

export interface CreateEdgeOutput {
  sourceId: string
  targetId: string
  intent: string
  description?: string
  createdAt: string
  updatedAt: string
}

/**
 * Handle anvil_create_edge request.
 * Validates the intent against the IntentRegistry, then creates
 * a directed edge between two entities in the Neo4j graph.
 */
export async function handleCreateEdge(
  ctx: EdgeToolContext,
  params: CreateEdgeParams,
): Promise<CreateEdgeOutput | AnvilError> {
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
    if (!params.intent) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'intent is required',
      )
    }

    // 2. Validate intent against registry
    if (!ctx.intentRegistry.validate(params.intent)) {
      const available = ctx.intentRegistry.list().map((i) => i.id)
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Unknown intent: ${params.intent}`,
        { allowed_values: available },
      )
    }

    // 3. Build input and create edge
    const input: CreateEdgeInput = {
      sourceId: params.sourceId,
      targetId: params.targetId,
      intent: params.intent,
      description: params.description,
    }

    const edge: AnvilEdge = await ctx.edgeStore.createEdge(input)

    // 4. Return created edge data
    return {
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      intent: edge.intent,
      description: edge.description,
      createdAt: edge.createdAt.toISOString(),
      updatedAt: edge.updatedAt.toISOString(),
    }
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error creating edge: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}
