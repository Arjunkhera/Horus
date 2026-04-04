/**
 * Git-backed export/import for the Neo4j edge graph.
 *
 * Writes all {@link AnvilEdge} relationships to `_graph/edges.json`
 * inside the vault directory so they are committed alongside note
 * files during `syncPush`. On a fresh Neo4j instance the file can
 * be imported to restore the full graph.
 *
 * @module core/graph/edge-backup
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import type { AnvilEdge } from './edge-model.js'
import type { Neo4jEdgeStore } from './neo4j-edge-store.js'

/** Shape persisted to `edges.json` — dates serialised as ISO strings. */
interface SerializedEdge {
  sourceId: string
  targetId: string
  intent: string
  description?: string
  createdAt: string
  updatedAt: string
}

export class EdgeBackup {
  private readonly edgeStore: Neo4jEdgeStore
  private readonly filePath: string

  constructor(edgeStore: Neo4jEdgeStore, vaultPath: string) {
    this.edgeStore = edgeStore
    this.filePath = path.join(vaultPath, '_graph', 'edges.json')
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Export all edges from Neo4j to `{vaultPath}/_graph/edges.json`.
   *
   * Creates the `_graph/` directory if it does not exist.
   *
   * @returns The number of edges written to disk.
   */
  async exportToFile(): Promise<number> {
    const edges = await this.edgeStore.exportAllEdges()

    const serialized: SerializedEdge[] = edges.map((e) => ({
      sourceId: e.sourceId,
      targetId: e.targetId,
      intent: e.intent,
      ...(e.description ? { description: e.description } : {}),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    }))

    // Ensure _graph/ directory exists
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })

    await fs.writeFile(
      this.filePath,
      JSON.stringify(serialized, null, 2) + '\n',
      'utf-8',
    )

    return edges.length
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Import edges from `{vaultPath}/_graph/edges.json` into Neo4j.
   *
   * If the file does not exist the operation is a no-op.
   *
   * @returns The number of imported edges, or `{ imported: 0, skipped: true }`
   *          when the file is missing.
   */
  async importFromFile(): Promise<{ imported: number; skipped?: true }> {
    // Check if file exists
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf-8')
    } catch {
      return { imported: 0, skipped: true }
    }

    const serialized: SerializedEdge[] = JSON.parse(raw)

    const edges: AnvilEdge[] = serialized.map((s) => ({
      sourceId: s.sourceId,
      targetId: s.targetId,
      intent: s.intent,
      description: s.description,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }))

    await this.edgeStore.importEdges(edges)

    return { imported: edges.length }
  }

  // ---------------------------------------------------------------------------
  // Decision helper
  // ---------------------------------------------------------------------------

  /**
   * Determine whether an import should run.
   *
   * Returns `true` when the Neo4j graph has no edges (fresh / empty
   * instance) **and** a backup file exists on disk. Returns `false`
   * if the graph is already populated or no backup file is available.
   */
  async shouldImport(): Promise<boolean> {
    // Check if the graph already has edges — if so, no need to import
    const existingEdges = await this.edgeStore.exportAllEdges()
    if (existingEdges.length > 0) {
      return false
    }

    // Check if the backup file exists
    try {
      await fs.access(this.filePath)
      return true
    } catch {
      return false
    }
  }
}
