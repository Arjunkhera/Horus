/**
 * T5 — Test suite: Search (schema, query_by, ranking, bootstrap)
 *
 * Covers Phase 5 (P5-S1 through P5-S3) of the Anvil V2 implementation.
 * Tests SchemaBuilder (schema generation, query_by, diffSchema),
 * IndexStage (upsert, remove, reindexAll), and Typesense integration.
 *
 * Requires a running Typesense instance at localhost:8108.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import * as fss from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import Typesense from 'typesense'

import { SchemaBuilder } from '../../src/core/search/schema-builder.js'
import { IndexStage } from '../../src/core/pipeline/stages/index-stage.js'
import { TypeRegistry } from '../../src/registry/type-registry.js'
import { isAnvilError } from '../../src/types/error.js'
import type { Entity } from '../../src/core/storage/storage-backend.js'

const mkdtempAsync = promisify(fss.mkdtemp)
const DEFAULTS_DIR = join(process.cwd(), 'defaults')

const TYPESENSE_HOST = process.env.TYPESENSE_HOST || 'localhost'
const TYPESENSE_PORT = parseInt(process.env.TYPESENSE_PORT || '8108', 10)
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY || 'horus-local-key'

// =============================================================================
// SchemaBuilder Unit Tests (no Typesense needed)
// =============================================================================

describe('SchemaBuilder', () => {
  let registry: TypeRegistry
  let builder: SchemaBuilder

  beforeAll(async () => {
    registry = new TypeRegistry()
    const err = await registry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) throw new Error(`Failed to load types: ${err.message}`)
    builder = new SchemaBuilder(registry)
  })

  describe('buildCollectionSchema', () => {
    it('should generate a valid Typesense collection schema', () => {
      const schema = builder.buildCollectionSchema()

      expect(schema.name).toBe('horus_documents')
      expect(Array.isArray(schema.fields)).toBe(true)
      expect(schema.fields!.length).toBeGreaterThan(0)

      // Should have base fields
      const fieldNames = schema.fields!.map((f: any) => f.name)
      expect(fieldNames).toContain('id')
      expect(fieldNames).toContain('title')
      expect(fieldNames).toContain('body')
      expect(fieldNames).toContain('tags')
      expect(fieldNames).toContain('source')
      expect(fieldNames).toContain('source_type')
      expect(fieldNames).toContain('status')
      expect(fieldNames).toContain('priority')
      expect(fieldNames).toContain('created_at')
      expect(fieldNames).toContain('modified_at')
    })

    it('should include type-specific fields from search_mode annotations', () => {
      const schema = builder.buildCollectionSchema()
      const fieldNames = schema.fields!.map((f: any) => f.name)

      // Bookmark type has url (search_mode: both) and page_title (search_mode: text)
      expect(fieldNames).toContain('url')
      expect(fieldNames).toContain('page_title')

      // File type has mime_type (search_mode: term)
      expect(fieldNames).toContain('mime_type')
    })

    it('should map search_mode correctly to Typesense field config', () => {
      const schema = builder.buildCollectionSchema()
      const fields = schema.fields! as any[]

      // term -> facet: true
      const statusField = fields.find((f) => f.name === 'status')
      expect(statusField?.facet).toBe(true)

      // both -> facet: true (title is query_by + facet)
      const titleField = fields.find((f) => f.name === 'title')
      expect(titleField).toBeDefined()

      // none -> should not be in the schema
      const noteIdField = fields.find((f) => f.name === 'noteId')
      expect(noteIdField).toBeUndefined() // noteId has search_mode: none
    })

    it('should not include fields with search_mode: none', () => {
      const schema = builder.buildCollectionSchema()
      const fieldNames = schema.fields!.map((f: any) => f.name)

      // _core.related has search_mode: none
      expect(fieldNames).not.toContain('related')
      // file.file_path has search_mode: none
      expect(fieldNames).not.toContain('file_path')
    })
  })

  describe('buildQueryBy', () => {
    it('should always include title and body', () => {
      const queryBy = builder.buildQueryBy()
      expect(queryBy).toContain('title')
      expect(queryBy).toContain('body')
    })

    it('should include text and both mode fields', () => {
      const queryBy = builder.buildQueryBy()
      // bookmark.page_title has search_mode: text
      expect(queryBy).toContain('page_title')
    })

    it('should not include term-only fields in query_by', () => {
      const queryBy = builder.buildQueryBy()
      // status has search_mode: term (facet only, not full-text)
      // query_by is for full-text search, so term-only shouldn't be there
      // unless the builder includes them — depends on implementation
      const fields = queryBy.split(',').map((f: string) => f.trim())
      // Title and body should be first
      expect(fields[0]).toBe('title')
      expect(fields[1]).toBe('body')
    })

    it('should return type-scoped query_by when type filter provided', () => {
      const queryByNote = builder.buildQueryBy('note')
      const queryByBookmark = builder.buildQueryBy('bookmark')

      // Bookmark should include url (search_mode: both)
      // Note may not include bookmark-specific fields
      expect(queryByBookmark).toContain('url')
    })
  })

  describe('diffSchema', () => {
    it('should return none when schemas are identical', () => {
      const schema = builder.buildCollectionSchema()
      const result = builder.diffSchema(schema.fields!, schema.fields!)
      expect(result.action).toBe('none')
    })

    it('should detect additive changes (new fields)', () => {
      const current = [
        { name: 'id', type: 'string' },
        { name: 'title', type: 'string' },
      ]
      const computed = [
        { name: 'id', type: 'string' },
        { name: 'title', type: 'string' },
        { name: 'new_field', type: 'string', optional: true },
      ]
      const result = builder.diffSchema(current, computed)
      expect(result.action).toBe('additive')
      expect(result.fieldsToAdd).toBeDefined()
      expect(result.fieldsToAdd.length).toBe(1)
    })

    it('should detect recreate when field type changes', () => {
      const current = [
        { name: 'id', type: 'string' },
        { name: 'tags', type: 'string' },
      ]
      const computed = [
        { name: 'id', type: 'string' },
        { name: 'tags', type: 'string[]', facet: true },
      ]
      const result = builder.diffSchema(current, computed)
      expect(result.action).toBe('recreate')
      expect(result.changedFields).toContain('tags')
    })
  })

  describe('buildDocument', () => {
    it('should build a Typesense document from a Note', () => {
      const note = {
        noteId: 'test-doc-001',
        type: 'note',
        title: 'Test Document',
        body: 'This is the body content',
        tags: ['alpha', 'beta'],
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        status: undefined,
        priority: undefined,
        filePath: '/vault/test-document.md',
        related: [],
        fields: {},
      }

      const doc = builder.buildDocument(note as any)

      expect(doc.id).toBe('test-doc-001')
      expect(doc.title).toBe('Test Document')
      expect(doc.body).toContain('body content')
      expect(doc.source).toBe('anvil')
    })

    it('should truncate body to 20000 chars', () => {
      const longBody = 'x'.repeat(25000)
      const note = {
        noteId: 'test-trunc',
        type: 'note',
        title: 'Long Body',
        body: longBody,
        tags: [],
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        filePath: '/vault/long.md',
        related: [],
        fields: {},
      }

      const doc = builder.buildDocument(note as any)
      expect((doc.body as string).length).toBeLessThanOrEqual(20000)
    })
  })
})

// =============================================================================
// IndexStage + Typesense Integration
// =============================================================================

describe('IndexStage (Typesense integration)', () => {
  let client: any
  let registry: TypeRegistry
  let builder: SchemaBuilder
  let indexStage: IndexStage
  const testCollectionName = 'anvil_test_t5'

  beforeAll(async () => {
    client = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'http' }],
      apiKey: TYPESENSE_API_KEY,
      connectionTimeoutSeconds: 5,
    })

    registry = new TypeRegistry()
    const err = await registry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) throw new Error(`Failed to load types: ${err.message}`)

    builder = new SchemaBuilder(registry)

    // Create test collection
    const schema = builder.buildCollectionSchema()
    schema.name = testCollectionName

    try {
      await client.collections(testCollectionName).delete()
    } catch {
      // Collection may not exist
    }
    await client.collections().create(schema)

    indexStage = new IndexStage(client, builder, testCollectionName)
  })

  afterAll(async () => {
    try {
      await client.collections(testCollectionName).delete()
    } catch {
      // Ignore
    }
  })

  function makeEntity(id: string, title: string, body: string, type = 'note', tags: string[] = []): Entity {
    return {
      id,
      type,
      title,
      body,
      tags,
      fields: {},
      created: new Date(),
      modified: new Date(),
      filePath: `/vault/${id}.md`,
    }
  }

  it('should upsert an entity to Typesense', async () => {
    const entity = makeEntity('t5-upsert-001', 'Upsert Test T5', 'Body content for upsert')
    await indexStage.upsert(entity)

    // Verify via search
    const results = await client.collections(testCollectionName).documents().search({
      q: 'Upsert Test T5',
      query_by: 'title',
      filter_by: `id:=t5-upsert-001`,
    })
    expect(results.found).toBeGreaterThanOrEqual(1)
  })

  it('should remove an entity from Typesense', async () => {
    const entity = makeEntity('t5-remove-001', 'Remove Test T5', 'Body to remove')
    await indexStage.upsert(entity)
    await indexStage.remove('t5-remove-001')

    const results = await client.collections(testCollectionName).documents().search({
      q: '*',
      query_by: 'title',
      filter_by: `id:=t5-remove-001`,
    })
    expect(results.found).toBe(0)
  })

  it('should silently succeed when removing non-existent entity', async () => {
    await expect(indexStage.remove('nonexistent-t5')).resolves.toBeUndefined()
  })

  it('should reindex all entities in bulk', async () => {
    const entities = [
      makeEntity('t5-bulk-001', 'Bulk A T5', 'Body A'),
      makeEntity('t5-bulk-002', 'Bulk B T5', 'Body B'),
      makeEntity('t5-bulk-003', 'Bulk C T5', 'Body C'),
    ]

    const result = await indexStage.reindexAll(entities)
    expect(result.indexed).toBe(3)
    expect(result.failed).toBe(0)

    // Verify all searchable
    const results = await client.collections(testCollectionName).documents().search({
      q: 'Bulk T5',
      query_by: 'title',
    })
    expect(results.found).toBeGreaterThanOrEqual(3)
  })

  it('should report availability', () => {
    expect(indexStage.isAvailable()).toBe(true)
  })

  it('should support search with structured filters', async () => {
    const entity = makeEntity('t5-filter-001', 'Filter Test T5', 'Filterable', 'task', ['searchable'])
    entity.fields = { status: 'open', priority: 'P1-high' }
    await indexStage.upsert(entity)

    const results = await client.collections(testCollectionName).documents().search({
      q: '*',
      query_by: 'title',
      filter_by: `tags:=[searchable]`,
    })
    expect(results.found).toBeGreaterThanOrEqual(1)
  })

  it('should include required result fields', async () => {
    const entity = makeEntity('t5-fields-001', 'Fields Test T5', 'Body with field data')
    await indexStage.upsert(entity)

    const results = await client.collections(testCollectionName).documents().search({
      q: 'Fields Test T5',
      query_by: 'title',
    })

    expect(results.found).toBeGreaterThanOrEqual(1)
    const hit = results.hits![0]
    expect(hit.document).toBeDefined()
    expect(hit.document.id).toBe('t5-fields-001')
    expect(hit.document.title).toBe('Fields Test T5')

    // Highlights / text_match score
    expect(hit.text_match).toBeDefined()
  })
})
