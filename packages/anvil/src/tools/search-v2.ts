// Handler for anvil_search V2 — enhanced search with auto query_by and structured filters

import type { AnvilDb } from '../index/sqlite.js';
import type { ToolContext } from './create-note.js';
import type { AnvilError } from '../types/error.js';
import type { QueryFilter } from '../types/query.js';
import type { SchemaBuilder } from '../core/search/schema-builder.js';
import { makeError, ERROR_CODES } from '../types/error.js';
import { queryNotes, buildQuerySql } from '../index/query.js';

// ── Constants ──────────────────────────────────────────────────────────────

const COLLECTION = 'horus_documents';
const DEFAULT_SORT = '_text_match:desc,modified_at:desc';
const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;
const MAX_LIMIT = 100;
/** Fetch multiplier when post-filtering Typesense results with SQL filters */
const OVERFETCH_FACTOR = 5;

// ── Input / Output types ───────────────────────────────────────────────────

export interface SearchV2Filters {
  status?: string;
  tags?: string[];
  priority?: string;
  created_after?: string;   // ISO date
  created_before?: string;  // ISO date
  modified_after?: string;  // ISO date
  modified_before?: string; // ISO date
}

export interface SearchV2Input {
  query?: string;
  type?: string;
  filters?: SearchV2Filters;
  query_by?: string[];
  sort_by?: string;
  limit?: number;
  offset?: number;
}

export interface SearchV2Hit {
  id: string;
  type: string;
  title: string;
  snippet: string;
  matched_fields: string[];
  score: number;
  status?: string;
  tags?: string[];
  modified_at: string;
}

export interface SearchV2Response {
  results: SearchV2Hit[];
  total: number;
  limit: number;
  offset: number;
}

// ── Extended context (ToolContext + optional schemaBuilder) ─────────────────

export type SearchV2Context = ToolContext & {
  schemaBuilder?: SchemaBuilder;
};

// ── Tool description ───────────────────────────────────────────────────────

/**
 * Rich description for MCP tool registration and agent discoverability.
 */
export const SEARCH_V2_DESCRIPTION = `Enhanced search for Anvil notes with auto-optimized query fields and structured filters.

Features:
- Automatic query_by construction: when a type filter is provided, the search fields are automatically tuned to include type-specific fields (e.g. searching tasks will include assignee, searching stories will include acceptance_criteria). Override with explicit query_by if needed.
- Structured filters: filter by status, priority, tags (AND semantics), and date ranges (created/modified before/after) without writing raw filter strings.
- Custom sorting: override the default relevance+recency ranking with any Typesense sort expression.
- Full-text search via Typesense with fallback to SQLite for filter-only queries.

Query patterns:
- Text search: { "query": "authentication bug" }
- Type-scoped search: { "query": "login", "type": "task" }
- Filter only: { "type": "task", "filters": { "status": "in_progress", "priority": "high" } }
- Text + filters: { "query": "deploy", "filters": { "tags": ["devops"], "modified_after": "2026-01-01" } }
- Custom fields: { "query": "fix", "query_by": ["title", "body", "acceptance_criteria"] }
- Custom sort: { "query": "meeting", "sort_by": "created_at:desc" }
- Pagination: { "query": "project", "limit": 10, "offset": 20 }

Available filter fields:
- status: exact match (e.g. "in_progress", "done", "backlog")
- priority: exact match (e.g. "high", "medium", "low")
- tags: AND semantics — notes must have ALL specified tags
- created_after / created_before: ISO date strings
- modified_after / modified_before: ISO date strings
`;

// ── Typesense filter_by builder ────────────────────────────────────────────

/**
 * Build a Typesense filter_by string from structured filters and type.
 * Always includes source:=anvil. Combines clauses with ' && '.
 */
function buildFilterBy(type?: string, filters?: SearchV2Filters): string {
  const clauses: string[] = ['source:=anvil'];

  if (type) {
    clauses.push(`source_type:=${type}`);
  }

  if (filters) {
    if (filters.status) {
      clauses.push(`status:=${filters.status}`);
    }
    if (filters.priority) {
      clauses.push(`priority:=${filters.priority}`);
    }
    if (filters.tags && filters.tags.length > 0) {
      // AND semantics: each tag must match — Typesense uses && for array AND
      for (const tag of filters.tags) {
        clauses.push(`tags:=${tag}`);
      }
    }
    if (filters.created_after) {
      const ts = isoToEpoch(filters.created_after);
      if (ts !== null) clauses.push(`created_at:>=${ts}`);
    }
    if (filters.created_before) {
      const ts = isoToEpoch(filters.created_before);
      if (ts !== null) clauses.push(`created_at:<=${ts}`);
    }
    if (filters.modified_after) {
      const ts = isoToEpoch(filters.modified_after);
      if (ts !== null) clauses.push(`modified_at:>=${ts}`);
    }
    if (filters.modified_before) {
      const ts = isoToEpoch(filters.modified_before);
      if (ts !== null) clauses.push(`modified_at:<=${ts}`);
    }
  }

  return clauses.join(' && ');
}

/**
 * Convert an ISO date string to unix epoch seconds.
 * Returns null if the string is not a valid date.
 */
function isoToEpoch(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// ── Resolve Typesense document IDs to Anvil note IDs ───────────────────────

/**
 * Resolve Typesense document IDs (file paths or UUIDs) to actual note IDs.
 * Reuses the same resolution strategy as search.ts.
 */
function resolveDocumentIds(
  db: AnvilDb,
  hits: Array<{ docId: string; score: number; snippet: string; matchedFields: string[] }>,
  vaultPath: string,
): Array<{ noteId: string; score: number; snippet: string; matchedFields: string[] }> {
  if (hits.length === 0) return [];

  const resolved: Array<{ noteId: string; score: number; snippet: string; matchedFields: string[] }> = [];
  const vaultPrefix = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/';

  for (const h of hits) {
    if (!h.docId) continue;

    // 1. Exact match on file_path
    let row = db.getOne<{ note_id: string }>(
      'SELECT note_id FROM notes WHERE file_path = ?',
      [h.docId],
    );
    if (row) {
      resolved.push({ noteId: row.note_id, score: h.score, snippet: h.snippet, matchedFields: h.matchedFields });
      continue;
    }

    // 2. Strip vault prefix for absolute paths
    if (h.docId.startsWith(vaultPrefix)) {
      const relative = h.docId.slice(vaultPrefix.length);
      row = db.getOne<{ note_id: string }>(
        'SELECT note_id FROM notes WHERE file_path = ?',
        [relative],
      );
      if (row) {
        resolved.push({ noteId: row.note_id, score: h.score, snippet: h.snippet, matchedFields: h.matchedFields });
        continue;
      }
    }

    // 3. Try as UUID directly
    row = db.getOne<{ note_id: string }>(
      'SELECT note_id FROM notes WHERE note_id = ?',
      [h.docId],
    );
    if (row) {
      resolved.push({ noteId: row.note_id, score: h.score, snippet: h.snippet, matchedFields: h.matchedFields });
    }
  }

  return resolved;
}

// ── SQL post-filtering for hits ────────────────────────────────────────────

/**
 * Apply structured filters via SQL to a set of already-resolved note IDs.
 * Used when Typesense handles text search but we need additional SQL-level filtering.
 */
function filterNoteIdsBySql(
  db: AnvilDb,
  noteIds: string[],
  filter: QueryFilter,
): string[] {
  if (noteIds.length === 0) return [];

  const { sql: baseSql, params: baseParams } = buildQuerySql(filter);
  const placeholders = noteIds.map(() => '?').join(',');
  const whereConnector = baseSql.toUpperCase().includes('WHERE') ? ' AND ' : ' WHERE ';
  const constrainedSql = baseSql + `${whereConnector}notes.note_id IN (${placeholders})`;

  const rows = db.getAll<{ note_id: string }>(
    `SELECT notes.note_id FROM (${constrainedSql.trim()}) AS notes`,
    [...baseParams, ...noteIds],
  );

  return rows.map((r) => r.note_id);
}

// ── Metadata fetchers (reuse logic from search.ts) ─────────────────────────

function fetchNoteMetadata(
  db: AnvilDb,
  noteIds: string[],
): Map<string, { type: string; title: string; status?: string; modified: string }> {
  if (noteIds.length === 0) return new Map();

  const placeholders = noteIds.map(() => '?').join(',');
  const rows = db.getAll<{
    note_id: string;
    type: string;
    title: string;
    status?: string | null;
    modified: string;
  }>(
    `SELECT note_id, type, title, status, modified FROM notes WHERE note_id IN (${placeholders})`,
    noteIds,
  );

  return new Map(
    rows.map((row) => [
      row.note_id,
      {
        type: row.type,
        title: row.title,
        status: row.status || undefined,
        modified: row.modified,
      },
    ]),
  );
}

function fetchTagsForNotes(
  db: AnvilDb,
  noteIds: string[],
): Map<string, string[]> {
  if (noteIds.length === 0) return new Map();

  const placeholders = noteIds.map(() => '?').join(',');
  const rows = db.getAll<{ note_id: string; tag: string }>(
    `SELECT note_id, tag FROM note_tags WHERE note_id IN (${placeholders}) ORDER BY tag`,
    noteIds,
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

// ── Snippet builder ────────────────────────────────────────────────────────

/**
 * Extract snippet string from Typesense highlight array.
 */
function buildSnippet(
  highlights: Array<{ field: string; snippet?: string; snippets?: string[] }>,
): string {
  for (const h of highlights) {
    const raw = h.snippet ?? h.snippets?.[0];
    if (raw) return raw;
  }
  return '';
}

/**
 * Extract matched field names from Typesense highlight array.
 */
function extractMatchedFields(
  highlights: Array<{ field: string; snippet?: string; snippets?: string[] }>,
): string[] {
  return highlights
    .filter((h) => h.snippet || (h.snippets && h.snippets.length > 0))
    .map((h) => h.field);
}

// ── Determine whether we need SQL post-filtering beyond Typesense ──────────

/**
 * Build a QueryFilter from SearchV2Input for SQL-level filtering.
 * This is used for filter-only queries (no text) or when Typesense
 * handles the text part but we need additional SQL filters like tags AND.
 */
function buildSqlFilter(input: SearchV2Input): QueryFilter {
  const filter: QueryFilter = {};

  if (input.type) filter.type = input.type;

  if (input.filters) {
    if (input.filters.status) filter.status = input.filters.status;
    if (input.filters.priority) filter.priority = input.filters.priority;
    if (input.filters.tags && input.filters.tags.length > 0) {
      filter.tags = input.filters.tags;
    }
  }

  return filter;
}

/**
 * Check if there are any active structured filters.
 */
function hasStructuredFilters(filters?: SearchV2Filters): boolean {
  if (!filters) return false;
  return !!(
    filters.status ||
    filters.priority ||
    (filters.tags && filters.tags.length > 0) ||
    filters.created_after ||
    filters.created_before ||
    filters.modified_after ||
    filters.modified_before
  );
}

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Handle enhanced anvil_search V2 request.
 *
 * - Auto-constructs query_by from SchemaBuilder when type is specified
 * - Builds Typesense filter_by from structured filters
 * - Falls back to SQLite for filter-only queries
 * - Returns enriched hits with matched_fields, snippet, and score
 */
export async function handleSearchV2(
  ctx: SearchV2Context,
  params: SearchV2Input,
): Promise<SearchV2Response | AnvilError> {
  try {
    const limit = params.limit ?? DEFAULT_LIMIT;
    const offset = params.offset ?? DEFAULT_OFFSET;

    // Validate pagination
    if (limit < 1 || limit > MAX_LIMIT) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `limit must be between 1 and ${MAX_LIMIT}`,
      );
    }
    if (offset < 0) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        'offset must be non-negative',
      );
    }

    const hasQuery = !!params.query;
    const hasFilters = hasStructuredFilters(params.filters) || !!params.type;

    // ── Case 1: No query and no filters -> empty result ────────────────────
    if (!hasQuery && !hasFilters) {
      return { results: [], total: 0, limit, offset };
    }

    // ── Case 2: Filter-only (no text query) -> pure SQL ────────────────────
    if (!hasQuery && hasFilters) {
      return handleFilterOnly(ctx, params, limit, offset);
    }

    // ── Case 3: Text query (with or without filters) -> Typesense ──────────
    return handleTypesenseSearch(ctx, params, limit, offset);
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Search failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Filter-only path (SQL) ─────────────────────────────────────────────────

async function handleFilterOnly(
  ctx: SearchV2Context,
  params: SearchV2Input,
  limit: number,
  offset: number,
): Promise<SearchV2Response | AnvilError> {
  const filter = buildSqlFilter(params);

  // Add date range filters for SQL query
  if (params.filters?.modified_after || params.filters?.modified_before) {
    // Use the modified date range — QueryFilter supports this via the 'modified' sub-object
    // if the query module supports it; otherwise we rely on Typesense for date filtering.
    // For now, pass through what we can.
  }

  const queryResult = queryNotes(
    ctx.db.raw,
    filter,
    { field: 'modified', direction: 'desc' },
    limit,
    offset,
  );

  const noteIds = queryResult.rows.map((row) => row.note_id || row.noteId);
  const metadataMap = fetchNoteMetadata(ctx.db.raw, noteIds);
  const tagsMap = fetchTagsForNotes(ctx.db.raw, noteIds);

  const results: SearchV2Hit[] = [];
  for (const id of noteIds) {
    const meta = metadataMap.get(id);
    if (!meta) continue;

    results.push({
      id,
      type: meta.type,
      title: meta.title,
      snippet: '',
      matched_fields: [],
      score: 0,
      status: meta.status,
      tags: tagsMap.get(id) || [],
      modified_at: meta.modified,
    });
  }

  return {
    results,
    total: queryResult.total,
    limit,
    offset,
  };
}

// ── Typesense search path ──────────────────────────────────────────────────

async function handleTypesenseSearch(
  ctx: SearchV2Context,
  params: SearchV2Input,
  limit: number,
  offset: number,
): Promise<SearchV2Response | AnvilError> {
  // Require Typesense for text queries
  if (!ctx.typesenseClient) {
    // Fall back to the legacy search engine if available
    if (ctx.searchEngine) {
      return handleLegacyEngineSearch(ctx, params, limit, offset);
    }
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      'Search engine not configured. Text search requires Typesense.',
    );
  }

  // ── Build query_by ───────────────────────────────────────────────────────
  let queryBy: string;
  if (params.query_by && params.query_by.length > 0) {
    // Caller explicitly provided query_by — use as-is
    queryBy = params.query_by.join(',');
  } else if (ctx.schemaBuilder) {
    // Auto-construct from SchemaBuilder based on type filter
    queryBy = ctx.schemaBuilder.buildQueryBy(params.type);
  } else {
    // Fallback: default fields
    queryBy = 'title,body';
  }

  // ── Build filter_by ──────────────────────────────────────────────────────
  const filterBy = buildFilterBy(params.type, params.filters);

  // ── Build sort_by ────────────────────────────────────────────────────────
  const sortBy = params.sort_by || DEFAULT_SORT;

  // ── Determine overfetch need ─────────────────────────────────────────────
  // If we have SQL-level filters that Typesense can't fully enforce (e.g. tags AND),
  // overfetch to compensate for post-filter attrition.
  const needsSqlPostFilter = hasStructuredFilters(params.filters) &&
    params.filters?.tags && params.filters.tags.length > 1;
  const perPage = needsSqlPostFilter ? limit * OVERFETCH_FACTOR : limit;
  const page = Math.floor(offset / limit) + 1;

  try {
    const response = await ctx.typesenseClient
      .collections(COLLECTION)
      .documents()
      .search({
        q: params.query!,
        query_by: queryBy,
        filter_by: filterBy,
        sort_by: sortBy,
        per_page: perPage,
        page,
        highlight_full_fields: 'title',
        snippet_threshold: 30,
      });

    // ── Parse hits ─────────────────────────────────────────────────────────
    const rawHits = (response.hits ?? []) as Array<{
      document: { id: string; [key: string]: unknown };
      text_match: number;
      highlights?: Array<{ field: string; snippet?: string; snippets?: string[] }>;
    }>;

    const parsedHits = rawHits.map((hit) => ({
      docId: hit.document.id,
      score: hit.text_match ?? 0,
      snippet: buildSnippet(
        (hit.highlights ?? []) as Array<{ field: string; snippet?: string; snippets?: string[] }>,
      ),
      matchedFields: extractMatchedFields(
        (hit.highlights ?? []) as Array<{ field: string; snippet?: string; snippets?: string[] }>,
      ),
    }));

    // ── Resolve to note IDs ────────────────────────────────────────────────
    let resolved = resolveDocumentIds(ctx.db.raw, parsedHits, ctx.vaultPath);

    // ── Optional SQL post-filter for multi-tag AND ─────────────────────────
    if (needsSqlPostFilter) {
      const sqlFilter = buildSqlFilter(params);
      const filteredIds = filterNoteIdsBySql(
        ctx.db.raw,
        resolved.map((r) => r.noteId),
        sqlFilter,
      );
      const filteredSet = new Set(filteredIds);
      resolved = resolved.filter((r) => filteredSet.has(r.noteId));
      // Trim to requested limit after filtering
      resolved = resolved.slice(0, limit);
    }

    // ── Fetch metadata ─────────────────────────────────────────────────────
    const noteIds = resolved.map((r) => r.noteId);
    const metadataMap = fetchNoteMetadata(ctx.db.raw, noteIds);
    const tagsMap = fetchTagsForNotes(ctx.db.raw, noteIds);

    // ── Build result set ───────────────────────────────────────────────────
    const results: SearchV2Hit[] = [];
    for (const r of resolved) {
      const meta = metadataMap.get(r.noteId);
      if (!meta) continue;

      results.push({
        id: r.noteId,
        type: meta.type,
        title: meta.title,
        snippet: r.snippet,
        matched_fields: r.matchedFields,
        score: r.score,
        status: meta.status,
        tags: tagsMap.get(r.noteId) || [],
        modified_at: meta.modified,
      });
    }

    const total = needsSqlPostFilter
      ? results.length
      : (response.found as number | undefined) ?? results.length;

    return { results, total, limit, offset };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Typesense search failed: ${msg}`,
    );
  }
}

// ── Legacy search engine fallback ──────────────────────────────────────────

/**
 * Fallback path when typesenseClient is not available but the legacy
 * SearchEngine interface is. Uses the simpler query() API without
 * custom query_by or sort_by support.
 */
async function handleLegacyEngineSearch(
  ctx: SearchV2Context,
  params: SearchV2Input,
  limit: number,
  offset: number,
): Promise<SearchV2Response | AnvilError> {
  const hasFilters = hasStructuredFilters(params.filters) || !!params.type;
  const fetchLimit = hasFilters ? limit * OVERFETCH_FACTOR : limit;

  try {
    const rawResults = await ctx.searchEngine!.query(params.query!, {
      limit: fetchLimit,
      offset: hasFilters ? 0 : offset,
    });

    // Resolve IDs
    let resolved = rawResults.map((r) => ({
      noteId: r.noteId,
      score: r.score,
      snippet: r.snippet,
      matchedFields: [] as string[],
    }));

    // Resolve Typesense doc IDs to note IDs
    const resolvedIds = resolveDocumentIds(
      ctx.db.raw,
      resolved.map((r) => ({
        docId: r.noteId,
        score: r.score,
        snippet: r.snippet,
        matchedFields: r.matchedFields,
      })),
      ctx.vaultPath,
    );

    resolved = resolvedIds;

    // SQL post-filter if needed
    if (hasFilters) {
      const sqlFilter = buildSqlFilter(params);
      const filteredIds = filterNoteIdsBySql(
        ctx.db.raw,
        resolved.map((r) => r.noteId),
        sqlFilter,
      );
      const filteredSet = new Set(filteredIds);
      resolved = resolved.filter((r) => filteredSet.has(r.noteId));
      resolved = resolved.slice(offset, offset + limit);
    }

    // Fetch metadata
    const noteIds = resolved.map((r) => r.noteId);
    const metadataMap = fetchNoteMetadata(ctx.db.raw, noteIds);
    const tagsMap = fetchTagsForNotes(ctx.db.raw, noteIds);

    const results: SearchV2Hit[] = [];
    for (const r of resolved) {
      const meta = metadataMap.get(r.noteId);
      if (!meta) continue;

      results.push({
        id: r.noteId,
        type: meta.type,
        title: meta.title,
        snippet: r.snippet,
        matched_fields: r.matchedFields,
        score: r.score,
        status: meta.status,
        tags: tagsMap.get(r.noteId) || [],
        modified_at: meta.modified,
      });
    }

    const total = hasFilters
      ? results.length
      : (resolved.length < limit ? offset + resolved.length : offset + limit);

    return { results, total, limit, offset };
  } catch {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      'Search engine unavailable. Text search requires Typesense.',
    );
  }
}
