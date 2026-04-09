/**
 * MCP tool handler: anvil_execute_view
 *
 * Reads a view node's query definition and executes it,
 * returning formatted results. The view executor is the
 * atomic unit for dashboard rendering.
 *
 * @module tools/execute-view
 */

import type { ToolContext } from './create-note.js'
import { makeError, ERROR_CODES } from '../types/error.js'
import type { AnvilError } from '../types/error.js'
import { readNote } from '../storage/file-store.js'
import { queryNotes } from '../index/query.js'
import type { QueryFilter, SortOrder } from '../types/query.js'

/** Input schema for anvil_execute_view. */
export interface ExecuteViewInput {
  /** UUID of the view node to execute. */
  viewId: string
}

/** A single result item from view execution. */
interface ViewResultItem {
  noteId: string
  type: string
  title: string
  status?: string
  priority?: string
  due?: string
  tags?: string[]
  modified?: string
}

/** Result shape returned by the view executor. */
interface ExecuteViewResult {
  viewTitle: string
  format: string
  results: ViewResultItem[]
  total: number
  groupBy?: string
  groups?: Record<string, ViewResultItem[]>
}

/**
 * Execute a saved view by reading its query definition and running it.
 */
export async function handleExecuteView(
  input: ExecuteViewInput,
  ctx: ToolContext,
): Promise<ExecuteViewResult | AnvilError> {
  if (!input.viewId) {
    return makeError(ERROR_CODES.VALIDATION_ERROR, 'viewId is required')
  }

  // 1. Look up the view note in SQLite to get file path
  const noteRow = ctx.db.raw.getOne<{ note_id: string; type: string; title: string; file_path: string }>(
    'SELECT note_id, type, title, file_path FROM notes WHERE note_id = ?',
    [input.viewId],
  )

  if (!noteRow) {
    return makeError(ERROR_CODES.NOT_FOUND, `View not found: ${input.viewId}`)
  }

  if (noteRow.type !== 'view') {
    return makeError(ERROR_CODES.VALIDATION_ERROR, `Note ${input.viewId} is not a view (type: ${noteRow.type})`)
  }

  // 2. Read the view definition from filesystem
  const readResult = await readNote(noteRow.file_path)
  if ('error' in readResult) {
    return makeError(ERROR_CODES.NOT_FOUND, `Could not read view note: ${input.viewId}`)
  }

  const { note } = readResult
  const viewFields = note.fields ?? {}
  const query = viewFields.query as Record<string, unknown> | undefined
  const format = (viewFields.format as string) ?? 'list'
  const groupBy = viewFields.group_by as string | undefined
  const sortBy = viewFields.sort_by as string | undefined

  if (!query) {
    return makeError(ERROR_CODES.VALIDATION_ERROR, 'View has no query definition')
  }

  // 3. Build the QueryFilter from the view query
  const filter: QueryFilter = {}
  if (query.type) filter.type = query.type as string
  if (query.status) filter.status = query.status as string
  if (query.priority) filter.priority = query.priority as string
  if (query.tags) filter.tags = query.tags as string[]
  if (query.due) filter.due = query.due as { gte?: string; lte?: string }
  if (query.created) filter.created = query.created as { gte?: string; lte?: string }
  if (query.modified) filter.modified = query.modified as { gte?: string; lte?: string }
  if (query.assignee) filter.assignee = query.assignee as string
  if (query.project) filter.project = query.project as string
  if (query.scope) filter.scope = query.scope as { context?: 'personal' | 'work'; team?: string; service?: string }

  const limit = (query.limit as number) ?? 50
  const offset = (query.offset as number) ?? 0

  const orderBy: SortOrder = sortBy
    ? { field: sortBy, direction: 'asc' }
    : { field: 'modified', direction: 'desc' }

  // 4. Execute the query
  const { rows, total } = queryNotes(ctx.db.raw, filter, orderBy, limit, offset)

  const results: ViewResultItem[] = rows.map((row: Record<string, unknown>) => ({
    noteId: row.note_id as string,
    type: row.type as string,
    title: row.title as string,
    status: (row.status as string) || undefined,
    priority: (row.priority as string) || undefined,
    due: (row.due as string) || undefined,
    modified: (row.modified as string) || undefined,
  }))

  // 5. Fetch tags for results
  if (results.length > 0) {
    const noteIds = results.map((r) => r.noteId)
    const placeholders = noteIds.map(() => '?').join(',')
    const tagRows = ctx.db.raw.getAll<{ note_id: string; tag: string }>(
      `SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders})`,
      noteIds,
    )

    const tagMap = new Map<string, string[]>()
    for (const row of tagRows) {
      const existing = tagMap.get(row.note_id) ?? []
      existing.push(row.tag)
      tagMap.set(row.note_id, existing)
    }
    for (const result of results) {
      result.tags = tagMap.get(result.noteId) ?? []
    }
  }

  // 6. Group results if groupBy is specified
  let groups: Record<string, ViewResultItem[]> | undefined
  if (groupBy) {
    groups = {}
    for (const item of results) {
      const key = (item as unknown as Record<string, unknown>)[groupBy] as string ?? 'ungrouped'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
  }

  return {
    viewTitle: noteRow.title,
    format,
    results,
    total,
    groupBy,
    groups,
  }
}
