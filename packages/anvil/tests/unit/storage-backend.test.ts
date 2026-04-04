/**
 * T1 — Test suite: StorageBackend and FileStore
 *
 * Covers Phase 1 (P1-S3, P1-S4) of the Anvil V2 implementation.
 * Tests LocalStorageBackend (CRUD, dual-write, rebuild, rollback, healthCheck)
 * and LocalFileStore (store, get, exists, delete, mime types).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import * as fss from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

import { LocalStorageBackend } from '../../src/core/storage/local-storage-backend.js'
import { LocalFileStore } from '../../src/core/storage/local-file-store.js'
import type {
  Entity,
  EntityFilters,
  HealthStatus,
} from '../../src/core/storage/storage-backend.js'

const mkdtempAsync = promisify(fss.mkdtemp)

// =============================================================================
// LocalStorageBackend Tests
// =============================================================================

describe('LocalStorageBackend', () => {
  let tmpDir: string
  let vaultPath: string
  let dbPath: string
  let backend: LocalStorageBackend

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-t1-storage-'))
    vaultPath = join(tmpDir, 'vault')
    dbPath = join(tmpDir, 'test.db')
    backend = new LocalStorageBackend(vaultPath, dbPath)
    await backend.initialize()
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('initialize', () => {
    it('should create the vault directory', async () => {
      const stat = await fs.stat(vaultPath)
      expect(stat.isDirectory()).toBe(true)
    })

    it('should create the SQLite database', async () => {
      const stat = await fs.stat(dbPath)
      expect(stat.isFile()).toBe(true)
    })

    it('should be idempotent — calling twice does not error', async () => {
      await expect(backend.initialize()).resolves.toBeUndefined()
    })
  })

  describe('ensureInitialized', () => {
    it('should throw if called before initialize()', async () => {
      const uninitBackend = new LocalStorageBackend(
        join(tmpDir, 'vault2'),
        join(tmpDir, 'db2.db'),
      )
      await expect(
        uninitBackend.createEntity('note', { title: 'Test' }, ''),
      ).rejects.toThrow('not initialized')
    })
  })

  // ---------------------------------------------------------------------------
  // CRUD Lifecycle
  // ---------------------------------------------------------------------------

  describe('CRUD lifecycle', () => {
    it('should create an entity and return result', async () => {
      const result = await backend.createEntity(
        'note',
        { title: 'Hello World', tags: ['test'] },
        'Body content',
      )

      expect(result.id).toBeDefined()
      expect(result.type).toBe('note')
      expect(result.title).toBe('Hello World')
      expect(result.filePath).toBeDefined()
      expect(result.status).toBe('created')
    })

    it('should get an entity by id', async () => {
      const created = await backend.createEntity(
        'task',
        { title: 'My Task', status: 'open', priority: 'P1-high' },
        'Task body',
      )

      const entity = await backend.getEntity(created.id)
      expect(entity.id).toBe(created.id)
      expect(entity.type).toBe('task')
      expect(entity.title).toBe('My Task')
      expect(entity.body).toBe('Task body')
      expect(entity.fields.status).toBe('open')
      expect(entity.fields.priority).toBe('P1-high')
    })

    it('should update entity fields', async () => {
      const created = await backend.createEntity(
        'task',
        { title: 'Original Title', status: 'open' },
        'Original body',
      )

      const updated = await backend.updateEntity(
        created.id,
        { title: 'Updated Title', status: 'in_progress' },
      )

      expect(updated.status).toBe('updated')
      expect(updated.title).toBe('Updated Title')

      const entity = await backend.getEntity(created.id)
      expect(entity.title).toBe('Updated Title')
      expect(entity.fields.status).toBe('in_progress')
    })

    it('should update entity body', async () => {
      const created = await backend.createEntity(
        'note',
        { title: 'Note' },
        'Original body',
      )

      await backend.updateEntity(created.id, undefined, 'New body content')

      const entity = await backend.getEntity(created.id)
      expect(entity.body).toBe('New body content')
    })

    it('should delete an entity', async () => {
      const created = await backend.createEntity(
        'note',
        { title: 'To Delete' },
        'Content',
      )

      await backend.deleteEntity(created.id)

      await expect(backend.getEntity(created.id)).rejects.toThrow('not found')
    })

    it('should throw when getting a non-existent entity', async () => {
      await expect(
        backend.getEntity('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow()
    })

    it('should throw when deleting a non-existent entity', async () => {
      await expect(
        backend.deleteEntity('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow()
    })

    it('should default title to Untitled when missing', async () => {
      const result = await backend.createEntity('note', {}, 'Body')
      const entity = await backend.getEntity(result.id)
      expect(entity.title).toBe('Untitled')
    })
  })

  // ---------------------------------------------------------------------------
  // Dual-write consistency
  // ---------------------------------------------------------------------------

  describe('dual-write consistency', () => {
    it('should write to both filesystem and SQLite on create', async () => {
      const result = await backend.createEntity(
        'note',
        { title: 'Dual Write Test', tags: ['dual'] },
        'Dual write body',
      )

      // Verify filesystem: file should exist
      const files = await findMarkdownFiles(vaultPath)
      expect(files.length).toBeGreaterThanOrEqual(1)

      const matchingFile = files.find((f) => f.includes('dual-write-test'))
      expect(matchingFile).toBeDefined()

      // Verify SQLite: entity should be retrievable
      const entity = await backend.getEntity(result.id)
      expect(entity.title).toBe('Dual Write Test')
      expect(entity.tags).toContain('dual')
    })

    it('should maintain consistency after update', async () => {
      const created = await backend.createEntity(
        'note',
        { title: 'Before Update' },
        'Before body',
      )

      await backend.updateEntity(
        created.id,
        { title: 'After Update' },
        'After body',
      )

      // Read from getEntity (which reads from filesystem via SQLite path)
      const entity = await backend.getEntity(created.id)
      expect(entity.title).toBe('After Update')
      expect(entity.body).toBe('After body')
    })

    it('should remove from both filesystem and SQLite on delete', async () => {
      const created = await backend.createEntity(
        'note',
        { title: 'To Remove' },
        'Remove body',
      )

      // Confirm it exists
      const entityBefore = await backend.getEntity(created.id)
      expect(entityBefore).toBeDefined()

      await backend.deleteEntity(created.id)

      // SQLite: entity should be gone
      await expect(backend.getEntity(created.id)).rejects.toThrow()

      // Filesystem: check no matching file remains
      const files = await findMarkdownFiles(vaultPath)
      const matchingFile = files.find((f) => f.includes('to-remove'))
      expect(matchingFile).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Rebuild from filesystem
  // ---------------------------------------------------------------------------

  describe('rebuild', () => {
    it('should rebuild SQLite index from filesystem', async () => {
      // Create some entities first
      await backend.createEntity('note', { title: 'Rebuild A' }, 'Body A')
      await backend.createEntity('note', { title: 'Rebuild B' }, 'Body B')

      const report = await backend.rebuild()

      expect(report.processed).toBeGreaterThanOrEqual(2)
      expect(report.failed).toBe(0)
      expect(report.duration).toBeGreaterThanOrEqual(0)
    })

    it('should report errors for malformed files', async () => {
      // Create a valid entity
      await backend.createEntity('note', { title: 'Valid' }, 'Valid body')

      // Write a malformed markdown file directly
      const badFile = join(vaultPath, 'bad-note.md')
      await fs.writeFile(badFile, 'This file has no frontmatter at all', 'utf-8')

      const report = await backend.rebuild()

      // Should have processed valid notes and either failed or skipped the bad one
      expect(report.processed + report.skipped + report.failed).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------------------
  // listEntities with filters
  // ---------------------------------------------------------------------------

  describe('listEntities', () => {
    beforeEach(async () => {
      await backend.createEntity('task', { title: 'Task A', status: 'open', priority: 'P1-high', tags: ['alpha'] }, 'Body A')
      await backend.createEntity('task', { title: 'Task B', status: 'done', priority: 'P2-medium', tags: ['beta'] }, 'Body B')
      await backend.createEntity('note', { title: 'Note C', tags: ['alpha', 'beta'] }, 'Body C')
    })

    it('should list all entities with no filters', async () => {
      const result = await backend.listEntities()
      expect(result.total).toBe(3)
      expect(result.entities.length).toBe(3)
    })

    it('should filter by type', async () => {
      const result = await backend.listEntities({ type: 'task' })
      expect(result.total).toBe(2)
      expect(result.entities.every((e) => e.type === 'task')).toBe(true)
    })

    it('should filter by status', async () => {
      const result = await backend.listEntities({ status: 'open' })
      expect(result.total).toBe(1)
      expect(result.entities[0].title).toBe('Task A')
    })

    it('should filter by priority', async () => {
      const result = await backend.listEntities({ priority: 'P1-high' })
      expect(result.total).toBe(1)
      expect(result.entities[0].title).toBe('Task A')
    })

    it('should filter by tags with AND semantics', async () => {
      const result = await backend.listEntities({ tags: ['alpha', 'beta'] })
      expect(result.total).toBe(1)
      expect(result.entities[0].title).toBe('Note C')
    })

    it('should filter by single tag', async () => {
      const result = await backend.listEntities({ tags: ['alpha'] })
      expect(result.total).toBe(2)
    })

    it('should filter by query (title LIKE)', async () => {
      const result = await backend.listEntities({ query: 'Task' })
      expect(result.total).toBe(2)
    })

    it('should support pagination', async () => {
      const page1 = await backend.listEntities(undefined, undefined, 2, 0)
      expect(page1.entities.length).toBe(2)
      expect(page1.total).toBe(3)
      expect(page1.limit).toBe(2)
      expect(page1.offset).toBe(0)

      const page2 = await backend.listEntities(undefined, undefined, 2, 2)
      expect(page2.entities.length).toBe(1)
      expect(page2.offset).toBe(2)
    })

    it('should support sort by title ascending', async () => {
      const result = await backend.listEntities(
        undefined,
        { field: 'title', direction: 'asc' },
      )
      const titles = result.entities.map((e) => e.title)
      expect(titles).toEqual([...titles].sort())
    })

    it('should filter by date range', async () => {
      const now = new Date()
      const past = new Date(now.getTime() - 60 * 60 * 1000)
      const future = new Date(now.getTime() + 60 * 60 * 1000)

      const result = await backend.listEntities({
        createdAfter: past,
        createdBefore: future,
      })
      expect(result.total).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------

  describe('healthCheck', () => {
    it('should return ok status when both subsystems available', async () => {
      const health = await backend.healthCheck()
      expect(health.status).toBe('ok')
      expect(health.sqlite.available).toBe(true)
      expect(health.filesystem.available).toBe(true)
      expect(health.filesystem.path).toBe(vaultPath)
    })

    it('should include noteCount in sqlite section', async () => {
      await backend.createEntity('note', { title: 'Health Test' }, 'Body')
      const health = await backend.healthCheck()
      expect(health.sqlite.noteCount).toBeGreaterThanOrEqual(1)
    })

    it('should return degraded when filesystem unavailable', async () => {
      // Remove the vault directory
      await fs.rm(vaultPath, { recursive: true, force: true })

      const health = await backend.healthCheck()
      expect(health.status).toBe('degraded')
      expect(health.filesystem.available).toBe(false)
      expect(health.sqlite.available).toBe(true)
      expect(health.details).toBeDefined()
    })
  })
})

// =============================================================================
// LocalFileStore Tests
// =============================================================================

describe('LocalFileStore', () => {
  let tmpDir: string
  let dataRoot: string
  let store: LocalFileStore

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-t1-filestore-'))
    dataRoot = join(tmpDir, 'data')
    await fs.mkdir(dataRoot, { recursive: true })
    store = new LocalFileStore(dataRoot)
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('store + get round-trip', () => {
    it('should store a file and retrieve it', async () => {
      // Create a source file
      const sourceFile = join(tmpDir, 'source.txt')
      await fs.writeFile(sourceFile, 'Hello, FileStore!', 'utf-8')

      const entityId = 'test-entity-001'
      const result = await store.store(entityId, 'source.txt', sourceFile)

      expect(result.entityId).toBe(entityId)
      expect(result.filename).toBe('source.txt')
      expect(result.size).toBeGreaterThan(0)
      expect(result.mimeType).toBe('text/plain')
      expect(result.storedPath).toContain(entityId)

      // Retrieve and verify contents
      const stream = await store.get(entityId, 'source.txt')
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const content = Buffer.concat(chunks).toString('utf-8')
      expect(content).toBe('Hello, FileStore!')
    })
  })

  describe('exists', () => {
    it('should return true after store', async () => {
      const sourceFile = join(tmpDir, 'exists-test.txt')
      await fs.writeFile(sourceFile, 'Exists', 'utf-8')

      const entityId = 'test-exists-001'
      await store.store(entityId, 'exists-test.txt', sourceFile)

      expect(await store.exists(entityId, 'exists-test.txt')).toBe(true)
    })

    it('should return false for non-existent file', async () => {
      expect(await store.exists('no-such-entity', 'missing.txt')).toBe(false)
    })

    it('should return false after delete', async () => {
      const sourceFile = join(tmpDir, 'del-test.txt')
      await fs.writeFile(sourceFile, 'Delete me', 'utf-8')

      const entityId = 'test-delete-check'
      await store.store(entityId, 'del-test.txt', sourceFile)
      expect(await store.exists(entityId, 'del-test.txt')).toBe(true)

      await store.delete(entityId)
      expect(await store.exists(entityId, 'del-test.txt')).toBe(false)
    })
  })

  describe('delete', () => {
    it('should remove entity directory and all contents', async () => {
      const sourceFile = join(tmpDir, 'to-delete.txt')
      await fs.writeFile(sourceFile, 'Delete content', 'utf-8')

      const entityId = 'test-delete-001'
      await store.store(entityId, 'to-delete.txt', sourceFile)

      await store.delete(entityId)

      // Directory should be gone
      const dirPath = join(dataRoot, 'files', entityId)
      await expect(fs.access(dirPath)).rejects.toThrow()
    })

    it('should not throw when deleting non-existent entity', async () => {
      await expect(store.delete('non-existent-id')).resolves.toBeUndefined()
    })
  })

  describe('get errors', () => {
    it('should throw when file does not exist', async () => {
      await expect(
        store.get('no-such-entity', 'missing.txt'),
      ).rejects.toThrow('File not found')
    })
  })

  describe('mime type detection', () => {
    const mimeTests: Array<[string, string]> = [
      ['image.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['anim.gif', 'image/gif'],
      ['pic.webp', 'image/webp'],
      ['icon.svg', 'image/svg+xml'],
      ['doc.pdf', 'application/pdf'],
      ['data.json', 'application/json'],
      ['readme.txt', 'text/plain'],
      ['notes.md', 'text/markdown'],
      ['table.csv', 'text/csv'],
    ]

    for (const [filename, expectedMime] of mimeTests) {
      it(`should detect ${expectedMime} for ${filename}`, async () => {
        const sourceFile = join(tmpDir, filename)
        await fs.writeFile(sourceFile, 'test content', 'utf-8')

        const result = await store.store('mime-test', filename, sourceFile)
        expect(result.mimeType).toBe(expectedMime)

        // Clean up for next iteration
        await store.delete('mime-test')
      })
    }

    it('should fallback to application/octet-stream for unknown extensions', async () => {
      const sourceFile = join(tmpDir, 'unknown.xyz')
      await fs.writeFile(sourceFile, 'binary content', 'utf-8')

      const result = await store.store('mime-unknown', 'unknown.xyz', sourceFile)
      expect(result.mimeType).toBe('application/octet-stream')
    })
  })

  describe('large file', () => {
    it('should handle files larger than 10MB', async () => {
      const sourceFile = join(tmpDir, 'large.bin')
      // Create a ~11MB file
      const size = 11 * 1024 * 1024
      const buf = Buffer.alloc(size, 0x42)
      await fs.writeFile(sourceFile, buf)

      const result = await store.store('large-file-test', 'large.bin', sourceFile)
      expect(result.size).toBe(size)

      // Verify we can stream it back
      const stream = await store.get('large-file-test', 'large.bin')
      let totalRead = 0
      for await (const chunk of stream) {
        totalRead += (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).length
      }
      expect(totalRead).toBe(size)
    })
  })
})

// =============================================================================
// Helper
// =============================================================================

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await findMarkdownFiles(fullPath)))
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results
}
