// Unit tests for the anvil_query_view tool

import { describe, it, expect, beforeEach } from 'vitest';
import { AnvilDatabase, type AnvilDb } from '../../src/index/sqlite.js';
import { handleQueryView } from '../../src/tools/query-view.js';
import type { QueryViewInput } from '../../src/types/tools.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import { upsertNote } from '../../src/index/indexer.js';
import type { Note } from '../../src/types/index.js';


/**
 * Create a mock TypeRegistry with test types
 */
function createMockRegistry(): TypeRegistry {
  const registry = new TypeRegistry();

  // Manually add types for testing (bypass YAML loading)
  (registry as any).definitions = new Map([
    [
      '_core',
      {
        id: '_core',
        name: 'Core',
        fields: {
          title: { type: 'string', required: true },
          tags: { type: 'tags' },
          status: { type: 'enum', values: ['open', 'in-progress', 'done'] },
        },
      },
    ],
    [
      'task',
      {
        id: 'task',
        name: 'Task',
        extends: '_core',
        fields: {
          priority: { type: 'enum', values: ['low', 'medium', 'high'] },
          due: { type: 'date' },
          status: { type: 'enum', values: ['open', 'in-progress', 'done', 'blocked'] },
        },
      },
    ],
  ]);

  // Resolve types
  (registry as any).types = new Map([
    [
      '_core',
      {
        id: '_core',
        name: 'Core',
        fields: {
          title: { type: 'string', required: true },
          tags: { type: 'tags' },
          status: { type: 'enum', values: ['open', 'in-progress', 'done'] },
        },
        behaviors: {},
        ownFields: {
          title: { type: 'string', required: true },
          tags: { type: 'tags' },
          status: { type: 'enum', values: ['open', 'in-progress', 'done'] },
        },
      },
    ],
    [
      'task',
      {
        id: 'task',
        name: 'Task',
        extends: '_core',
        fields: {
          title: { type: 'string', required: true },
          tags: { type: 'tags' },
          status: { type: 'enum', values: ['open', 'in-progress', 'done', 'blocked'] },
          priority: { type: 'enum', values: ['low', 'medium', 'high'] },
          due: { type: 'date' },
        },
        behaviors: {},
        ownFields: {
          priority: { type: 'enum', values: ['low', 'medium', 'high'] },
          due: { type: 'date' },
          status: { type: 'enum', values: ['open', 'in-progress', 'done', 'blocked'] },
        },
      },
    ],
  ]);

  return registry;
}

describe('Query View Tool', () => {
  let db: AnvilDb;
  let anvilDb: AnvilDatabase;
  let registry: TypeRegistry;
  let ctx: ToolContext;

  beforeEach(async () => {
    anvilDb = AnvilDatabase.create(':memory:');
    db = anvilDb.raw;
    registry = createMockRegistry();

    ctx = {
      vaultPath: '/test/vault',
      registry,
      db: anvilDb,
    };
  });

  it('should render list view with pagination', async () => {
    // Create test notes
    const note1: Note = {
      noteId: 'note-1',
      type: 'task',
      title: 'Buy groceries',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-02T00:00:00Z',
      tags: ['shopping', 'home'],
      related: [],
      fields: { priority: 'high' },
      body: 'Get milk and eggs',
      filePath: '/test/task-1.md',
      status: 'open',
    };

    const note2: Note = {
      noteId: 'note-2',
      type: 'task',
      title: 'Write report',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-03T00:00:00Z',
      tags: ['work'],
      related: [],
      fields: { priority: 'medium' },
      body: 'Complete Q1 report',
      filePath: '/test/task-2.md',
      status: 'in-progress',
    };

    upsertNote(db, note1);
    upsertNote(db, note2);
    // Tags are already inserted by upsertNote via note.tags field

    const input: QueryViewInput = {
      view: 'list',
      limit: 10,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('error');
    expect(result.view).toBe('list');
    expect((result as any).items).toHaveLength(2);
    expect((result as any).total).toBe(2);
    expect((result as any).limit).toBe(10);
    expect((result as any).offset).toBe(0);

    const items = (result as any).items;
    expect(items[0].noteId).toBe('note-2'); // Most recently modified first
    expect(items[0].title).toBe('Write report');
    expect(items[0].tags).toContain('work');
    expect(items[1].noteId).toBe('note-1');
    expect(items[1].tags).toEqual(['home', 'shopping']);
  });

  it('should render table view with auto-detected columns', async () => {
    const note: Note = {
      noteId: 'note-1',
      type: 'task',
      title: 'Buy milk',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-02T00:00:00Z',
      tags: ['shopping'],
      related: [],
      fields: { priority: 'high' },
      body: 'Whole milk',
      filePath: '/test/task-1.md',
      status: 'open',
    };

    upsertNote(db, note);

    const input: QueryViewInput = {
      view: 'table',
      filters: { type: 'task' },
      limit: 10,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('error');
    expect(result.view).toBe('table');
    expect((result as any).columns).toBeDefined();
    expect((result as any).columns).toContain('title');
    expect((result as any).columns).toContain('tags');
    expect((result as any).rows).toHaveLength(1);

    const row = (result as any).rows[0];
    expect(row.noteId).toBe('note-1');
    expect(row.values.title).toBe('Buy milk');
    expect(row.values.tags).toContain('shopping');
  });

  it('should render table view with custom columns', async () => {
    const note: Note = {
      noteId: 'note-1',
      type: 'task',
      title: 'Task 1',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-02T00:00:00Z',
      tags: ['urgent'],
      related: [],
      fields: {},
      body: 'Body text',
      filePath: '/test/task-1.md',
      status: 'open',
      priority: 'high',
    };

    upsertNote(db, note);

    const input: QueryViewInput = {
      view: 'table',
      columns: ['title', 'status', 'priority'],
      limit: 10,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('error');
    expect((result as any).columns).toEqual(['title', 'status', 'priority']);

    const row = (result as any).rows[0];
    expect(Object.keys(row.values)).toContain('title');
    expect(Object.keys(row.values)).toContain('status');
    expect(Object.keys(row.values)).toContain('priority');
    expect(row.values.title).toBe('Task 1');
    expect(row.values.status).toBe('open');
    expect(row.values.priority).toBe('high');
  });

  it('should render board view grouped by status', async () => {
    const notes = [
      {
        noteId: 'task-1',
        type: 'task',
        title: 'Open task',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
        tags: [],
        related: [],
        fields: {},
        body: 'Task 1',
        filePath: '/test/task-1.md',
        status: 'open',
      },
      {
        noteId: 'task-2',
        type: 'task',
        title: 'In progress task',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-03T00:00:00Z',
        tags: [],
        related: [],
        fields: {},
        body: 'Task 2',
        filePath: '/test/task-2.md',
        status: 'in-progress',
      },
      {
        noteId: 'task-3',
        type: 'task',
        title: 'Done task',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-04T00:00:00Z',
        tags: [],
        related: [],
        fields: {},
        body: 'Task 3',
        filePath: '/test/task-3.md',
        status: 'done',
      },
    ];

    for (const note of notes) {
      upsertNote(db, note as Note);
    }

    const input: QueryViewInput = {
      view: 'board',
      groupBy: 'status',
      filters: { type: 'task' },
      limit: 50,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('error');
    expect(result.view).toBe('board');
    expect((result as any).groupBy).toBe('status');
    // Task type has 4 status enum values (open, in-progress, done, blocked)
    expect((result as any).columns).toHaveLength(4);

    const columns = (result as any).columns;
    const columnIds = columns.map((c: any) => c.id);
    expect(columnIds).toContain('open');
    expect(columnIds).toContain('in-progress');
    expect(columnIds).toContain('done');
    expect(columnIds).toContain('blocked');

    const openColumn = columns.find((c: any) => c.id === 'open');
    expect(openColumn.items).toHaveLength(1);
    expect(openColumn.items[0].title).toBe('Open task');

    const doneColumn = columns.find((c: any) => c.id === 'done');
    expect(doneColumn.items).toHaveLength(1);
    expect(doneColumn.items[0].title).toBe('Done task');
  });

  it('should show all enum columns in board view even if empty', async () => {
    const note: Note = {
      noteId: 'task-1',
      type: 'task',
      title: 'Only open task',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-02T00:00:00Z',
      tags: [],
      related: [],
      fields: {},
      body: 'Task',
      filePath: '/test/task-1.md',
      status: 'open',
    };

    upsertNote(db, note);

    const input: QueryViewInput = {
      view: 'board',
      groupBy: 'status',
      filters: { type: 'task' },
      limit: 50,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('error');

    const columns = (result as any).columns;
    // Should have all enum values: open, in-progress, done, blocked
    expect(columns).toHaveLength(4);

    const columnIds = columns.map((c: any) => c.id).sort();
    expect(columnIds).toEqual(['blocked', 'done', 'in-progress', 'open']);

    // Blocked and done columns should be empty
    const blockedColumn = columns.find((c: any) => c.id === 'blocked');
    expect(blockedColumn.items).toHaveLength(0);

    const doneColumn = columns.find((c: any) => c.id === 'done');
    expect(doneColumn.items).toHaveLength(0);
  });

  it('should validate board view requires groupBy', async () => {
    const input: QueryViewInput = {
      view: 'board',
      // Missing groupBy
      limit: 50,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toHaveProperty('error', true);
    expect((result as any).code).toBe('VALIDATION_ERROR');
  });

  it('should support pagination', async () => {
    const notes = Array.from({ length: 100 }, (_, i) => ({
      noteId: `task-${i}`,
      type: 'task',
      title: `Task ${i}`,
      created: '2024-01-01T00:00:00Z',
      modified: new Date(2024, 0, 1 + (i % 30)).toISOString(),
      tags: [],
      related: [],
      fields: {},
      body: `Task ${i}`,
      filePath: `/test/task-${i}.md`,
      status: 'open',
    }));

    for (const note of notes) {
      upsertNote(db, note as Note);
    }

    // First page
    let input: QueryViewInput = {
      view: 'list',
      limit: 20,
      offset: 0,
    };

    let result = await handleQueryView(input, ctx);
    expect((result as any).items).toHaveLength(20);
    expect((result as any).total).toBe(100);
    expect((result as any).offset).toBe(0);

    // Second page
    input = {
      view: 'list',
      limit: 20,
      offset: 20,
    };

    result = await handleQueryView(input, ctx);
    expect((result as any).items).toHaveLength(20);
    expect((result as any).offset).toBe(20);
  });

  it('should filter by type', async () => {
    const taskNote: Note = {
      noteId: 'task-1',
      type: 'task',
      title: 'A task',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-02T00:00:00Z',
      tags: [],
      related: [],
      fields: {},
      body: 'Task body',
      filePath: '/test/task-1.md',
      status: 'open',
    };

    const noteNote: Note = {
      noteId: 'note-1',
      type: 'note',
      title: 'A note',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-02T00:00:00Z',
      tags: [],
      related: [],
      fields: {},
      body: 'Note body',
      filePath: '/test/note-1.md',
    };

    upsertNote(db, taskNote);
    upsertNote(db, noteNote);

    const input: QueryViewInput = {
      view: 'list',
      filters: { type: 'task' },
      limit: 50,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect((result as any).items).toHaveLength(1);
    expect((result as any).items[0].noteId).toBe('task-1');
    expect((result as any).items[0].type).toBe('task');
  });

  it('should handle invalid orderBy field', async () => {
    const input: QueryViewInput = {
      view: 'list',
      orderBy: { field: 'nonexistent_field', direction: 'asc' },
      limit: 50,
      offset: 0,
    };

    const result = await handleQueryView(input, ctx);

    expect(result).toHaveProperty('error', true);
    expect((result as any).code).toBe('VALIDATION_ERROR');
  });
});
