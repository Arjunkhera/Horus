// Handler for horus_search tool — unified cross-system search via Typesense

import type { HorusSearchInput } from '../types/tools.js';
import type { ToolContext } from './create-note.js';
import type { AnvilError } from '../types/error.js';
import { makeError, ERROR_CODES } from '../types/error.js';

const COLLECTION_NAME = 'horus_documents';

export interface HorusSearchResult {
  id: string;
  source: string;
  source_type: string;
  title: string;
  status?: string;
  priority?: string;
  tags: string[];
  score: number;
  snippet?: string;
}

export interface HorusSearchResponse {
  results: HorusSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

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
 * Handle horus_search request.
 * Queries the shared horus_documents Typesense collection across all Horus systems.
 * Optionally scopes to a single source (anvil, vault, forge).
 */
export async function handleHorusSearch(
  input: HorusSearchInput,
  ctx: ToolContext
): Promise<HorusSearchResponse | AnvilError> {
  if (!ctx.typesenseClient) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      'Typesense not available — horus_search requires a running Typesense instance'
    );
  }

  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;

  try {
    const response = await ctx.typesenseClient
      .collections(COLLECTION_NAME)
      .documents()
      .search({
        q: input.query,
        query_by: 'title,body',
        ...(input.source ? { filter_by: `source:=${input.source}` } : {}),
        per_page: limit,
        page,
        highlight_full_fields: 'title',
        snippet_threshold: 30,
      });

    const hits = (response.hits ?? []) as Array<{
      document: Record<string, unknown>;
      text_match: number;
      highlights?: Array<{ field: string; snippet?: string; snippets?: string[] }>;
    }>;

    const results: HorusSearchResult[] = hits.map((hit) => {
      const doc = hit.document;
      return {
        id: String(doc['id'] ?? ''),
        source: String(doc['source'] ?? ''),
        source_type: String(doc['source_type'] ?? ''),
        title: String(doc['title'] ?? ''),
        status: doc['status'] != null ? String(doc['status']) : undefined,
        priority: doc['priority'] != null ? String(doc['priority']) : undefined,
        tags: Array.isArray(doc['tags']) ? (doc['tags'] as string[]) : [],
        score: hit.text_match,
        snippet: buildSnippet(hit.highlights ?? []),
      };
    });

    const total = (response.found as number | undefined) ?? results.length;

    return { results, total, limit, offset };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `horus_search failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
