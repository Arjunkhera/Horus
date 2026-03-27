import type { AnvilDb } from './sqlite.js';
import type { QueryFilter, SortOrder } from '../types/index.js';

/**
 * Build parameterized SQL query from QueryFilter
 */
export function buildQuerySql(filters: QueryFilter): {
  sql: string;
  params: any[];
} {
  const conditions: string[] = [];
  const params: any[] = [];

  // Type filter
  if (filters.type) {
    conditions.push('notes.type = ?');
    params.push(filters.type);
  }

  // Status filter (exact or negation)
  if (filters.status) {
    if (typeof filters.status === 'string') {
      conditions.push('notes.status = ?');
      params.push(filters.status);
    } else if (filters.status.not) {
      conditions.push('(notes.status != ? OR notes.status IS NULL)');
      params.push(filters.status.not);
    }
  }

  // Priority filter
  if (filters.priority) {
    conditions.push('notes.priority = ?');
    params.push(filters.priority);
  }

  // Tags filter (AND semantics via JOIN)
  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      conditions.push(`EXISTS (
        SELECT 1 FROM note_tags
        WHERE note_tags.note_id = notes.note_id
        AND note_tags.tag = ?
      )`);
      params.push(tag);
    }
  }

  // Due date range
  if (filters.due) {
    if (filters.due.gte) {
      conditions.push('notes.due >= ?');
      params.push(filters.due.gte);
    }
    if (filters.due.lte) {
      conditions.push('notes.due <= ?');
      params.push(filters.due.lte);
    }
  }

  // Created date range
  if (filters.created) {
    if (filters.created.gte) {
      conditions.push('notes.created >= ?');
      params.push(filters.created.gte);
    }
    if (filters.created.lte) {
      conditions.push('notes.created <= ?');
      params.push(filters.created.lte);
    }
  }

  // Modified date range
  if (filters.modified) {
    if (filters.modified.gte) {
      conditions.push('notes.modified >= ?');
      params.push(filters.modified.gte);
    }
    if (filters.modified.lte) {
      conditions.push('notes.modified <= ?');
      params.push(filters.modified.lte);
    }
  }

  // Scope filters
  if (filters.scope) {
    if (filters.scope.context) {
      conditions.push('notes.scope_context = ?');
      params.push(filters.scope.context);
    }
    if (filters.scope.team) {
      conditions.push('notes.scope_team = ?');
      params.push(filters.scope.team);
    }
    if (filters.scope.service) {
      conditions.push('notes.scope_service = ?');
      params.push(filters.scope.service);
    }
  }

  // Assignee (filter by note ID — matches target_id in the relationships table)
  if (filters.assignee) {
    conditions.push(`EXISTS (
      SELECT 1 FROM relationships
      WHERE relationships.source_id = notes.note_id
      AND relationships.relation_type = 'assignee'
      AND relationships.target_id = ?
    )`);
    params.push(filters.assignee);
  }

  // Project (filter by note ID — matches target_id in the relationships table)
  if (filters.project) {
    conditions.push(`EXISTS (
      SELECT 1 FROM relationships
      WHERE relationships.source_id = notes.note_id
      AND relationships.relation_type = 'project'
      AND relationships.target_id = ?
    )`);
    params.push(filters.project);
  }

  // Archived filter
  if (filters.archived !== undefined) {
    conditions.push('notes.archived = ?');
    params.push(filters.archived ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      notes.note_id, notes.type, notes.title, notes.status, notes.priority,
      notes.due, notes.modified, notes.file_path
    FROM notes
    ${whereClause}
  `;

  return { sql, params };
}

/**
 * Query notes with filters, sorting, and pagination
 */
export function queryNotes(
  db: AnvilDb,
  filters: QueryFilter,
  orderBy: SortOrder,
  limit: number,
  offset: number
): {
  rows: any[];
  total: number;
} {
  const { sql: baseSql, params: baseParams } = buildQuerySql(filters);

  // Add ordering
  const orderField = orderBy.field.replace(/[^a-z_]/gi, ''); // Basic sanitization
  const orderDir = orderBy.direction === 'asc' ? 'ASC' : 'DESC';
  const orderedSql = baseSql + ` ORDER BY ${orderField} ${orderDir} LIMIT ? OFFSET ?`;

  // Count total matching rows
  const countSql = `SELECT COUNT(*) as count FROM (${baseSql})`;
  const countResult = db.getOne<{ count: number }>(countSql, baseParams);

  // Fetch paginated results
  const rows = db.getAll(orderedSql, [...baseParams, limit, offset]);

  return {
    rows,
    total: countResult?.count ?? 0,
  };
}
