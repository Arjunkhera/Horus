// Search engine interface and types for the core library

import type { AnvilDb } from '../storage/sqlite.js';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  path?: string;
}

export interface SearchResult {
  noteId: string;
  score: number;
  snippet: string;
}

/**
 * Interface for search engines that can be plugged into Anvil.
 * Implementations can use FTS5, semantic search, or other strategies.
 */
export interface SearchEngine {
  /**
   * Search for notes matching a query string.
   * Returns ranked results with snippets.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Query notes with expanded search logic.
   * May differ from search() in implementations.
   */
  query(query: string, opts?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Find similar notes to a given query.
   * Optional method for semantic search engines.
   */
  similar?(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
