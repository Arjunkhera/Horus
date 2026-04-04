/**
 * T3 — Test suite: Relations Graph (Neo4j edges, MCP tools, backup)
 *
 * Covers Phase 3 (P3-S1 through P3-S4) of the Anvil V2 implementation.
 * Tests IntentRegistry, Neo4jEdgeStore CRUD, direction-aware queries,
 * MCP tool handlers, and edges.json export/import round-trip.
 *
 * Requires a running Neo4j instance at bolt://localhost:7687.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import * as fss from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import neo4j, { Driver } from 'neo4j-driver'

import { IntentRegistry, Neo4jEdgeStore } from '../../src/core/graph/index.js'
import { EdgeBackup } from '../../src/core/graph/edge-backup.js'
import { handleCreateEdge } from '../../src/tools/create-edge.js'
import { handleDeleteEdge } from '../../src/tools/delete-edge.js'
import { handleGetEdges } from '../../src/tools/get-edges.js'

const mkdtempAsync = promisify(fss.mkdtemp)

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'horus-neo4j'

// =============================================================================
// IntentRegistry Tests (no Neo4j needed)
// =============================================================================

describe('IntentRegistry', () => {
  let registry: IntentRegistry

  beforeEach(() => {
    registry = new IntentRegistry()
  })

  it('should have MVP intents registered: mentions, blocks, references', () => {
    expect(registry.validate('mentions')).toBe(true)
    expect(registry.validate('blocks')).toBe(true)
    expect(registry.validate('references')).toBe(true)
  })

  it('should get intent definition by ID', () => {
    const mentions = registry.get('mentions')
    expect(mentions).toBeDefined()
    expect(mentions!.id).toBe('mentions')
    expect(mentions!.direction).toBe('bidirectional')
    expect(mentions!.inverseLabel).toBeNull()
  })

  it('should validate known vs unknown intents', () => {
    expect(registry.validate('mentions')).toBe(true)
    expect(registry.validate('nonexistent')).toBe(false)
  })

  it('should resolve direction for directional intents', () => {
    const blocks = registry.get('blocks')
    expect(blocks).toBeDefined()
    expect(blocks!.direction).toBe('directional')
    expect(blocks!.inverseLabel).toBe('blocked_by')
  })

  it('should return correct display label for outgoing direction', () => {
    expect(registry.getDisplayLabel('blocks', 'outgoing')).toBe('blocks')
    expect(registry.getDisplayLabel('references', 'outgoing')).toBe('references')
  })

  it('should return inverse label for incoming direction', () => {
    expect(registry.getDisplayLabel('blocks', 'incoming')).toBe('blocked_by')
    expect(registry.getDisplayLabel('references', 'incoming')).toBe('referenced_by')
  })

  it('should return intent id for bidirectional incoming', () => {
    expect(registry.getDisplayLabel('mentions', 'incoming')).toBe('mentions')
  })

  it('should list all registered intents', () => {
    const all = registry.list()
    expect(all.length).toBeGreaterThanOrEqual(3)
    const ids = all.map((i) => i.id)
    expect(ids).toContain('mentions')
    expect(ids).toContain('blocks')
    expect(ids).toContain('references')
  })

  it('should register a new intent', () => {
    registry.register({
      id: 'depends_on',
      direction: 'directional',
      inverseLabel: 'depended_by',
      description: 'Dependency relationship',
    })
    expect(registry.validate('depends_on')).toBe(true)
  })

  it('should throw on duplicate registration', () => {
    expect(() =>
      registry.register({
        id: 'mentions',
        direction: 'bidirectional',
        inverseLabel: null,
        description: 'Duplicate',
      }),
    ).toThrow()
  })

  it('should throw getDisplayLabel for unknown intent', () => {
    expect(() => registry.getDisplayLabel('unknown', 'outgoing')).toThrow()
  })
})

// =============================================================================
// Neo4jEdgeStore Tests (requires Neo4j)
// =============================================================================

describe('Neo4jEdgeStore', () => {
  let driver: Driver
  let intentRegistry: IntentRegistry
  let edgeStore: Neo4jEdgeStore

  beforeAll(() => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    intentRegistry = new IntentRegistry()
    edgeStore = new Neo4jEdgeStore(driver, intentRegistry)
  })

  afterAll(async () => {
    await driver.close()
  })

  // Clean up test nodes/edges before each test
  beforeEach(async () => {
    const session = driver.session()
    try {
      await session.run(
        "MATCH (n:AnvilEntity) WHERE n.id STARTS WITH 'test-' DETACH DELETE n",
      )
    } finally {
      await session.close()
    }
  })

  describe('Node operations', () => {
    it('should upsert a node', async () => {
      await edgeStore.upsertNode({ id: 'test-node-1', title: 'Test Node 1', type: 'note' })

      const session = driver.session()
      try {
        const result = await session.run(
          "MATCH (n:AnvilEntity {id: 'test-node-1'}) RETURN n",
        )
        expect(result.records.length).toBe(1)
        expect(result.records[0].get('n').properties.title).toBe('Test Node 1')
      } finally {
        await session.close()
      }
    })

    it('should update existing node on upsert', async () => {
      await edgeStore.upsertNode({ id: 'test-node-2', title: 'Original', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-node-2', title: 'Updated', type: 'task' })

      const session = driver.session()
      try {
        const result = await session.run(
          "MATCH (n:AnvilEntity {id: 'test-node-2'}) RETURN n",
        )
        expect(result.records.length).toBe(1)
        expect(result.records[0].get('n').properties.title).toBe('Updated')
      } finally {
        await session.close()
      }
    })

    it('should delete node and cascade edges', async () => {
      await edgeStore.upsertNode({ id: 'test-del-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-del-b', title: 'B', type: 'note' })
      await edgeStore.createEdge({ sourceId: 'test-del-a', targetId: 'test-del-b', intent: 'mentions' })

      await edgeStore.deleteNode('test-del-a')

      const session = driver.session()
      try {
        const nodeResult = await session.run(
          "MATCH (n:AnvilEntity {id: 'test-del-a'}) RETURN n",
        )
        expect(nodeResult.records.length).toBe(0)

        // Edge should also be gone
        const edgeResult = await session.run(
          "MATCH (:AnvilEntity {id: 'test-del-a'})-[r:ANVIL_EDGE]->() RETURN r",
        )
        expect(edgeResult.records.length).toBe(0)
      } finally {
        await session.close()
      }
    })
  })

  describe('Edge CRUD', () => {
    it('should create an edge between two entities', async () => {
      await edgeStore.upsertNode({ id: 'test-e-src', title: 'Source', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-e-tgt', title: 'Target', type: 'note' })

      const edge = await edgeStore.createEdge({
        sourceId: 'test-e-src',
        targetId: 'test-e-tgt',
        intent: 'references',
        description: 'A test reference',
      })

      expect(edge.sourceId).toBe('test-e-src')
      expect(edge.targetId).toBe('test-e-tgt')
      expect(edge.intent).toBe('references')
      expect(edge.description).toBe('A test reference')
      expect(edge.createdAt).toBeInstanceOf(Date)
    })

    it('should create stub nodes for non-existent targets', async () => {
      const edge = await edgeStore.createEdge({
        sourceId: 'test-stub-src',
        targetId: 'test-stub-tgt',
        intent: 'mentions',
      })

      expect(edge.sourceId).toBe('test-stub-src')

      // Both nodes should exist as stubs
      const session = driver.session()
      try {
        const result = await session.run(
          "MATCH (n:AnvilEntity) WHERE n.id IN ['test-stub-src', 'test-stub-tgt'] RETURN n",
        )
        expect(result.records.length).toBe(2)
      } finally {
        await session.close()
      }
    })

    it('should query edges for an entity', async () => {
      await edgeStore.upsertNode({ id: 'test-q-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-q-b', title: 'B', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-q-c', title: 'C', type: 'note' })

      await edgeStore.createEdge({ sourceId: 'test-q-a', targetId: 'test-q-b', intent: 'mentions' })
      await edgeStore.createEdge({ sourceId: 'test-q-a', targetId: 'test-q-c', intent: 'references' })
      await edgeStore.createEdge({ sourceId: 'test-q-c', targetId: 'test-q-a', intent: 'blocks' })

      const edges = await edgeStore.getEdges('test-q-a')
      expect(edges.length).toBe(3)

      const outgoing = edges.filter((e) => e.direction === 'outgoing')
      const incoming = edges.filter((e) => e.direction === 'incoming')
      expect(outgoing.length).toBe(2)
      expect(incoming.length).toBe(1)
    })

    it('should filter edges by intent', async () => {
      await edgeStore.upsertNode({ id: 'test-fi-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-fi-b', title: 'B', type: 'note' })

      await edgeStore.createEdge({ sourceId: 'test-fi-a', targetId: 'test-fi-b', intent: 'mentions' })
      await edgeStore.createEdge({ sourceId: 'test-fi-a', targetId: 'test-fi-b', intent: 'references' })

      const mentionsOnly = await edgeStore.getEdges('test-fi-a', 'mentions')
      expect(mentionsOnly.length).toBe(1)
      expect(mentionsOnly[0].intent).toBe('mentions')
    })

    it('should delete a specific edge by intent', async () => {
      await edgeStore.upsertNode({ id: 'test-de-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-de-b', title: 'B', type: 'note' })

      await edgeStore.createEdge({ sourceId: 'test-de-a', targetId: 'test-de-b', intent: 'mentions' })
      await edgeStore.createEdge({ sourceId: 'test-de-a', targetId: 'test-de-b', intent: 'references' })

      await edgeStore.deleteEdge('test-de-a', 'test-de-b', 'mentions')

      const remaining = await edgeStore.getEdges('test-de-a')
      expect(remaining.length).toBe(1)
      expect(remaining[0].intent).toBe('references')
    })

    it('should include direction and displayLabel on resolved edges', async () => {
      await edgeStore.upsertNode({ id: 'test-dl-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'test-dl-b', title: 'B', type: 'note' })

      await edgeStore.createEdge({ sourceId: 'test-dl-a', targetId: 'test-dl-b', intent: 'blocks' })

      // From A's perspective: outgoing "blocks"
      const edgesA = await edgeStore.getEdges('test-dl-a')
      const outEdge = edgesA.find((e) => e.direction === 'outgoing')
      expect(outEdge).toBeDefined()
      expect(outEdge!.displayLabel).toBe('blocks')

      // From B's perspective: incoming "blocked_by"
      const edgesB = await edgeStore.getEdges('test-dl-b')
      const inEdge = edgesB.find((e) => e.direction === 'incoming')
      expect(inEdge).toBeDefined()
      expect(inEdge!.displayLabel).toBe('blocked_by')
    })
  })
})

// =============================================================================
// MCP Tool Handlers (requires Neo4j)
// =============================================================================

describe('Edge MCP tools', () => {
  let driver: Driver
  let intentRegistry: IntentRegistry
  let edgeStore: Neo4jEdgeStore
  let ctx: { edgeStore: Neo4jEdgeStore; intentRegistry: IntentRegistry }

  beforeAll(() => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    intentRegistry = new IntentRegistry()
    edgeStore = new Neo4jEdgeStore(driver, intentRegistry)
    ctx = { edgeStore, intentRegistry }
  })

  afterAll(async () => {
    await driver.close()
  })

  beforeEach(async () => {
    const session = driver.session()
    try {
      await session.run(
        "MATCH (n:AnvilEntity) WHERE n.id STARTS WITH 'tool-' DETACH DELETE n",
      )
    } finally {
      await session.close()
    }
  })

  describe('handleCreateEdge', () => {
    it('should create edge via tool handler', async () => {
      await edgeStore.upsertNode({ id: 'tool-src', title: 'Source', type: 'note' })
      await edgeStore.upsertNode({ id: 'tool-tgt', title: 'Target', type: 'note' })

      const result = await handleCreateEdge(ctx, {
        sourceId: 'tool-src',
        targetId: 'tool-tgt',
        intent: 'mentions',
      })

      expect(result).toBeDefined()
      expect((result as any).sourceId).toBe('tool-src')
    })

    it('should reject invalid intent', async () => {
      const result = await handleCreateEdge(ctx, {
        sourceId: 'tool-a',
        targetId: 'tool-b',
        intent: 'invalid_intent',
      })

      // Should be an error
      expect(result).toBeDefined()
      const r = result as any
      expect(r.error || r.code || r.isError).toBeTruthy()
    })
  })

  describe('handleDeleteEdge', () => {
    it('should delete edge via tool handler', async () => {
      await edgeStore.upsertNode({ id: 'tool-del-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'tool-del-b', title: 'B', type: 'note' })
      await edgeStore.createEdge({ sourceId: 'tool-del-a', targetId: 'tool-del-b', intent: 'mentions' })

      const result = await handleDeleteEdge(ctx, {
        sourceId: 'tool-del-a',
        targetId: 'tool-del-b',
        intent: 'mentions',
      })

      expect((result as any).deleted).toBe(true)

      const remaining = await edgeStore.getEdges('tool-del-a')
      expect(remaining.length).toBe(0)
    })
  })

  describe('handleGetEdges', () => {
    it('should return edges via tool handler', async () => {
      await edgeStore.upsertNode({ id: 'tool-get-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'tool-get-b', title: 'B', type: 'note' })
      await edgeStore.createEdge({ sourceId: 'tool-get-a', targetId: 'tool-get-b', intent: 'blocks' })

      const result = await handleGetEdges(ctx, { noteId: 'tool-get-a' })

      expect((result as any).edges).toBeDefined()
      expect((result as any).total).toBe(1)
    })

    it('should filter by intent', async () => {
      await edgeStore.upsertNode({ id: 'tool-gf-a', title: 'A', type: 'note' })
      await edgeStore.upsertNode({ id: 'tool-gf-b', title: 'B', type: 'note' })
      await edgeStore.createEdge({ sourceId: 'tool-gf-a', targetId: 'tool-gf-b', intent: 'mentions' })
      await edgeStore.createEdge({ sourceId: 'tool-gf-a', targetId: 'tool-gf-b', intent: 'references' })

      const result = await handleGetEdges(ctx, { noteId: 'tool-gf-a', intent: 'mentions' })

      expect((result as any).total).toBe(1)
      expect((result as any).edges[0].intent).toBe('mentions')
    })
  })
})

// =============================================================================
// EdgeBackup — export/import round-trip (requires Neo4j)
// =============================================================================

describe('EdgeBackup', () => {
  let driver: Driver
  let intentRegistry: IntentRegistry
  let edgeStore: Neo4jEdgeStore
  let tmpDir: string
  let backup: EdgeBackup

  beforeAll(() => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
    intentRegistry = new IntentRegistry()
    edgeStore = new Neo4jEdgeStore(driver, intentRegistry)
  })

  afterAll(async () => {
    await driver.close()
  })

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-t3-backup-'))
    backup = new EdgeBackup(edgeStore, tmpDir)

    // Clean test nodes
    const session = driver.session()
    try {
      await session.run(
        "MATCH (n:AnvilEntity) WHERE n.id STARTS WITH 'bak-' DETACH DELETE n",
      )
    } finally {
      await session.close()
    }
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  it('should export edges to JSON file', async () => {
    await edgeStore.upsertNode({ id: 'bak-a', title: 'A', type: 'note' })
    await edgeStore.upsertNode({ id: 'bak-b', title: 'B', type: 'note' })
    await edgeStore.createEdge({ sourceId: 'bak-a', targetId: 'bak-b', intent: 'mentions' })

    const count = await backup.exportToFile()
    expect(count).toBeGreaterThanOrEqual(1)

    // Verify file exists
    const filePath = join(tmpDir, '_graph', 'edges.json')
    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)

    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))
    expect(Array.isArray(content)).toBe(true)
    expect(content.length).toBeGreaterThanOrEqual(1)
  })

  it('should round-trip: export → wipe → import → verify', async () => {
    // Create test edges
    await edgeStore.upsertNode({ id: 'bak-rt-a', title: 'A', type: 'note' })
    await edgeStore.upsertNode({ id: 'bak-rt-b', title: 'B', type: 'note' })
    await edgeStore.upsertNode({ id: 'bak-rt-c', title: 'C', type: 'note' })
    await edgeStore.createEdge({ sourceId: 'bak-rt-a', targetId: 'bak-rt-b', intent: 'mentions' })
    await edgeStore.createEdge({ sourceId: 'bak-rt-a', targetId: 'bak-rt-c', intent: 'blocks' })

    // Export
    const exportCount = await backup.exportToFile()
    expect(exportCount).toBeGreaterThanOrEqual(2)

    // Wipe test edges from Neo4j
    const session = driver.session()
    try {
      await session.run(
        "MATCH (n:AnvilEntity) WHERE n.id STARTS WITH 'bak-rt-' DETACH DELETE n",
      )
    } finally {
      await session.close()
    }

    // Verify wiped
    const edgesAfterWipe = await edgeStore.getEdges('bak-rt-a')
    expect(edgesAfterWipe.length).toBe(0)

    // Import
    const importResult = await backup.importFromFile()
    expect(importResult.imported).toBeGreaterThanOrEqual(2)

    // Verify restored
    const edgesAfterImport = await edgeStore.getEdges('bak-rt-a')
    expect(edgesAfterImport.length).toBe(2)
  })

  it('should return skipped when backup file does not exist', async () => {
    const result = await backup.importFromFile()
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(true)
  })
})
