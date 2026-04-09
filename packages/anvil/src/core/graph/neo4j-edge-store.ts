/**
 * Neo4j-backed edge storage layer for the Anvil V2 Relations Graph.
 *
 * Stores {@link AnvilEdge} relationships as `ANVIL_EDGE` relationships
 * between `AnvilEntity` nodes in Neo4j. Uses parameterized Cypher queries
 * exclusively and MERGE semantics for idempotent writes.
 *
 * @module core/graph/neo4j-edge-store
 */

import neo4j, { type Driver, type Session } from 'neo4j-driver'
import type {
  AnvilEdge,
  AnvilGraphNode,
  CreateEdgeInput,
  ResolvedEdge,
} from './edge-model.js'
import type { IntentRegistry } from './intent-registry.js'

/** Neo4j node label for all Anvil entities. */
const NODE_LABEL = 'AnvilEntity'

/** Neo4j relationship type for all Anvil edges. */
const REL_TYPE = 'ANVIL_EDGE'

/**
 * Neo4j-backed store for Anvil entity graph edges.
 *
 * Each public method opens its own session and closes it when done,
 * so the store is safe to use concurrently.
 */
export class Neo4jEdgeStore {
  private readonly driver: Driver
  private readonly intentRegistry: IntentRegistry

  constructor(driver: Driver, intentRegistry: IntentRegistry) {
    this.driver = driver
    this.intentRegistry = intentRegistry
  }

  // ---------------------------------------------------------------------------
  // Node operations
  // ---------------------------------------------------------------------------

  /**
   * Create or update an entity node.
   *
   * Uses MERGE by `id` so the operation is idempotent — calling it
   * multiple times with the same id simply updates title and type.
   */
  async upsertNode(node: AnvilGraphNode): Promise<void> {
    const session = this.session()
    try {
      await session.run(
        `MERGE (n:${NODE_LABEL} {id: $id})
         SET n.title = $title, n.type = $type`,
        { id: node.id, title: node.title, type: node.type },
      )
    } finally {
      await session.close()
    }
  }

  /**
   * Delete an entity node and all edges connected to it.
   *
   * Uses DETACH DELETE so every relationship touching the node is
   * removed in the same transaction.
   */
  async deleteNode(id: string): Promise<void> {
    const session = this.session()
    try {
      await session.run(
        `MATCH (n:${NODE_LABEL} {id: $id}) DETACH DELETE n`,
        { id },
      )
    } finally {
      await session.close()
    }
  }

  // ---------------------------------------------------------------------------
  // Edge operations
  // ---------------------------------------------------------------------------

  /**
   * Create an edge between two entities.
   *
   * The intent is validated against the {@link IntentRegistry} before
   * the write. Both endpoint nodes are MERGEd so the operation
   * succeeds even if the nodes do not yet exist (they are created as
   * stubs with empty title/type).
   *
   * @throws {Error} If the intent is not registered.
   */
  async createEdge(input: CreateEdgeInput): Promise<AnvilEdge> {
    if (!this.intentRegistry.validate(input.intent)) {
      throw new Error(`Unknown intent: ${input.intent}`)
    }

    const now = new Date().toISOString()
    const session = this.session()
    try {
      const result = await session.run(
        `MERGE (s:${NODE_LABEL} {id: $sourceId})
           ON CREATE SET s.title = '', s.type = ''
         MERGE (t:${NODE_LABEL} {id: $targetId})
           ON CREATE SET t.title = '', t.type = ''
         CREATE (s)-[r:${REL_TYPE} {
           intent: $intent,
           description: $description,
           created_at: $createdAt,
           updated_at: $updatedAt
         }]->(t)
         RETURN r.created_at AS createdAt, r.updated_at AS updatedAt`,
        {
          sourceId: input.sourceId,
          targetId: input.targetId,
          intent: input.intent,
          description: input.description ?? '',
          createdAt: now,
          updatedAt: now,
        },
      )

      const record = result.records[0]
      return {
        sourceId: input.sourceId,
        targetId: input.targetId,
        intent: input.intent,
        description: input.description,
        createdAt: new Date(record.get('createdAt')),
        updatedAt: new Date(record.get('updatedAt')),
      }
    } finally {
      await session.close()
    }
  }

  /**
   * Delete edge(s) between two entities.
   *
   * When `intent` is provided only matching relationships are removed;
   * otherwise all `ANVIL_EDGE` relationships between the pair are deleted.
   */
  async deleteEdge(
    sourceId: string,
    targetId: string,
    intent?: string,
  ): Promise<void> {
    const session = this.session()
    try {
      const intentClause = intent ? ' AND r.intent = $intent' : ''
      await session.run(
        `MATCH (s:${NODE_LABEL} {id: $sourceId})-[r:${REL_TYPE}]->(t:${NODE_LABEL} {id: $targetId})
         WHERE true${intentClause}
         DELETE r`,
        { sourceId, targetId, ...(intent !== undefined ? { intent } : {}) },
      )
    } finally {
      await session.close()
    }
  }

  /**
   * Get all edges for an entity (both directions).
   *
   * Returns {@link ResolvedEdge} objects annotated with direction
   * context and the display label resolved from the intent registry.
   *
   * @param entityId   - The entity whose edges to retrieve.
   * @param intentFilter - Optional intent to restrict results.
   */
  async getEdges(
    entityId: string,
    intentFilter?: string,
  ): Promise<ResolvedEdge[]> {
    const session = this.session()
    try {
      const intentClause = intentFilter ? ' AND r.intent = $intent' : ''
      const params: Record<string, string> = { entityId }
      if (intentFilter) params.intent = intentFilter

      // Outgoing edges
      const outResult = await session.run(
        `MATCH (s:${NODE_LABEL} {id: $entityId})-[r:${REL_TYPE}]->(t:${NODE_LABEL})
         WHERE true${intentClause}
         RETURN r.intent       AS intent,
                r.description  AS description,
                r.created_at   AS createdAt,
                r.updated_at   AS updatedAt,
                s.id           AS sourceId,
                t.id           AS targetId,
                t.title        AS targetTitle,
                t.type         AS targetType`,
        params,
      )

      // Incoming edges
      const inResult = await session.run(
        `MATCH (s:${NODE_LABEL})-[r:${REL_TYPE}]->(t:${NODE_LABEL} {id: $entityId})
         WHERE true${intentClause}
         RETURN r.intent       AS intent,
                r.description  AS description,
                r.created_at   AS createdAt,
                r.updated_at   AS updatedAt,
                s.id           AS sourceId,
                t.id           AS targetId,
                s.title        AS otherTitle,
                s.type         AS otherType`,
        params,
      )

      const edges: ResolvedEdge[] = []

      for (const record of outResult.records) {
        const intent = record.get('intent') as string
        edges.push({
          sourceId: record.get('sourceId') as string,
          targetId: record.get('targetId') as string,
          intent,
          description: (record.get('description') as string) || undefined,
          createdAt: new Date(record.get('createdAt') as string),
          updatedAt: new Date(record.get('updatedAt') as string),
          direction: 'outgoing',
          displayLabel: this.safeDisplayLabel(intent, 'outgoing'),
          targetTitle: (record.get('targetTitle') as string) || undefined,
          targetType: (record.get('targetType') as string) || undefined,
        })
      }

      for (const record of inResult.records) {
        const intent = record.get('intent') as string
        edges.push({
          sourceId: record.get('sourceId') as string,
          targetId: record.get('targetId') as string,
          intent,
          description: (record.get('description') as string) || undefined,
          createdAt: new Date(record.get('createdAt') as string),
          updatedAt: new Date(record.get('updatedAt') as string),
          direction: 'incoming',
          displayLabel: this.safeDisplayLabel(intent, 'incoming'),
          targetTitle: (record.get('otherTitle') as string) || undefined,
          targetType: (record.get('otherType') as string) || undefined,
        })
      }

      return edges
    } finally {
      await session.close()
    }
  }

  // ---------------------------------------------------------------------------
  // Graph traversal operations
  // ---------------------------------------------------------------------------

  /**
   * Get direct children of an entity via a specific intent (default: parent_of).
   *
   * Returns the child nodes with their metadata. Optionally filters by
   * child type and/or status.
   *
   * @param entityId   - The parent entity ID.
   * @param options    - Optional filters: intent, type, status.
   */
  async getChildren(
    entityId: string,
    options?: { intent?: string; type?: string; status?: string },
  ): Promise<Array<{ id: string; title: string; type: string; status?: string; priority?: string; due?: string }>> {
    const intent = options?.intent ?? 'parent_of'
    const session = this.session()
    try {
      let typeClause = ''
      let statusClause = ''
      const params: Record<string, string> = { entityId, intent }

      if (options?.type) {
        typeClause = ' AND child.type = $childType'
        params.childType = options.type
      }
      if (options?.status) {
        statusClause = ' AND child.status = $childStatus'
        params.childStatus = options.status
      }

      const result = await session.run(
        `MATCH (parent:${NODE_LABEL} {id: $entityId})-[r:${REL_TYPE} {intent: $intent}]->(child:${NODE_LABEL})
         WHERE true${typeClause}${statusClause}
         RETURN child.id       AS id,
                child.title    AS title,
                child.type     AS type,
                child.status   AS status,
                child.priority AS priority,
                child.due      AS due
         ORDER BY child.title`,
        params,
      )

      return result.records.map((record) => ({
        id: record.get('id') as string,
        title: record.get('title') as string,
        type: record.get('type') as string,
        status: (record.get('status') as string) || undefined,
        priority: (record.get('priority') as string) || undefined,
        due: (record.get('due') as string) || undefined,
      }))
    } finally {
      await session.close()
    }
  }

  /**
   * Get the full subtree under an entity via a specific intent (default: parent_of).
   *
   * Returns all descendants with depth information. Uses variable-length
   * path matching for recursive traversal.
   *
   * @param entityId  - The root entity ID.
   * @param options   - Optional: intent, maxDepth (default 10), type filter.
   */
  async getSubtree(
    entityId: string,
    options?: { intent?: string; maxDepth?: number; type?: string },
  ): Promise<Array<{ id: string; title: string; type: string; depth: number; status?: string; priority?: string }>> {
    const intent = options?.intent ?? 'parent_of'
    const maxDepth = options?.maxDepth ?? 10
    const session = this.session()
    try {
      let typeClause = ''
      const params: Record<string, unknown> = {
        entityId,
        intent,
        maxDepth: neo4j.int(maxDepth),
      }

      if (options?.type) {
        typeClause = ' AND descendant.type = $childType'
        params.childType = options.type
      }

      const result = await session.run(
        `MATCH path = (root:${NODE_LABEL} {id: $entityId})-[r:${REL_TYPE} *1..]->(descendant:${NODE_LABEL})
         WHERE ALL(rel IN relationships(path) WHERE rel.intent = $intent)
           AND length(path) <= $maxDepth${typeClause}
         RETURN descendant.id       AS id,
                descendant.title    AS title,
                descendant.type     AS type,
                descendant.status   AS status,
                descendant.priority AS priority,
                length(path)        AS depth
         ORDER BY depth, descendant.title`,
        params,
      )

      return result.records.map((record) => ({
        id: record.get('id') as string,
        title: record.get('title') as string,
        type: record.get('type') as string,
        depth: neo4j.integer.toNumber(record.get('depth')),
        status: (record.get('status') as string) || undefined,
        priority: (record.get('priority') as string) || undefined,
      }))
    } finally {
      await session.close()
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk operations
  // ---------------------------------------------------------------------------

  /**
   * Export every `ANVIL_EDGE` relationship in the database.
   */
  async exportAllEdges(): Promise<AnvilEdge[]> {
    const session = this.session()
    try {
      const result = await session.run(
        `MATCH (s:${NODE_LABEL})-[r:${REL_TYPE}]->(t:${NODE_LABEL})
         RETURN s.id          AS sourceId,
                t.id          AS targetId,
                r.intent      AS intent,
                r.description AS description,
                r.created_at  AS createdAt,
                r.updated_at  AS updatedAt`,
      )

      return result.records.map((record) => ({
        sourceId: record.get('sourceId') as string,
        targetId: record.get('targetId') as string,
        intent: record.get('intent') as string,
        description: (record.get('description') as string) || undefined,
        createdAt: new Date(record.get('createdAt') as string),
        updatedAt: new Date(record.get('updatedAt') as string),
      }))
    } finally {
      await session.close()
    }
  }

  /**
   * Import edges idempotently.
   *
   * For each edge the source and target nodes are MERGEd (created as
   * stubs if absent) and the relationship is MERGEd by the full
   * (sourceId, targetId, intent) triple so duplicates are avoided.
   */
  async importEdges(edges: AnvilEdge[]): Promise<void> {
    const session = this.session()
    try {
      for (const edge of edges) {
        await session.run(
          `MERGE (s:${NODE_LABEL} {id: $sourceId})
             ON CREATE SET s.title = '', s.type = ''
           MERGE (t:${NODE_LABEL} {id: $targetId})
             ON CREATE SET t.title = '', t.type = ''
           MERGE (s)-[r:${REL_TYPE} {intent: $intent}]->(t)
             ON CREATE SET r.description = $description,
                           r.created_at  = $createdAt,
                           r.updated_at  = $updatedAt
             ON MATCH  SET r.description = $description,
                           r.updated_at  = $updatedAt`,
          {
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            intent: edge.intent,
            description: edge.description ?? '',
            createdAt: edge.createdAt.toISOString(),
            updatedAt: edge.updatedAt.toISOString(),
          },
        )
      }
    } finally {
      await session.close()
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Close the underlying Neo4j driver.
   *
   * After calling this method the store instance must not be reused.
   */
  async close(): Promise<void> {
    await this.driver.close()
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Open a new Neo4j session against the default database. */
  private session(): Session {
    return this.driver.session()
  }

  /**
   * Resolve the display label for an intent, falling back to the raw
   * intent string if the registry does not recognise it (possible for
   * edges created before an intent was un-registered).
   */
  private safeDisplayLabel(
    intent: string,
    direction: 'outgoing' | 'incoming',
  ): string {
    try {
      return this.intentRegistry.getDisplayLabel(intent, direction)
    } catch {
      return intent
    }
  }
}
