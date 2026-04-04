/**
 * LocalStorageBackend — concrete StorageBackend implementation for local
 * filesystem + SQLite persistence.
 *
 * Composes the existing V1 building blocks (file-store, indexer, sqlite)
 * behind the V2 StorageBackend interface. Every mutating operation writes
 * to both the filesystem (markdown + frontmatter) and the SQLite index,
 * with rollback on failure to maintain the dual-write invariant.
 *
 * @module core/storage/local-storage-backend
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

import type {
  StorageBackend,
  Entity,
  EntityResult,
  EntityList,
  EntityFilters,
  SortOptions,
  RebuildReport,
  HealthStatus,
} from './storage-backend.js'

import { AnvilDatabase, AnvilDb } from '../../index/sqlite.js'
import {
  readNote,
  writeNote,
  scanVault,
  generateFilePath,
  deleteFile,
} from '../../storage/file-store.js'
import {
  upsertNote,
  deleteNote as deleteNoteFromIndex,
  fullRebuild,
  getNote,
} from '../../index/indexer.js'
import { isAnvilError } from '../../types/error.js'
import type { Note } from '../../types/note.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Note object from V2 Entity-style inputs.
 * Maps the flat Entity field model onto the V1 Note shape.
 */
function buildNote(
  id: string,
  type: string,
  title: string,
  fields: Record<string, unknown>,
  body: string,
  filePath: string,
  created: string,
  modified: string,
  tags: string[],
): Note {
  // Extract well-known fields, leaving the rest in `fields`
  const { status, priority, due, effort, scope, related, ...customFields } = fields as Record<string, any>

  return {
    noteId: id,
    type,
    title,
    created,
    modified,
    tags,
    related: Array.isArray(related) ? related : [],
    scope: scope as Note['scope'],
    status: status as string | undefined,
    priority: priority as string | undefined,
    due: due as string | undefined,
    effort: typeof effort === 'number' ? effort : undefined,
    fields: customFields,
    body,
    filePath,
  }
}

/**
 * Convert a V1 Note into a V2 Entity.
 */
function noteToEntity(note: Note): Entity {
  // Merge well-known optional fields back into `fields`
  const fields: Record<string, unknown> = { ...note.fields }
  if (note.status !== undefined) fields.status = note.status
  if (note.priority !== undefined) fields.priority = note.priority
  if (note.due !== undefined) fields.due = note.due
  if (note.effort !== undefined) fields.effort = note.effort
  if (note.scope !== undefined) fields.scope = note.scope
  if (note.related && note.related.length > 0) fields.related = note.related

  return {
    id: note.noteId,
    type: note.type,
    title: note.title,
    fields,
    body: note.body,
    created: new Date(note.created),
    modified: new Date(note.modified),
    tags: note.tags,
    filePath: note.filePath,
  }
}

/**
 * Get the file_path for a note from the SQLite index.
 * The V1 `getNote` indexer function doesn't return file_path,
 * so we query directly.
 */
function getFilePath(db: AnvilDb, noteId: string): string | null {
  const row = db.getOne<{ file_path: string }>(
    'SELECT file_path FROM notes WHERE note_id = ?',
    [noteId],
  )
  return row?.file_path ?? null
}

// ---------------------------------------------------------------------------
// LocalStorageBackend
// ---------------------------------------------------------------------------

export class LocalStorageBackend implements StorageBackend {
  private vaultPath: string
  private dbPath: string
  private database: AnvilDatabase | null = null
  private db: AnvilDb | null = null

  constructor(vaultPath: string, dbPath: string, existingDb?: AnvilDatabase) {
    this.vaultPath = vaultPath
    this.dbPath = dbPath
    if (existingDb) {
      this.database = existingDb
      this.db = existingDb.raw
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this.database) {
      this.database = AnvilDatabase.create(this.dbPath)
      this.db = this.database.raw
    }

    // Validate vault directory exists; create if needed
    await fs.mkdir(this.vaultPath, { recursive: true })

    // Quick integrity check — if the notes table is missing something is very wrong
    try {
      this.db!.getOne('SELECT count(*) as cnt FROM notes', [])
    } catch {
      // Table missing or corrupt — re-initialize schema
      this.database.close()
      this.database = AnvilDatabase.create(this.dbPath)
      this.db = this.database.raw
    }
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async createEntity(
    type: string,
    fields: Record<string, unknown>,
    body: string,
  ): Promise<EntityResult> {
    this.ensureInitialized()

    const id = uuidv4()
    const now = new Date().toISOString()
    const title = (fields.title as string) || 'Untitled'
    const tags = Array.isArray(fields.tags) ? (fields.tags as string[]) : []

    // Generate a unique file path
    const relativePath = await generateFilePath(this.vaultPath, title, type, 'flat')
    const absolutePath = join(this.vaultPath, relativePath)

    // Strip title and tags from fields — they are top-level Note properties
    const { title: _t, tags: _tags, ...remainingFields } = fields

    const note = buildNote(id, type, title, remainingFields, body, absolutePath, now, now, tags)

    // Step 1: Write to filesystem
    await writeNote(note)

    // Step 2: Index in SQLite — rollback file on failure
    try {
      upsertNote(this.db!, note)
    } catch (err) {
      // Rollback: delete the file we just created
      try {
        await deleteFile(absolutePath)
      } catch {
        // Best-effort cleanup
      }
      throw err
    }

    return {
      id,
      type,
      title,
      filePath: relativePath,
      status: 'created',
    }
  }

  async updateEntity(
    id: string,
    fields?: Record<string, unknown>,
    body?: string,
  ): Promise<EntityResult> {
    this.ensureInitialized()

    // Read current note from disk
    const filePath = getFilePath(this.db!, id)
    if (!filePath) {
      throw new Error(`Entity not found: ${id}`)
    }

    const readResult = await readNote(filePath)
    if (isAnvilError(readResult)) {
      throw new Error(`Failed to read entity ${id}: ${readResult.message}`)
    }

    const existingNote = readResult.note

    // Preserve original file content for rollback
    const originalContent = await fs.readFile(filePath, 'utf-8')

    // Merge fields
    const mergedFields = { ...existingNote.fields }
    let mergedTitle = existingNote.title
    let mergedTags = existingNote.tags
    let mergedStatus = existingNote.status
    let mergedPriority = existingNote.priority
    let mergedDue = existingNote.due
    let mergedEffort = existingNote.effort
    let mergedScope = existingNote.scope
    let mergedRelated = existingNote.related

    if (fields) {
      // Extract well-known fields from the update
      if ('title' in fields) mergedTitle = fields.title as string
      if ('tags' in fields) mergedTags = fields.tags as string[]
      if ('status' in fields) mergedStatus = fields.status as string | undefined
      if ('priority' in fields) mergedPriority = fields.priority as string | undefined
      if ('due' in fields) mergedDue = fields.due as string | undefined
      if ('effort' in fields) mergedEffort = fields.effort as number | undefined
      if ('scope' in fields) mergedScope = fields.scope as Note['scope']
      if ('related' in fields) mergedRelated = fields.related as string[]

      // Merge custom fields
      for (const [key, value] of Object.entries(fields)) {
        if (!['title', 'tags', 'status', 'priority', 'due', 'effort', 'scope', 'related'].includes(key)) {
          mergedFields[key] = value
        }
      }
    }

    const now = new Date().toISOString()

    const updatedNote: Note = {
      noteId: id,
      type: existingNote.type,
      title: mergedTitle,
      created: existingNote.created,
      modified: now,
      tags: mergedTags,
      related: mergedRelated,
      scope: mergedScope,
      status: mergedStatus,
      priority: mergedPriority,
      due: mergedDue,
      effort: mergedEffort,
      fields: mergedFields,
      body: body !== undefined ? body : existingNote.body,
      filePath: existingNote.filePath,
    }

    // Step 1: Write updated note to filesystem
    await writeNote(updatedNote)

    // Step 2: Update SQLite index — rollback file on failure
    try {
      upsertNote(this.db!, updatedNote)
    } catch (err) {
      // Rollback: restore original file content
      try {
        await fs.writeFile(filePath, originalContent, 'utf-8')
      } catch {
        // Best-effort rollback
      }
      throw err
    }

    return {
      id,
      type: updatedNote.type,
      title: mergedTitle,
      filePath: existingNote.filePath,
      status: 'updated',
    }
  }

  async deleteEntity(id: string): Promise<void> {
    this.ensureInitialized()

    const filePath = getFilePath(this.db!, id)
    if (!filePath) {
      throw new Error(`Entity not found: ${id}`)
    }

    // Step 1: Delete from filesystem
    try {
      await deleteFile(filePath)
    } catch (err) {
      // If file already gone, proceed with index cleanup
      if (isAnvilError(err) || (err instanceof Error && err.message.includes('NOT_FOUND'))) {
        // File already deleted — continue to clean up index
      } else {
        throw err
      }
    }

    // Step 2: Delete from SQLite index
    try {
      deleteNoteFromIndex(this.db!, id)
    } catch (err) {
      // Can't easily undelete the file — log and re-throw
      console.error(`[LocalStorageBackend] SQLite delete failed after file deletion for ${id}:`, err)
      throw err
    }
  }

  async getEntity(id: string): Promise<Entity> {
    this.ensureInitialized()

    const filePath = getFilePath(this.db!, id)
    if (!filePath) {
      throw new Error(`Entity not found: ${id}`)
    }

    const readResult = await readNote(filePath)
    if (isAnvilError(readResult)) {
      throw new Error(`Failed to read entity ${id}: ${readResult.message}`)
    }

    return noteToEntity(readResult.note)
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  async listEntities(
    filters?: EntityFilters,
    sort?: SortOptions,
    limit: number = 50,
    offset: number = 0,
  ): Promise<EntityList> {
    this.ensureInitialized()

    const whereClauses: string[] = []
    const params: any[] = []

    if (filters) {
      if (filters.type) {
        whereClauses.push('n.type = ?')
        params.push(filters.type)
      }
      if (filters.status) {
        whereClauses.push('n.status = ?')
        params.push(filters.status)
      }
      if (filters.priority) {
        whereClauses.push('n.priority = ?')
        params.push(filters.priority)
      }
      if (filters.query) {
        whereClauses.push('(n.title LIKE ? OR n.body_text LIKE ?)')
        const q = `%${filters.query}%`
        params.push(q, q)
      }
      if (filters.createdAfter) {
        whereClauses.push('n.created >= ?')
        params.push(filters.createdAfter.toISOString())
      }
      if (filters.createdBefore) {
        whereClauses.push('n.created <= ?')
        params.push(filters.createdBefore.toISOString())
      }
      if (filters.modifiedAfter) {
        whereClauses.push('n.modified >= ?')
        params.push(filters.modifiedAfter.toISOString())
      }
      if (filters.modifiedBefore) {
        whereClauses.push('n.modified <= ?')
        params.push(filters.modifiedBefore.toISOString())
      }
      if (filters.tags && filters.tags.length > 0) {
        // AND semantics: entity must have ALL specified tags
        for (const tag of filters.tags) {
          whereClauses.push(
            `EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.note_id AND t.tag = ?)`,
          )
          params.push(tag)
        }
      }
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // Sort
    const validSortFields: Record<string, string> = {
      modified: 'n.modified',
      created: 'n.created',
      title: 'n.title',
      type: 'n.type',
      status: 'n.status',
      priority: 'n.priority',
      due: 'n.due',
    }
    const sortField = sort?.field && validSortFields[sort.field] ? validSortFields[sort.field] : 'n.modified'
    const sortDir = sort?.direction === 'asc' ? 'ASC' : 'DESC'

    // Count total matching
    const countRow = this.db!.getOne<{ cnt: number }>(
      `SELECT count(*) as cnt FROM notes n ${whereSQL}`,
      params,
    )
    const total = countRow?.cnt ?? 0

    // Fetch page
    const rows = this.db!.getAll<{
      note_id: string
      type: string
      title: string
      file_path: string
      created: string
      modified: string
      status: string | null
      priority: string | null
      due: string | null
      effort: number | null
      scope_context: string | null
      scope_team: string | null
      scope_service: string | null
      body_text: string | null
    }>(
      `SELECT n.note_id, n.type, n.title, n.file_path, n.created, n.modified,
              n.status, n.priority, n.due, n.effort,
              n.scope_context, n.scope_team, n.scope_service, n.body_text
       FROM notes n
       ${whereSQL}
       ORDER BY ${sortField} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )

    // Build Entity objects from the SQL rows + tags
    const entities: Entity[] = rows.map((row) => {
      const tagRows = this.db!.getAll<{ tag: string }>(
        'SELECT tag FROM note_tags WHERE note_id = ?',
        [row.note_id],
      )
      const tags = tagRows.map((r) => r.tag)

      const fields: Record<string, unknown> = {}
      if (row.status !== null) fields.status = row.status
      if (row.priority !== null) fields.priority = row.priority
      if (row.due !== null) fields.due = row.due
      if (row.effort !== null) fields.effort = row.effort
      if (row.scope_context || row.scope_team || row.scope_service) {
        fields.scope = {
          context: row.scope_context || undefined,
          team: row.scope_team || undefined,
          service: row.scope_service || undefined,
        }
      }

      return {
        id: row.note_id,
        type: row.type,
        title: row.title,
        fields,
        body: row.body_text ?? '',
        created: new Date(row.created),
        modified: new Date(row.modified),
        tags,
        filePath: row.file_path,
      }
    })

    return { entities, total, limit, offset }
  }

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  async rebuild(): Promise<RebuildReport> {
    this.ensureInitialized()

    const start = Date.now()
    let processed = 0
    let skipped = 0
    let failed = 0
    const errors: Array<{ file: string; error: string }> = []
    const notes: Note[] = []

    for await (const scanResult of scanVault(this.vaultPath)) {
      const absolutePath = join(this.vaultPath, scanResult.filePath)

      const readResult = await readNote(absolutePath)

      if (isAnvilError(readResult)) {
        failed++
        errors.push({ file: scanResult.filePath, error: readResult.message })
        continue
      }

      const note = readResult.note

      // Skip notes without an ID — they can't be indexed
      if (!note.noteId) {
        skipped++
        continue
      }

      notes.push(note)
      processed++
    }

    // Full rebuild in a single transaction
    fullRebuild(this.db!, notes)

    const duration = Date.now() - start

    return { processed, skipped, failed, errors, duration }
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<HealthStatus> {
    const fsAvailable = await this.checkFilesystem()

    let sqliteAvailable = false
    let noteCount: number | undefined

    try {
      if (this.db) {
        const row = this.db.getOne<{ cnt: number }>('SELECT count(*) as cnt FROM notes', [])
        sqliteAvailable = true
        noteCount = row?.cnt ?? 0
      }
    } catch {
      sqliteAvailable = false
    }

    let status: HealthStatus['status'] = 'ok'
    if (!fsAvailable && !sqliteAvailable) {
      status = 'error'
    } else if (!fsAvailable || !sqliteAvailable) {
      status = 'degraded'
    }

    const details =
      status !== 'ok'
        ? `filesystem: ${fsAvailable ? 'ok' : 'unavailable'}, sqlite: ${sqliteAvailable ? 'ok' : 'unavailable'}`
        : undefined

    return {
      status,
      sqlite: { available: sqliteAvailable, noteCount },
      filesystem: { available: fsAvailable, path: this.vaultPath },
      details,
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error(
        'LocalStorageBackend not initialized. Call initialize() first.',
      )
    }
  }

  private async checkFilesystem(): Promise<boolean> {
    try {
      await fs.access(this.vaultPath)
      return true
    } catch {
      return false
    }
  }
}
