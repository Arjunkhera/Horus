// View query and rendering engine

import type { AnvilDb } from '../../index/sqlite.js';
import type { QueryFilter, SortOrder } from '../../types/query.js';
import type { ListView, TableView, BoardView } from '../../types/view.js';
import { queryNotes } from '../../index/query.js';
import {
  renderList,
  renderTable,
  renderBoard,
  autoDetectColumns,
} from '../../views/renderer.js';

/**
 * ViewEngine orchestrates querying and rendering notes for views.
 * Handles filters, sorting, pagination, and multiple output formats.
 */
export class ViewEngine {
  constructor(private db: AnvilDb) {}

  /**
   * Query notes using filters and sorting
   */
  query(
    filter: QueryFilter,
    orderBy: SortOrder,
    limit: number,
    offset: number
  ): {
    rows: any[];
    total: number;
  } {
    return queryNotes(this.db, filter, orderBy, limit, offset);
  }

  /**
   * Render query results as a list (markdown with metadata)
   */
  renderList(
    rows: any[],
    total: number,
    limit: number,
    offset: number
  ): ListView {
    return renderList(this.db, rows, total, limit, offset);
  }

  /**
   * Render query results as a table with specific columns
   */
  renderTable(
    rows: any[],
    total: number,
    columns: string[],
    limit: number,
    offset: number
  ): TableView {
    return renderTable(this.db, rows, total, columns, limit, offset);
  }

  /**
   * Render query results as a board (kanban-style grouped view)
   */
  renderBoard(
    rows: any[],
    groupBy: string,
    enumValues?: string[]
  ): BoardView {
    return renderBoard(this.db, rows, groupBy, enumValues);
  }

  /**
   * Automatically detect relevant columns for a note type
   */
  autoDetectColumns(type?: string, registry?: any): string[] {
    return autoDetectColumns(type, registry);
  }
}
