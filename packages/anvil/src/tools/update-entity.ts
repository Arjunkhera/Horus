/**
 * Handler for anvil_update_entity tool — V2 entity update through the pipeline.
 *
 * PATCH semantics: only provided fields are updated. Body replaces by default,
 * appends for journal types. Edges are NOT modified via update — use edge tools.
 *
 * Pipeline: VALIDATE → PERSIST (update) → GRAPH SYNC (update node) → INDEX (re-index)
 */

import type { StorageBackend, Entity } from '../core/storage/storage-backend.js'
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import { makeError, ERROR_CODES } from '../types/index.js'
import type { AnvilError } from '../types/index.js'

export interface UpdateEntityInput {
  /** Entity UUID to update */
  noteId: string
  /** Fields to merge (omitted fields preserved) */
  fields?: Record<string, unknown>
  /** New body content (omit to keep existing). Appends for journal types. */
  content?: string
}

export interface UpdateEntityOutput {
  noteId: string
  updatedFields: string[]
}

export async function handleUpdateEntity(
  input: UpdateEntityInput,
  ctx: {
    storageBackend: StorageBackend
    edgeStore?: Neo4jEdgeStore
    searchIndexer?: (entity: Entity) => Promise<void>
  },
): Promise<UpdateEntityOutput | AnvilError> {
  try {
    // 1. Get existing entity
    let entity: Entity
    try {
      entity = await ctx.storageBackend.getEntity(input.noteId)
    } catch {
      return makeError(ERROR_CODES.NOT_FOUND, `Entity not found: ${input.noteId}`)
    }

    // 2. PERSIST — update via StorageBackend (handles dual-write)
    const result = await ctx.storageBackend.updateEntity(
      input.noteId,
      input.fields,
      input.content,
    )

    // 3. GRAPH SYNC — update the Neo4j node properties
    if (ctx.edgeStore) {
      try {
        const title = (input.fields?.title as string) ?? entity.title
        await ctx.edgeStore.upsertNode({
          id: input.noteId,
          title,
          type: entity.type,
        })
      } catch (err) {
        // Log but don't fail the update — graph sync is best-effort for updates
        console.warn(`Graph sync failed for entity update ${input.noteId}:`, err)
      }
    }

    // 4. INDEX — re-index in Typesense
    if (ctx.searchIndexer) {
      try {
        const updated = await ctx.storageBackend.getEntity(input.noteId)
        await ctx.searchIndexer(updated)
      } catch (err) {
        console.warn(`Search index update failed for ${input.noteId}:`, err)
      }
    }

    // Determine which fields were actually updated
    const updatedFields: string[] = []
    if (input.fields) {
      updatedFields.push(...Object.keys(input.fields))
    }
    if (input.content !== undefined) {
      updatedFields.push('body')
    }
    updatedFields.push('modified')

    return {
      noteId: input.noteId,
      updatedFields,
    }
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Failed to update entity: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
