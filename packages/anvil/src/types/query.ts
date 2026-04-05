// Query filter and pagination types

/** Date range filter (ISO date strings) */
export type DateRange = {
  gte?: string; // greater-than-or-equal
  lte?: string; // less-than-or-equal
};

/** Status filter — either exact match or negation */
export type StatusFilter =
  | string
  | {
      not?: string;
    };

/** Scope-based filter */
export type ScopeFilter = {
  context?: 'personal' | 'work';
  team?: string;
  service?: string;
};

/**
 * Structured query filter used by search and query-view tools.
 * All fields are optional and composable via AND semantics.
 */
export type QueryFilter = {
  /** Free-text query (passed to search engine) */
  query?: string;
  type?: string;
  status?: StatusFilter;
  priority?: string;
  /** Notes must have ALL specified tags (AND semantics) */
  tags?: string[];
  due?: DateRange;
  created?: DateRange;
  modified?: DateRange;
  scope?: ScopeFilter;
  assignee?: string;
  project?: string;
  archived?: boolean;
};

export type SortDirection = 'asc' | 'desc';

export type SortOrder = {
  field: string;
  direction: SortDirection;
};

export type Pagination = {
  limit?: number;
  offset?: number;
};

/**
 * Output from the filter builder — parsed natural language into structured filter.
 */
export type ParsedQuery = {
  originalQuery: string;
  parsedFilter: QueryFilter;
  /** Remaining free text not matched by any pattern */
  freeText: string | null;
};
