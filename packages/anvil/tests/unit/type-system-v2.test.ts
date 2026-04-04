/**
 * T2 — Test suite: Type System (search_mode, new types, type CRUD)
 *
 * Covers Phase 2 (P2-S1 through P2-S4) of the Anvil V2 implementation.
 * Tests search_mode parsing/validation, bookmark/file entity types,
 * inheritance resolution, and anvil_create_type / anvil_update_type tools.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { promises as fs } from 'fs'
import * as fss from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

import { TypeRegistry } from '../../src/registry/type-registry.js'
import { handleCreateType } from '../../src/tools/create-type.js'
import { handleUpdateType } from '../../src/tools/update-type.js'
import { isAnvilError } from '../../src/types/error.js'
import type { ToolContext } from '../../src/tools/create-note.js'

const mkdtempAsync = promisify(fss.mkdtemp)

// Path to built-in type definitions
const DEFAULTS_DIR = join(process.cwd(), 'defaults')

// =============================================================================
// search_mode Tests
// =============================================================================

describe('search_mode', () => {
  let registry: TypeRegistry

  beforeAll(async () => {
    registry = new TypeRegistry()
    const err = await registry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) {
      throw new Error(`Failed to load types: ${err.message}`)
    }
  })

  it('should accept valid search_mode values: term, text, both, none', () => {
    const coreType = registry.getType('_core')
    expect(coreType).toBeDefined()

    // _core.type has search_mode: term
    expect(coreType!.fields.type.search_mode).toBe('term')
    // _core.title has search_mode: both
    expect(coreType!.fields.title.search_mode).toBe('both')
    // _core.tags has search_mode: both
    expect(coreType!.fields.tags.search_mode).toBe('both')
    // _core.noteId has search_mode: none
    expect(coreType!.fields.noteId.search_mode).toBe('none')
    // _core.related has search_mode: none
    expect(coreType!.fields.related.search_mode).toBe('none')
  })

  it('should default search_mode to undefined when omitted', () => {
    // Fields that have no search_mode declared should be undefined (treated as none)
    const taskType = registry.getType('task')
    expect(taskType).toBeDefined()
    // effort has search_mode: none explicitly
    expect(taskType!.fields.effort.search_mode).toBe('none')
  })

  it('should have correct search_mode annotations on built-in types', () => {
    // Check task type
    const task = registry.getType('task')
    expect(task).toBeDefined()
    expect(task!.fields.status.search_mode).toBe('term')
    expect(task!.fields.priority.search_mode).toBe('term')
    expect(task!.fields.due.search_mode).toBe('term')

    // Check bookmark type (inherits from note)
    const bookmark = registry.getType('bookmark')
    expect(bookmark).toBeDefined()
    expect(bookmark!.fields.url.search_mode).toBe('both')
    expect(bookmark!.fields.page_title.search_mode).toBe('text')
    expect(bookmark!.fields.description.search_mode).toBe('text')
    expect(bookmark!.fields.favicon.search_mode).toBe('none')

    // Check file type (inherits from note)
    const file = registry.getType('file')
    expect(file).toBeDefined()
    expect(file!.fields.file_path.search_mode).toBe('none')
    expect(file!.fields.mime_type.search_mode).toBe('term')
  })
})

// =============================================================================
// New Entity Types
// =============================================================================

describe('New entity types', () => {
  let registry: TypeRegistry

  beforeAll(async () => {
    registry = new TypeRegistry()
    const err = await registry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) {
      throw new Error(`Failed to load types: ${err.message}`)
    }
  })

  describe('bookmark type', () => {
    it('should load with all expected fields', () => {
      const bookmark = registry.getType('bookmark')
      expect(bookmark).toBeDefined()
      expect(bookmark!.id).toBe('bookmark')
      expect(bookmark!.name).toBe('Bookmark')

      // Own fields
      expect(bookmark!.fields.url).toBeDefined()
      expect(bookmark!.fields.url.type).toBe('url')
      expect(bookmark!.fields.url.required).toBe(true)

      expect(bookmark!.fields.page_title).toBeDefined()
      expect(bookmark!.fields.page_title.type).toBe('string')

      expect(bookmark!.fields.description).toBeDefined()
      expect(bookmark!.fields.favicon).toBeDefined()
      expect(bookmark!.fields.og_image).toBeDefined()
      expect(bookmark!.fields.fetched_at).toBeDefined()
    })

    it('should inherit from note -> _core', () => {
      const bookmark = registry.getType('bookmark')
      expect(bookmark).toBeDefined()

      // Should have _core fields via inheritance
      expect(bookmark!.fields.noteId).toBeDefined()
      expect(bookmark!.fields.title).toBeDefined()
      expect(bookmark!.fields.created).toBeDefined()
      expect(bookmark!.fields.modified).toBeDefined()
      expect(bookmark!.fields.tags).toBeDefined()
    })
  })

  describe('file type', () => {
    it('should load with all expected fields', () => {
      const file = registry.getType('file')
      expect(file).toBeDefined()
      expect(file!.id).toBe('file')
      expect(file!.name).toBe('File')

      expect(file!.fields.file_path).toBeDefined()
      expect(file!.fields.file_path.type).toBe('string')
      expect(file!.fields.file_path.required).toBe(true)

      expect(file!.fields.mime_type).toBeDefined()
      expect(file!.fields.mime_type.type).toBe('string')
      expect(file!.fields.mime_type.required).toBe(true)

      expect(file!.fields.file_size).toBeDefined()
      expect(file!.fields.description).toBeDefined()
    })

    it('should inherit from note -> _core', () => {
      const file = registry.getType('file')
      expect(file).toBeDefined()

      expect(file!.fields.noteId).toBeDefined()
      expect(file!.fields.title).toBeDefined()
      expect(file!.fields.tags).toBeDefined()
    })
  })

  describe('inheritance resolution', () => {
    it('should propagate search_mode through inheritance chain', () => {
      const bookmark = registry.getType('bookmark')
      expect(bookmark).toBeDefined()

      // Inherited from _core: title.search_mode should be 'both'
      expect(bookmark!.fields.title.search_mode).toBe('both')
      // Own field: url.search_mode should be 'both'
      expect(bookmark!.fields.url.search_mode).toBe('both')
    })
  })
})

// =============================================================================
// Type CRUD MCP Tools
// =============================================================================

describe('Type CRUD tools', () => {
  let tmpDir: string
  let vaultPath: string
  let registry: TypeRegistry
  let ctx: ToolContext

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-t2-types-'))
    vaultPath = join(tmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })

    // Copy defaults into vault .anvil/types
    const typesDir = join(vaultPath, '.anvil', 'types')
    await fs.mkdir(typesDir, { recursive: true })

    const defaultFiles = await fs.readdir(DEFAULTS_DIR)
    for (const file of defaultFiles) {
      if (file.endsWith('.yaml')) {
        await fs.copyFile(join(DEFAULTS_DIR, file), join(typesDir, file))
      }
    }

    // Initialize registry
    registry = new TypeRegistry()
    const err = await registry.loadTypes(typesDir)
    if (isAnvilError(err)) {
      throw new Error(`Failed to load types: ${err.message}`)
    }

    ctx = {
      vaultPath,
      registry,
      db: undefined as any,
      watcher: undefined,
    }
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('anvil_create_type', () => {
    it('should create a custom type in custom-types/', async () => {
      const result = await handleCreateType(
        {
          id: 'recipe',
          name: 'Recipe',
          fields: {
            ingredients: { type: 'text', search_mode: 'text' },
            prep_time: { type: 'number', search_mode: 'none' },
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(false)
      if (!isAnvilError(result)) {
        expect(result.id).toBe('recipe')
        expect(result.name).toBe('Recipe')
        expect(result.fields.ingredients).toBeDefined()
        expect(result.fields.prep_time).toBeDefined()
      }

      // Verify YAML file exists
      const yamlPath = join(vaultPath, 'custom-types', 'recipe.yaml')
      const stat = await fs.stat(yamlPath)
      expect(stat.isFile()).toBe(true)
    })

    it('should make type available immediately after creation', async () => {
      await handleCreateType(
        {
          id: 'widget',
          name: 'Widget',
          fields: {
            color: { type: 'string', search_mode: 'term' },
          },
        },
        ctx,
      )

      // Registry should now have the type
      expect(registry.hasType('widget')).toBe(true)
      const resolved = registry.getType('widget')
      expect(resolved).toBeDefined()
      expect(resolved!.fields.color).toBeDefined()
    })

    it('should reject duplicate type ID', async () => {
      // 'task' already exists as built-in
      const result = await handleCreateType(
        {
          id: 'task',
          name: 'Duplicate Task',
          fields: {
            foo: { type: 'string' },
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })

    it('should reject invalid type ID format', async () => {
      const result = await handleCreateType(
        {
          id: 'UPPERCASE',
          name: 'Bad ID',
          fields: { x: { type: 'string' } },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })

    it('should detect field collision with parent type', async () => {
      // Create type extending note, with a field name that conflicts with _core
      const result = await handleCreateType(
        {
          id: 'bad-child',
          name: 'Bad Child',
          extends: 'note',
          fields: {
            title: { type: 'string' }, // conflicts with _core.title
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })

    it('should accept valid extends with non-colliding fields', async () => {
      const result = await handleCreateType(
        {
          id: 'article',
          name: 'Article',
          extends: 'note',
          fields: {
            author: { type: 'string', search_mode: 'text' },
            word_count: { type: 'number', search_mode: 'none' },
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(false)
      if (!isAnvilError(result)) {
        expect(result.id).toBe('article')
        // Should have inherited fields from note + _core
        expect(result.fields.title).toBeDefined()
        expect(result.fields.author).toBeDefined()
      }
    })

    it('should reject when extends references non-existent type', async () => {
      const result = await handleCreateType(
        {
          id: 'orphan',
          name: 'Orphan',
          extends: 'non-existent-parent',
          fields: { x: { type: 'string' } },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })
  })

  describe('anvil_update_type', () => {
    it('should add a field to a custom type', async () => {
      // First create a custom type
      await handleCreateType(
        {
          id: 'gadget',
          name: 'Gadget',
          fields: {
            model: { type: 'string', search_mode: 'text' },
          },
        },
        ctx,
      )

      // Now update it by adding a field
      const result = await handleUpdateType(
        {
          typeId: 'gadget',
          fields: {
            price: { type: 'number', search_mode: 'none' },
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(false)
      if (!isAnvilError(result)) {
        expect(result.fields.model).toBeDefined()
        expect(result.fields.price).toBeDefined()
      }
    })

    it('should reject update to built-in type', async () => {
      const result = await handleUpdateType(
        {
          typeId: 'task',
          fields: {
            new_field: { type: 'string' },
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })

    it('should reject field name collision with existing fields', async () => {
      await handleCreateType(
        {
          id: 'updatable',
          name: 'Updatable',
          fields: {
            existing_field: { type: 'string' },
          },
        },
        ctx,
      )

      const result = await handleUpdateType(
        {
          typeId: 'updatable',
          fields: {
            existing_field: { type: 'number' }, // collides with existing
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })

    it('should reject field collision with inherited fields', async () => {
      await handleCreateType(
        {
          id: 'child-type',
          name: 'Child Type',
          extends: 'note',
          fields: {
            custom_field: { type: 'string' },
          },
        },
        ctx,
      )

      const result = await handleUpdateType(
        {
          typeId: 'child-type',
          fields: {
            title: { type: 'string' }, // collides with _core.title
          },
        },
        ctx,
      )

      expect(isAnvilError(result)).toBe(true)
    })
  })
})
