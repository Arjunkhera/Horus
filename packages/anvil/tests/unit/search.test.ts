// Unit tests for the anvil_search tool

import { describe, it, expect, beforeEach } from 'vitest';
import { AnvilDatabase, type AnvilDb } from '../../src/index/sqlite.js';
import { handleSearch } from '../../src/tools/search.js';
import type { SearchInput } from '../../src/types/tools.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import { upsertNote } from '../../src/index/indexer.js';
import type { Note } from '../../src/types/index.js';

/**
 * Create test notes in the database.
 */
function createTestNotes(db: AnvilDb): void {
  // Create a test type
  db.run(`INSERT OR REPLACE INTO types (type_id, name, schema_json, updated_at) VALUES (?, ?, ?, ?)`,
    ['task', 'Task', '{}', new Date().toISOString()]);
  db.run(`INSERT OR REPLACE INTO types (type_id, name, schema_json, updated_at) VALUES (?, ?, ?, ?)`,
    ['note', 'Note', '{}', new Date().toISOString()]);

  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 604800000).toISOString().split('T')[0];

  // Note 1: Task with "implementation" keyword, status=active, priority=high
  const note1: Note = {
    noteId: 'note-001',
    type: 'task',
    title: 'Implement search feature',
    created: now,
    modified: now,
    tags: ['feature', 'backend'],
    related: [],
    status: 'active',
    priority: 'high',
    due: tomorrow,
    body: 'Implement full-text search with filters for the Anvil system. This implementation supports type, status, and tag filters.',
    fields: {},
    filePath: '/vault/tasks/implement-search.md',
  };

  // Note 2: Task with "testing" keyword, status=pending, priority=medium
  const note2: Note = {
    noteId: 'note-002',
    type: 'task',
    title: 'Write tests for search',
    created: now,
    modified: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    tags: ['testing', 'backend'],
    related: [],
    status: 'pending',
    priority: 'medium',
    due: nextWeek,
    body: 'Write comprehensive unit and integration tests for the search tool.',
    fields: {},
    filePath: '/vault/tasks/write-tests.md',
  };

  // Note 3: Note with "documentation" keyword, type=note, no tags
  const note3: Note = {
    noteId: 'note-003',
    type: 'note',
    title: 'Search documentation',
    created: now,
    modified: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
    tags: [],
    related: [],
    body: 'Documentation on how to use the search API and query syntax.',
    fields: {},
    filePath: '/vault/notes/search-docs.md',
  };

  // Note 4: Task with "implementation" keyword, both tags
  const note4: Note = {
    noteId: 'note-004',
    type: 'task',
    title: 'Optimize search performance',
    created: now,
    modified: now,
    tags: ['feature', 'backend'],
    related: [],
    status: 'active',
    priority: 'low',
    due: nextWeek,
    body: 'Optimize search implementation performance using database indexes and caching.',
    fields: {},
    filePath: '/vault/tasks/optimize-search.md',
  };

  // Upsert all notes
  upsertNote(db, note1);
  upsertNote(db, note2);
  upsertNote(db, note3);
  upsertNote(db, note4);
}

describe('anvil_search', () => {
  let anvilDb: AnvilDatabase;
  let ctx: ToolContext;

  beforeEach(async () => {
    anvilDb = AnvilDatabase.create(':memory:');
    createTestNotes(anvilDb.raw);

    // Create a minimal tool context
    const registry = new TypeRegistry();
    ctx = {
      vaultPath: '/vault',
      registry,
      db: anvilDb,
    };
  });

  it('returns error for text query when no search engine configured', async () => {
    const input: SearchInput = {
      query: 'implementation',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    // Without a search engine, text queries should return an error
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.code).toBe('SERVER_ERROR');
  });

  it('performs filter-only search by type', async () => {
    const input: SearchInput = {
      type: 'task',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should return all task notes
    expect(result.results.length).toBeGreaterThanOrEqual(3);
    expect(result.total).toBeGreaterThanOrEqual(3);

    // All results should be of type 'task'
    for (const searchResult of result.results) {
      expect(searchResult.type).toBe('task');
    }
  });

  it('returns error for combined query+filter when no search engine configured', async () => {
    const input: SearchInput = {
      query: 'implementation',
      type: 'task',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    // Without a search engine, text queries should return an error
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.code).toBe('SERVER_ERROR');
  });

  it('filters by status', async () => {
    const input: SearchInput = {
      status: 'active',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should find active status notes
    expect(result.results.length).toBeGreaterThan(0);

    // All results should have status 'active'
    for (const searchResult of result.results) {
      expect(searchResult.status).toBe('active');
    }
  });

  it('filters by priority', async () => {
    const input: SearchInput = {
      priority: 'high',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should find high priority notes
    expect(result.results.length).toBeGreaterThan(0);

    // All results should have priority 'high'
    for (const searchResult of result.results) {
      expect(searchResult.priority).toBe('high');
    }
  });

  it('enforces tag AND semantics', async () => {
    const input: SearchInput = {
      tags: ['feature', 'backend'],
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should find notes with BOTH 'feature' AND 'backend' tags
    expect(result.results.length).toBeGreaterThanOrEqual(2);

    // All results should have both tags
    for (const searchResult of result.results) {
      expect(searchResult.tags).toContain('feature');
      expect(searchResult.tags).toContain('backend');
    }
  });

  it('filters by single tag', async () => {
    const input: SearchInput = {
      tags: ['testing'],
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should find notes with 'testing' tag
    expect(result.results.length).toBeGreaterThan(0);

    // All results should have 'testing' tag
    for (const searchResult of result.results) {
      expect(searchResult.tags).toContain('testing');
    }
  });

  it('filters by due date range (gte)', async () => {
    // Tomorrow's date
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const input: SearchInput = {
      due: { gte: tomorrow },
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should find notes with due date >= tomorrow
    expect(result.results.length).toBeGreaterThan(0);

    // All results should have a due date >= tomorrow
    for (const searchResult of result.results) {
      if (searchResult.due) {
        expect(searchResult.due >= tomorrow).toBe(true);
      }
    }
  });

  it('filters by due date range (lte)', async () => {
    // Tomorrow's date
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const input: SearchInput = {
      due: { lte: tomorrow },
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should find notes with due date <= tomorrow
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('returns error for nonexistent search term when no search engine configured', async () => {
    const input: SearchInput = {
      query: 'xyzabc123notfound',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    // Without a search engine, text queries should return an error
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.code).toBe('SERVER_ERROR');
  });

  it('respects pagination limit', async () => {
    const input: SearchInput = {
      type: 'task',
      limit: 2,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // Should return max 2 results
    expect(result.results.length).toBeLessThanOrEqual(2);
    expect(result.limit).toBe(2);
  });

  it('respects pagination offset', async () => {
    // Get first page
    const input1: SearchInput = {
      type: 'task',
      limit: 2,
      offset: 0,
    };

    const result1 = await handleSearch(input1, ctx);
    expect('error' in result1).toBe(false);
    if ('error' in result1) return;

    // Get second page
    const input2: SearchInput = {
      type: 'task',
      limit: 2,
      offset: 2,
    };

    const result2 = await handleSearch(input2, ctx);
    expect('error' in result2).toBe(false);
    if ('error' in result2) return;

    // Results should be different if offset worked
    if (result1.results.length > 0 && result2.results.length > 0) {
      const ids1 = result1.results.map((r) => r.noteId);
      const ids2 = result2.results.map((r) => r.noteId);
      expect(ids1).not.toEqual(ids2);
    }

    expect(result2.offset).toBe(2);
  });

  it('rejects limit > 100', async () => {
    const input: SearchInput = {
      query: 'test',
      limit: 101,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;

    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects negative offset', async () => {
    const input: SearchInput = {
      query: 'test',
      limit: 10,
      offset: -1,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;

    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('returns empty response when no query and no filters', async () => {
    const input: SearchInput = {
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('populates all SearchResult fields correctly for filter-only query', async () => {
    const input: SearchInput = {
      type: 'task',
      status: 'active',
      limit: 10,
      offset: 0,
    };

    const result = await handleSearch(input, ctx);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    if (result.results.length === 0) {
      throw new Error('Expected at least one result');
    }

    const searchResult = result.results[0];

    // Check all required fields
    expect(searchResult.noteId).toBeDefined();
    expect(typeof searchResult.noteId).toBe('string');
    expect(searchResult.type).toBeDefined();
    expect(typeof searchResult.type).toBe('string');
    expect(searchResult.title).toBeDefined();
    expect(typeof searchResult.title).toBe('string');
    expect(Array.isArray(searchResult.tags)).toBe(true);
    expect(searchResult.modified).toBeDefined();
    expect(typeof searchResult.modified).toBe('string');

    // Optional fields should be present (even if null/undefined)
    expect('status' in searchResult).toBe(true);
    expect('priority' in searchResult).toBe(true);
    expect('due' in searchResult).toBe(true);
    expect('score' in searchResult).toBe(true);
    expect('snippet' in searchResult).toBe(true);
  });
});
