// Typesense-backed search engine for Anvil

import type { TypesenseClient } from '@horus/search';
import type { SearchEngine, SearchOptions, SearchResult } from './engine.js';

const COLLECTION = 'horus_documents';

/**
 * Build a snippet string from Typesense highlights.
 * Joins the first highlight field's snippet with <b> tags around matched parts.
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
 * Typesense-backed implementation of the SearchEngine interface.
 * Queries the shared `horus_documents` collection filtered to source=anvil.
 */
export class TypesenseSearchEngine implements SearchEngine {
  constructor(private client: TypesenseClient) {}

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;

    const result = await this.client
      .collections(COLLECTION)
      .documents()
      .search({
        q: query,
        query_by: 'title,body',
        filter_by: 'source:=anvil',
        per_page: limit,
        page: Math.floor(offset / limit) + 1,
        highlight_full_fields: 'title',
        snippet_threshold: 30,
      });

    return (result.hits ?? []).map((hit: any) => ({
      noteId: (hit.document as { id: string }).id,
      score: hit.text_match ?? 0,
      snippet: buildSnippet(
        (hit.highlights ?? []) as Array<{
          field: string;
          snippet?: string;
          snippets?: string[];
        }>,
      ),
    }));
  }

  async query(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    return this.search(query, opts);
  }
}
