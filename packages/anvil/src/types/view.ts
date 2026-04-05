// View rendering types — list, table, board (kanban)

import type { SortOrder, QueryFilter } from './query.js';

export type ViewType = 'list' | 'table' | 'board';

/** Item in a list or board view */
export type ListItem = {
  noteId: string;
  type: string;
  title: string;
  status?: string;
  priority?: string;
  due?: string;
  tags: string[];
  modified: string;
  /** Ranking score (present for Typesense search results) */
  score?: number;
  /** Text excerpt with match context (present for Typesense search results) */
  snippet?: string;
};

export type TableRow = {
  noteId: string;
  /** Column values keyed by field name */
  values: Record<string, unknown>;
};

export type BoardItem = {
  noteId: string;
  title: string;
  type: string;
  status?: string;
  priority?: string;
  due?: string;
  tags: string[];
  modified: string;
};

export type BoardColumn = {
  /** The enum value used as the group key */
  id: string;
  /** Human-readable column title */
  title: string;
  items: BoardItem[];
};

// --- View response shapes ---

export type ListView = {
  view: 'list';
  items: ListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type TableView = {
  view: 'table';
  columns: string[];
  rows: TableRow[];
  total: number;
  limit: number;
  offset: number;
};

export type BoardView = {
  view: 'board';
  groupBy: string;
  columns: BoardColumn[];
};

export type ViewData = ListView | TableView | BoardView;

/** Input for the anvil_query_view tool */
export type ViewRequest = {
  view: ViewType;
  filters?: QueryFilter;
  groupBy?: string;
  orderBy?: SortOrder;
  /** Column names for table view (auto-detected if omitted) */
  columns?: string[];
  limit?: number;
  offset?: number;
};

/** Single search result item */
export type SearchResult = {
  noteId: string;
  type: string;
  title: string;
  status?: string;
  priority?: string;
  due?: string;
  tags: string[];
  modified: string;
  score?: number | null;
  snippet?: string | null;
};

/** Response from anvil_search */
export type SearchResponse = {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
};
