// Handler for anvil_search tool

import type { AnvilDb } from '../index/sqlite.js';
import type { SearchInput } from '../types/tools.js';
import type { ToolContext } from './create-note.js';
import type { SearchResponse, SearchResult } from '../types/view.js';
import type { AnvilError } from '../types/error.js';
import type { QueryFilter } from '../types/query.js';
import { makeError, ERROR_CODES } from '../types/error.js';
import { queryNotes, buildQuerySql } from '../index/query.js';

/**
 * Resolve semantic search results to database note IDs.
 *
 * Search returns file paths as `noteId` (via normalizeResults). We look them up
 * in `notes.file_path`. Handles both relative paths (stored in DB) and absolute
 * paths by stripping the vault prefix when needed.
 *
 * Results that cannot be resolved are dropped.
 */
function resolveSemanticNoteIds(
  db: AnvilDb,
  results: Array<{ noteId: string; score: number; snippet: string }>,
  vaultPath: string
): Array<{ noteId: string; score: number; snippet: string }> {
  if (results.length === 0) return [];

  const resolved: Array<{ noteId: string; score: number; snippet: string }> = [];
  const vaultPrefix = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/';

  for (const r of results) {
    if (!r.noteId) continue;

    // 1. Try exact match (covers relative path stored in DB)
    let row = db.getOne<{ note_id: string }>(
      'SELECT note_id FROM notes WHERE file_path = ?',
      [r.noteId]
    );
    if (row) {
      resolved.push({ ...r, noteId: row.note_id });
      continue;
    }

    // 2. Try stripping vault prefix (covers absolute paths)
    if (r.noteId.startsWith(vaultPrefix)) {
      const relative = r.noteId.slice(vaultPrefix.length);
      row = db.getOne<{ note_id: string }>(
        'SELECT note_id FROM notes WHERE file_path = ?',
        [relative]
      );
      if (row) {
        resolved.push({ ...r, noteId: row.note_id });
        continue;
      }
    }

    // 3. Try as a UUID directly
    row = db.getOne<{ note_id: string }>(
      'SELECT note_id FROM notes WHERE note_id = ?',
      [r.noteId]
    );
    if (row) {
      resolved.push(r);
    }
    // Otherwise drop — can't resolve to a known note
  }

  return resolved;
}

/**
 * Apply structured filters to a set of pre-resolved note IDs.
 * Returns only the IDs that pass the filter.
 */
function filterNoteIds(
  db: AnvilDb,
  noteIds: string[],
  filter: QueryFilter
): string[] {
  if (noteIds.length === 0) return [];

  const { sql: baseSql, params: baseParams } = buildQuerySql(filter);
  const placeholders = noteIds.map(() => '?').join(',');
  const whereConnector = baseSql.toUpperCase().includes('WHERE') ? ' AND ' : ' WHERE ';
  const constrainedSql = baseSql + `${whereConnector}notes.note_id IN (${placeholders})`;

  const rows = db.getAll<{ note_id: string }>(
    // Wrap to select only the note_id column
    `SELECT notes.note_id FROM (${constrainedSql.trim()}) AS notes`,
    [...baseParams, ...noteIds]
  );

  return rows.map((r) => r.note_id);
}

/**
 * Fetch tags for a set of note IDs.
 * Returns a Map<noteId, string[]>.
 */
function fetchTagsForNotes(
  db: AnvilDb,
  noteIds: string[]
): Map<string, string[]> {
  if (noteIds.length === 0) {
    return new Map();
  }

  const placeholders = noteIds.map(() => '?').join(',');
  const rows = db.getAll<{ note_id: string; tag: string }>(
    `SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders}) ORDER BY tag`,
    noteIds
  );

  const tagsMap = new Map<string, string[]>();
  for (const row of rows) {
    if (!tagsMap.has(row.note_id)) {
      tagsMap.set(row.note_id, []);
    }
    tagsMap.get(row.note_id)!.push(row.tag);
  }

  return tagsMap;
}

/**
 * Fetch additional metadata for notes given their IDs.
 * Returns metadata keyed by noteId.
 */
function fetchNoteMetadata(
  db: AnvilDb,
  noteIds: string[]
): Map<
  string,
  {
    type: string;
    title: string;
    status?: string;
    priority?: string;
    due?: string;
    modified: string;
  }
> {
  if (noteIds.length === 0) {
    return new Map();
  }

  const placeholders = noteIds.map(() => '?').join(',');
  const rows = db.getAll<{
    note_id: string;
    type: string;
    title: string;
    status?: string | null;
    priority?: string | null;
    due?: string | null;
    modified: string;
  }>(
    `SELECT note_id, type, title, status, priority, due, modified FROM notes WHERE note_id IN (${placeholders})`,
    noteIds
  );

  const metadataMap = new Map(
    rows.map((row) => [
      row.note_id,
      {
        type: row.type,
        title: row.title,
        status: row.status || undefined,
        priority: row.priority || undefined,
        due: row.due || undefined,
        modified: row.modified,
      },
    ])
  );

  return metadataMap;
}

/**
 * Build QueryFilter from SearchInput.
 * Maps input fields to filter fields.
 */
function buildQueryFilter(input: SearchInput): QueryFilter {
  const filter: QueryFilter = {};

  if (input.query) {
    filter.query = input.query;
  }
  if (input.type) {
    filter.type = input.type;
  }
  if (input.status) {
    filter.status = input.status;
  }
  if (input.priority) {
    filter.priority = input.priority;
  }
  if (input.tags && input.tags.length > 0) {
    filter.tags = input.tags;
  }
  if (input.due) {
    filter.due = input.due;
  }
  if (input.assignee) {
    filter.assignee = input.assignee;
  }
  if (input.project) {
    filter.project = input.project;
  }
  if (input.scope) {
    filter.scope = input.scope;
  }

  return filter;
}

/**
 * Check if a QueryFilter has any non-query fields (i.e., actual filters).
 */
function hasFilters(filter: QueryFilter): boolean {
  return !!(
    filter.type ||
    filter.status ||
    filter.priority ||
    filter.tags ||
    filter.due ||
    filter.assignee ||
    filter.project ||
    filter.scope
  );
}

/**
 * Handle anvil_search request.
 * Uses Typesense search engine for text queries and SQLite for filter-only queries.
 * Returns paginated SearchResult objects with metadata and tags.
 */
export async function handleSearch(
  input: SearchInput,
  ctx: ToolContext
): Promise<SearchResponse | AnvilError> {
  try {
    const limit = input.limit || 20;
    const offset = input.offset || 0;

    // Validate pagination parameters
    if (limit < 1 || limit > 100) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'limit must be between 1 and 100'
      );
    }
    if (offset < 0) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'offset must be non-negative'
      );
    }

    // Build filter
    const filter = buildQueryFilter(input);
    const hasActiveFilters = hasFilters(filter);

    let searchResults: Array<{ noteId: string; score?: number; snippet?: string }> = [];
    let total = 0;

    // Case S: semantic param present -> vector or hybrid search via Typesense embedding field
    if (input.semantic) {
      if (!ctx.typesenseClient) {
        return makeError(
          ERROR_CODES.SERVER_ERROR,
          'Semantic search requires Typesense with HORUS_EMBEDDING_API_KEY configured'
        );
      }
      const page = Math.floor(offset / limit) + 1;
      // Hybrid when query also provided, pure vector otherwise
      const queryBy = input.query ? 'title,body,embedding' : 'embedding';
      const q = input.query ?? input.semantic;
      try {
        const response = await ctx.typesenseClient
          .collections('horus_documents')
          .documents()
          .search({
            q,
            query_by: queryBy,
            filter_by: 'source:=anvil',
            per_page: hasActiveFilters ? limit * 5 : limit,
            page,
            highlight_full_fields: 'title',
            snippet_threshold: 30,
          });
        const hits = (response.hits ?? []) as Array<{
          document: { id: string };
          text_match: number;
          highlights?: Array<{ snippet?: string }>;
        }>;
        let resolved = resolveSemanticNoteIds(
          ctx.db.raw,
          hits.map((h) => ({ noteId: h.document.id, score: h.text_match, snippet: h.highlights?.[0]?.snippet ?? '' })),
          ctx.vaultPath
        );
        if (hasActiveFilters) {
          const filteredIds = filterNoteIds(ctx.db.raw, resolved.map((r) => r.noteId), filter);
          const filteredSet = new Set(filteredIds);
          resolved = resolved.filter((r) => filteredSet.has(r.noteId));
        }
        total = (response.found as number | undefined) ?? resolved.length;
        searchResults = hasActiveFilters
          ? resolved.slice(0, limit)
          : resolved;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const hint = msg.includes('embedding') || msg.includes('field')
          ? ' — ensure HORUS_EMBEDDING_API_KEY is set and the service has restarted'
          : '';
        return makeError(ERROR_CODES.SERVER_ERROR, `Semantic search failed: ${msg}${hint}`);
      }
    }
    // Case 1: Query + Filters -> text search candidates filtered by structured criteria
    else if (input.query && hasActiveFilters) {
      if (ctx.searchEngine) {
        try {
          // Fetch more candidates than needed to allow for filter attrition
          const rawResults = await ctx.searchEngine.query(input.query, { limit: limit * 5 });
          const resolved = resolveSemanticNoteIds(ctx.db.raw, rawResults, ctx.vaultPath);
          const filteredIds = filterNoteIds(ctx.db.raw, resolved.map((r) => r.noteId), filter);
          const filteredSet = new Set(filteredIds);
          const filtered = resolved.filter((r) => filteredSet.has(r.noteId));
          total = filtered.length;
          searchResults = filtered.slice(offset, offset + limit);
        } catch {
          return makeError(
            ERROR_CODES.SERVER_ERROR,
            'Search engine unavailable. Text search requires Typesense.'
          );
        }
      } else {
        return makeError(
          ERROR_CODES.SERVER_ERROR,
          'Search engine not configured. Text search requires Typesense.'
        );
      }
    }
    // Case 2: Query only -> semantic search via Typesense
    else if (input.query && !hasActiveFilters) {
      if (ctx.searchEngine) {
        try {
          const rawResults = await ctx.searchEngine.query(input.query, { limit, offset });
          const resolved = resolveSemanticNoteIds(ctx.db.raw, rawResults, ctx.vaultPath);
          searchResults = resolved;
          total = resolved.length < limit ? offset + resolved.length : offset + limit;
        } catch {
          return makeError(
            ERROR_CODES.SERVER_ERROR,
            'Search engine unavailable. Text search requires Typesense.'
          );
        }
      } else {
        return makeError(
          ERROR_CODES.SERVER_ERROR,
          'Search engine not configured. Text search requires Typesense.'
        );
      }
    }
    // Case 3: Filters only -> use queryNotes (pure SQL)
    else if (hasActiveFilters) {
      const queryResult = queryNotes(
        ctx.db.raw,
        filter,
        { field: 'modified', direction: 'desc' },
        limit,
        offset
      );

      searchResults = queryResult.rows.map((row) => ({
        noteId: row.note_id || row.noteId,
      }));
      total = queryResult.total;
    }
    // Case 4: No query and no filters -> return empty
    else {
      return {
        results: [],
        total: 0,
        limit,
        offset,
      };
    }

    // Fetch tags and metadata for all results
    const noteIds = searchResults.map((r) => r.noteId);
    const tagsMap = fetchTagsForNotes(ctx.db.raw, noteIds);
    const metadataMap = fetchNoteMetadata(ctx.db.raw, noteIds);

    // Build final SearchResult array
    const results: SearchResult[] = [];
    for (const result of searchResults) {
      const metadata = metadataMap.get(result.noteId);
      if (!metadata) {
        // Shouldn't happen if data is consistent, skip
        continue;
      }

      results.push({
        noteId: result.noteId,
        type: metadata.type,
        title: metadata.title,
        status: metadata.status,
        priority: metadata.priority,
        due: metadata.due,
        tags: tagsMap.get(result.noteId) || [],
        modified: metadata.modified,
        score: result.score ?? null,
        snippet: result.snippet ?? null,
      });
    }

    return {
      results,
      total,
      limit,
      offset,
    };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Search failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
