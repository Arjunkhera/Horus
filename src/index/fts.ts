import type { AnvilDb } from './sqlite.js';
import type { QueryFilter, SortOrder } from '../types/index.js';

export interface SearchResult {
  noteId: string;
  score: number;
  snippet: string;
}

/**
 * Sanitize FTS5 query string.
 * - Strips dangerous FTS5 operators (parentheses, quotes, colons)
 * - Splits multi-word queries into individual terms joined by OR
 *   so "anvil issues" matches notes containing either word (ranked by BM25)
 * - Single words are passed through as-is for prefix or exact match
 * - Empty/whitespace-only queries become '*' (match all)
 */
function sanitizeFtsQuery(query: string): string {
  const cleaned = query.replace(/[()":]/g, '').trim();

  if (!cleaned) return '*';

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '*';

  if (words.length === 1) return words[0];

  // Multiple words — join with OR for broader matching.
  // BM25 ranking will still prefer notes that match more terms.
  return words.join(' OR ');
}

/**
 * Search using FTS5 with BM25 ranking
 * Returns ranked results with snippets
 */
export function searchFts(
  db: AnvilDb,
  query: string,
  limit: number,
  offset: number
): SearchResult[] {
  const sanitized = sanitizeFtsQuery(query);

  const rows = db.getAll<{ noteId: string; score: number; snippet: string }>(
    `SELECT
      notes.note_id as noteId,
      bm25(notes_fts, 10.0, 5.0, 1.0) as score,
      snippet(notes_fts, -1, '<b>', '</b>', '...', 32) as snippet
    FROM notes_fts
    JOIN notes ON notes.rowid = notes_fts.rowid
    WHERE notes_fts MATCH ?
    ORDER BY score
    LIMIT ? OFFSET ?`,
    [sanitized, limit, offset]
  );

  // BM25 in SQLite returns negative values where more negative = better
  // Reverse the sign and sort so better matches come first (positive, descending)
  return rows
    .map((row) => ({
      ...row,
      score: -(row.score as unknown as number),
    }))
    .sort((a, b) => b.score - a.score);
}

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

  // Assignee (stored in a field or as a note relationship)
  if (filters.assignee) {
    conditions.push(`EXISTS (
      SELECT 1 FROM relationships
      WHERE relationships.source_id = notes.note_id
      AND relationships.relation_type = 'assignee'
      AND relationships.target_title = ?
    )`);
    params.push(filters.assignee);
  }

  // Project (stored in a field or as a note relationship)
  if (filters.project) {
    conditions.push(`EXISTS (
      SELECT 1 FROM relationships
      WHERE relationships.source_id = notes.note_id
      AND relationships.relation_type = 'project'
      AND relationships.target_title = ?
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

/**
 * Calculate recency decay factor based on modified date
 * Today = 1.0, decays exponentially
 */
function getRecencyBoost(modifiedISO: string): number {
  const now = new Date();
  const modified = new Date(modifiedISO);
  const daysSince = (now.getTime() - modified.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay: e^(-k * days), k = 0.1
  // 7 days ≈ 0.49, 30 days ≈ 0.05
  const boost = Math.exp(-0.1 * daysSince);
  return Math.max(0.1, boost); // Floor at 0.1
}

/**
 * Combined search: FTS + filter + recency boost
 */
export function combinedSearch(
  db: AnvilDb,
  query: string,
  filters: QueryFilter,
  limit: number,
  offset: number
): {
  results: SearchResult[];
  total: number;
} {
  // Run FTS first
  const ftsResults = searchFts(db, query, limit * 3, 0); // Get more to filter

  if (ftsResults.length === 0) {
    return { results: [], total: 0 };
  }

  const ftsNoteIds = ftsResults.map((r) => r.noteId);

  // Get base query SQL for filtering
  const { sql: filterBaseSql, params: filterParams } = buildQuerySql(filters);

  // Build the WHERE clause that constrains to FTS results
  const whereMatch = filterBaseSql.includes('WHERE') ? ' AND ' : ' WHERE ';
  const placeholders = ftsNoteIds.map(() => '?').join(',');
  const constrainedSql = filterBaseSql + `${whereMatch}notes.note_id IN (${placeholders})`;

  const filteredRows = db.getAll<{ note_id: string; modified: string }>(
    constrainedSql,
    [...filterParams, ...ftsNoteIds]
  );

  if (filteredRows.length === 0) {
    return { results: [], total: 0 };
  }

  // Build modified date lookup
  const modifiedMap = new Map(
    filteredRows.map((row) => [row.note_id, row.modified])
  );

  // Boost FTS scores by recency
  const boostedResults = ftsResults
    .filter((r) => modifiedMap.has(r.noteId))
    .map((result) => {
      const modified = modifiedMap.get(result.noteId)!;
      const boost = getRecencyBoost(modified);
      return {
        ...result,
        score: result.score * boost,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Apply pagination
  const paginatedResults = boostedResults.slice(offset, offset + limit);

  return {
    results: paginatedResults,
    total: boostedResults.length,
  };
}
