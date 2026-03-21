// FTS-based search engine implementation

import type { AnvilDb } from '../../index/sqlite.js';
import type { SearchEngine, SearchOptions, SearchResult } from './engine.js';

/**
 * Sanitize FTS5 query string.
 * - Strips dangerous FTS5 operators (parentheses, quotes, colons)
 * - Splits multi-word queries into individual terms joined by OR
 *   so "anvil issues" matches notes containing either word (ranked by BM25)
 * - Single words are passed through as-is for prefix or exact match
 * - Empty/whitespace-only queries become '*' (match all)
 */
function sanitizeFtsQuery(query: string): string {
  // Strip FTS5 operators but preserve * for prefix matching
  const cleaned = query.replace(/[()":]/g, '').trim();

  if (!cleaned) return '*';

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '*';

  // Single word — return as-is (supports prefix matching like "anv*")
  if (words.length === 1) return words[0];

  // Multiple words — join with OR for broader matching.
  // BM25 ranking will still prefer notes that match more terms.
  return words.join(' OR ');
}

/**
 * FTS5-based search engine using BM25 ranking.
 * Provides fast full-text search with snippet extraction.
 */
export class FtsSearchEngine implements SearchEngine {
  constructor(private db: AnvilDb) {}

  /**
   * Search using FTS5 with BM25 ranking
   * Returns ranked results with snippets
   */
  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const sanitized = sanitizeFtsQuery(query);
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const rows = this.db.getAll<{
      noteId: string;
      score: number;
      snippet: string;
    }>(
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

    return rows || [];
  }

  /**
   * Query with same semantics as search for FTS
   */
  async query(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    return this.search(query, opts);
  }
}
