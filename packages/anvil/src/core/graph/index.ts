/**
 * Anvil V2 Relations Graph — edge model and intent registry.
 *
 * @module core/graph
 */

export type {
  AnvilEdge,
  CreateEdgeInput,
  ResolvedEdge,
  AnvilGraphNode,
} from './edge-model.js'

export type { IntentDefinition } from './intent-registry.js'
export { IntentRegistry } from './intent-registry.js'

export { Neo4jEdgeStore } from './neo4j-edge-store.js'
