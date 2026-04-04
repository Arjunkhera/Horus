/**
 * Handler for anvil_delete_entity tool — V2 entity deletion through the pipeline.
 *
 * Cascade: INDEX (remove) → GRAPH SYNC (delete node + edges) → PERSIST (delete) → COPY (delete file)
 */

import type { StorageBackend, Entity } from '../core/storage/storage-backend.js'
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js'
import type { FileStore } from '../core/storage/file-store.js'
import { makeError, ERROR_CODES } from '../types/index.js'
import type { AnvilError } from '../types/index.js'

export interface DeleteEntityInput {
  noteId: string
  force?: boolean
}

export interface DeleteEntityOutput {
  noteId: string
  deleted: boolean
  edgesCascaded: boolean
  fileDeleted: boolean
}

export async function handleDeleteEntity(
  input: DeleteEntityInput,
  ctx: {
    storageBackend: StorageBackend
    edgeStore?: Neo4jEdgeStore
    fileStore?: FileStore
    searchRemover?: (entityId: string) => Promise<void>
  },
): Promise<DeleteEntityOutput | AnvilError> {
  const force = input.force ?? false
  let entity: Entity | null = null
  let edgesCascaded = false
  let fileDeleted = false

  try {
    // 1. Get existing entity (need type info for file cleanup)
    try {
      entity = await ctx.storageBackend.getEntity(input.noteId)
    } catch {
      if (!force) {
        return makeError(ERROR_CODES.NOT_FOUND, `Entity not found: ${input.noteId}`)
      }
    }

    // 2. INDEX — remove from Typesense
    if (ctx.searchRemover) {
      try {
        await ctx.searchRemover(input.noteId)
      } catch (err) {
        console.warn(`Search index removal failed for ${input.noteId}:`, err)
      }
    }

    // 3. GRAPH SYNC — delete Neo4j node + cascade all edges
    if (ctx.edgeStore) {
      try {
        await ctx.edgeStore.deleteNode(input.noteId)
        edgesCascaded = true
      } catch (err) {
        console.warn(`Graph node deletion failed for ${input.noteId}:`, err)
      }
    }

    // 4. PERSIST — delete entity from storage (filesystem + SQLite)
    try {
      await ctx.storageBackend.deleteEntity(input.noteId)
    } catch (err) {
      if (!force) {
        return makeError(
          ERROR_CODES.SERVER_ERROR,
          `Failed to delete entity: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // 5. COPY — delete binary file if this is a file-type entity
    if (ctx.fileStore && entity?.type === 'file') {
      try {
        await ctx.fileStore.delete(input.noteId)
        fileDeleted = true
      } catch (err) {
        console.warn(`File deletion failed for ${input.noteId}:`, err)
      }
    }

    return {
      noteId: input.noteId,
      deleted: true,
      edgesCascaded,
      fileDeleted,
    }
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Failed to delete entity: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
