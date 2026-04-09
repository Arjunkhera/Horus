/**
 * Edge data model for the Anvil V2 Relations Graph.
 *
 * All edges are a single structural type stored in Neo4j.
 * Semantic meaning is carried by the `intent` property,
 * which references a registered intent in the IntentRegistry.
 */

/** An edge connecting two Anvil entities. */
export interface AnvilEdge {
  /** ID of the source entity (note ID / file path). */
  sourceId: string
  /** ID of the target entity (note ID / file path). */
  targetId: string
  /** Registered intent describing the relationship semantics. */
  intent: string
  /** Optional human-readable description of the specific relationship. */
  description?: string
  /** Timestamp when the edge was first created. */
  createdAt: Date
  /** Timestamp of the most recent update to this edge. */
  updatedAt: Date
}

/** Input for creating a new edge. */
export interface CreateEdgeInput {
  /** ID of the source entity. */
  sourceId: string
  /** ID of the target entity. */
  targetId: string
  /** Registered intent describing the relationship semantics. */
  intent: string
  /** Optional human-readable description. */
  description?: string
}

/**
 * Edge with direction context for display.
 *
 * When querying edges for a specific entity, the direction indicates
 * whether the entity is the source (outgoing) or target (incoming).
 */
export interface ResolvedEdge extends AnvilEdge {
  /** Whether this edge is outgoing or incoming relative to the queried entity. */
  direction: 'outgoing' | 'incoming'
  /** Display label — intent label for outgoing, inverseLabel (or intent) for incoming. */
  displayLabel: string
  /** Title of the entity on the other end of the edge. */
  targetTitle?: string
  /** Note type of the entity on the other end of the edge. */
  targetType?: string
}

/** Lightweight Neo4j node representation for an Anvil entity. */
export interface AnvilGraphNode {
  /** Unique identifier (note ID / file path). */
  id: string
  /** Human-readable title. */
  title: string
  /** Note type (e.g. task, note, story). */
  type: string
  /** Optional status for filtering in graph traversal (open, in-progress, done, etc.). */
  status?: string
}
