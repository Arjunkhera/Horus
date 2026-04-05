import { describe, it, expect, beforeEach } from 'vitest';
import { AnvilDatabase, type AnvilDb } from '../../src/index/sqlite.js';
import {
  upsertNote,
  deleteNote,
  fullRebuild,
  getNote,
  getForwardRelationships,
  getReverseRelationships,
  getAllNotePaths,
} from '../../src/index/indexer.js';
import { queryNotes } from '../../src/index/query.js';
import type { Note } from '../../src/types/index.js';

describe('Indexer and Search', () => {
  let db: AnvilDb;

  beforeEach(async () => {
    const anvil = AnvilDatabase.create(':memory:');
    db = anvil.raw;
  });

  describe('upsertNote', () => {
    it('should insert note into notes table', () => {
      const note: Note = {
        noteId: 'note-1',
        type: 'task',
        title: 'My First Task',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: ['urgent'],
        related: [],
        status: 'open',
        priority: 'high',
        body: 'Task description',
        filePath: '/vault/note-1.md',
        fields: {},
      };

      upsertNote(db, note);

      const row = db.getOne<any>('SELECT * FROM notes WHERE note_id = ?', ['note-1']);

      expect(row).toBeDefined();
      expect(row.title).toBe('My First Task');
      expect(row.type).toBe('task');
      expect(row.status).toBe('open');
      expect(row.priority).toBe('high');
    });

    it('should insert tags into note_tags table', () => {
      const note: Note = {
        noteId: 'note-2',
        type: 'note',
        title: 'Note with Tags',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: ['work', 'meeting', 'important'],
        related: [],
        body: 'Some content',
        filePath: '/vault/note-2.md',
        fields: {},
      };

      upsertNote(db, note);

      const rows = db.getAll<{ tag: string }>(
        'SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag',
        ['note-2']
      );

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.tag)).toEqual(['important', 'meeting', 'work']);
    });

    it('should extract body wiki-links as mentions relationships', () => {
      const note: Note = {
        noteId: 'note-3',
        type: 'note',
        title: 'Note with Links',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: [],
        body: 'This mentions [[Related Note]] and [[Another Note]].',
        filePath: '/vault/note-3.md',
        fields: {},
      };

      upsertNote(db, note);

      const rows = db.getAll<{ target_title: string; relation_type: string }>(
        'SELECT target_title, relation_type FROM relationships WHERE source_id = ? ORDER BY target_title',
        ['note-3']
      );

      expect(rows).toHaveLength(2);
      expect(rows[0].relation_type).toBe('mentions');
      expect(rows[1].relation_type).toBe('mentions');
    });

    it('should deduplicate tags and relationships', () => {
      const note: Note = {
        noteId: 'note-4',
        type: 'note',
        title: 'Duplicate Test',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: ['tag1', 'tag1', 'tag1'],
        related: ['[[Link]]'],
        body: '[[Link]] appears again here [[Link]].',
        filePath: '/vault/note-4.md',
        fields: {},
      };

      upsertNote(db, note);

      const tagCount = db.getOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM note_tags WHERE note_id = ?',
        ['note-4']
      )!.count;
      expect(tagCount).toBe(1); // Only one unique tag

      const relCount = db.getOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM relationships WHERE source_id = ? AND target_title = ? AND relation_type = ?',
        ['note-4', 'Link', 'mentions']
      )!.count;
      expect(relCount).toBe(1); // Only one unique relationship
    });

    it('should resolve forward references when target note is created', () => {
      // Create note A linking to "Future Note"
      const noteA: Note = {
        noteId: 'note-a',
        type: 'note',
        title: 'Note A',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: ['[[Future Note]]'],
        body: '',
        filePath: '/vault/note-a.md',
        fields: {},
      };

      upsertNote(db, noteA);

      // Check that target_id is NULL (forward reference)
      let rel = db.getOne<any>(
        'SELECT target_id FROM relationships WHERE source_id = ? AND target_title = ?',
        ['note-a', 'Future Note']
      );
      expect(rel.target_id).toBeNull();

      // Create "Future Note"
      const futureNote: Note = {
        noteId: 'future-note',
        type: 'note',
        title: 'Future Note',
        created: '2024-01-02T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
        tags: [],
        related: [],
        body: '',
        filePath: '/vault/future-note.md',
        fields: {},
      };

      upsertNote(db, futureNote);

      // Check that target_id is now resolved
      rel = db.getOne<any>(
        'SELECT target_id FROM relationships WHERE source_id = ? AND target_title = ?',
        ['note-a', 'Future Note']
      );
      expect(rel.target_id).toBe('future-note');
    });

  });

  describe('deleteNote', () => {
    it('should remove note and cascade delete tags and relationships', () => {
      const note: Note = {
        noteId: 'note-to-delete',
        type: 'note',
        title: 'To Delete',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: ['delete-me'],
        related: [],
        body: 'Content',
        filePath: '/vault/delete.md',
        fields: {},
      };

      upsertNote(db, note);

      // Verify note exists
      let count = db.getOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM notes WHERE note_id = ?',
        ['note-to-delete']
      )!.count;
      expect(count).toBe(1);

      deleteNote(db, 'note-to-delete');

      // Verify note is deleted
      count = db.getOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM notes WHERE note_id = ?',
        ['note-to-delete']
      )!.count;
      expect(count).toBe(0);

      // Verify tags are deleted (cascade)
      count = db.getOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM note_tags WHERE note_id = ?',
        ['note-to-delete']
      )!.count;
      expect(count).toBe(0);
    });

    it('should preserve forward references by setting target_id to NULL', () => {
      const target: Note = {
        noteId: 'target-note',
        type: 'note',
        title: 'Target',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: [],
        body: '',
        filePath: '/vault/target.md',
        fields: {},
      };

      const source: Note = {
        noteId: 'source-note',
        type: 'note',
        title: 'Source',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: ['[[Target]]'],
        body: '',
        filePath: '/vault/source.md',
        fields: {},
      };

      upsertNote(db, target);
      upsertNote(db, source);

      // Verify relationship is resolved
      let rel = db.getOne<any>(
        'SELECT target_id FROM relationships WHERE source_id = ? AND target_title = ?',
        ['source-note', 'Target']
      );
      expect(rel.target_id).toBe('target-note');

      // Delete target
      deleteNote(db, 'target-note');

      // Verify relationship is now a forward reference
      rel = db.getOne<any>(
        'SELECT target_id FROM relationships WHERE source_id = ? AND target_title = ?',
        ['source-note', 'Target']
      );
      expect(rel.target_id).toBeNull();
    });
  });

  describe('fullRebuild', () => {
    it('should rebuild all notes in a single transaction', () => {
      const notes: Note[] = [
        {
          noteId: 'rebuild-1',
          type: 'note',
          title: 'First',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
          tags: ['rebuild'],
          related: [],
          body: 'Content 1',
          filePath: '/vault/1.md',
          fields: {},
        },
        {
          noteId: 'rebuild-2',
          type: 'note',
          title: 'Second',
          created: '2024-01-02T00:00:00Z',
          modified: '2024-01-02T00:00:00Z',
          tags: ['rebuild'],
          related: [],
          body: 'Content 2',
          filePath: '/vault/2.md',
          fields: {},
        },
      ];

      fullRebuild(db, notes);

      const count = db.getOne<{ count: number }>('SELECT COUNT(*) as count FROM notes')!.count;
      expect(count).toBe(2);

      const tagCount = db.getOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM note_tags WHERE tag = ?',
        ['rebuild']
      )!.count;
      expect(tagCount).toBe(2);
    });
  });

  describe('getNote', () => {
    it('should retrieve note metadata by ID', () => {
      const note: Note = {
        noteId: 'get-test',
        type: 'task',
        title: 'Get Test Note',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
        tags: ['tag1', 'tag2'],
        related: ['[[Other]]'],
        status: 'open',
        priority: 'high',
        body: 'Body text',
        filePath: '/vault/get-test.md',
        fields: {},
      };

      upsertNote(db, note);

      const metadata = getNote(db, 'get-test');

      expect(metadata).toBeDefined();
      expect(metadata?.title).toBe('Get Test Note');
      expect(metadata?.type).toBe('task');
      expect(metadata?.tags).toContain('tag1');
      expect(metadata?.tags).toContain('tag2');
      expect(metadata?.related).toContain('[[Other]]');
      expect(metadata?.status).toBe('open');
      expect(metadata?.priority).toBe('high');
    });
  });

  describe('getForwardRelationships', () => {
    it('should retrieve forward relationships for a note', () => {
      const note: Note = {
        noteId: 'forward-test',
        type: 'note',
        title: 'Forward Test',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: ['[[Linked Note]]'],
        body: 'Body with [[Another Link]]',
        filePath: '/vault/forward.md',
        fields: {},
      };

      upsertNote(db, note);

      const relationships = getForwardRelationships(db, 'forward-test');

      expect(relationships).toHaveLength(2);
      expect(relationships.some((r) => r.targetTitle === 'Linked Note')).toBe(true);
      expect(relationships.some((r) => r.targetTitle === 'Another Link')).toBe(true);
    });
  });

  describe('getReverseRelationships', () => {
    it('should retrieve reverse relationships for a note', () => {
      const target: Note = {
        noteId: 'target-id',
        type: 'note',
        title: 'Target Note',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: [],
        body: '',
        filePath: '/vault/target.md',
        fields: {},
      };

      const source: Note = {
        noteId: 'source-id',
        type: 'note',
        title: 'Source Note',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        tags: [],
        related: ['[[Target Note]]'],
        body: '',
        filePath: '/vault/source.md',
        fields: {},
      };

      upsertNote(db, target);
      upsertNote(db, source);

      const relationships = getReverseRelationships(db, 'target-id');

      expect(relationships).toHaveLength(1);
      expect(relationships[0].sourceId).toBe('source-id');
      expect(relationships[0].targetId).toBe('target-id');
    });
  });

  describe('getAllNotePaths', () => {
    it('should retrieve all note paths and metadata', () => {
      const notes: Note[] = [
        {
          noteId: 'paths-1',
          type: 'note',
          title: 'Path Test 1',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
          tags: [],
          related: [],
          body: '',
          filePath: '/vault/path1.md',
          fields: {},
        },
        {
          noteId: 'paths-2',
          type: 'note',
          title: 'Path Test 2',
          created: '2024-01-02T00:00:00Z',
          modified: '2024-01-02T00:00:00Z',
          tags: [],
          related: [],
          body: '',
          filePath: '/vault/path2.md',
          fields: {},
        },
      ];

      fullRebuild(db, notes);

      const paths = getAllNotePaths(db);

      expect(paths).toHaveLength(2);
      expect(paths.some((p) => p.filePath === '/vault/path1.md')).toBe(true);
      expect(paths.some((p) => p.filePath === '/vault/path2.md')).toBe(true);
    });
  });

  describe('queryNotes', () => {
    beforeEach(() => {
      const notes: Note[] = [
        {
          noteId: 'task-1',
          type: 'task',
          title: 'Task 1',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
          tags: ['work', 'urgent'],
          related: [],
          status: 'open',
          priority: 'high',
          body: '',
          filePath: '/vault/task1.md',
          fields: {},
        },
        {
          noteId: 'task-2',
          type: 'task',
          title: 'Task 2',
          created: '2024-01-02T00:00:00Z',
          modified: '2024-01-02T00:00:00Z',
          tags: ['work'],
          related: [],
          status: 'closed',
          priority: 'low',
          body: '',
          filePath: '/vault/task2.md',
          fields: {},
        },
        {
          noteId: 'note-1',
          type: 'note',
          title: 'Note 1',
          created: '2024-01-03T00:00:00Z',
          modified: '2024-01-03T00:00:00Z',
          tags: ['personal'],
          related: [],
          body: '',
          filePath: '/vault/note1.md',
          fields: {},
        },
      ];

      fullRebuild(db, notes);
    });

    it('should filter by type', () => {
      const result = queryNotes(
        db,
        { type: 'task' },
        { field: 'modified', direction: 'desc' },
        10,
        0
      );

      expect(result.total).toBe(2);
      expect(result.rows.every((r: any) => r.type === 'task')).toBe(true);
    });

    it('should filter by status', () => {
      const result = queryNotes(
        db,
        { status: 'open' },
        { field: 'modified', direction: 'desc' },
        10,
        0
      );

      expect(result.total).toBe(1);
      expect(result.rows[0].status).toBe('open');
    });

    it('should filter by tags with AND semantics', () => {
      const result = queryNotes(
        db,
        { tags: ['work', 'urgent'] },
        { field: 'modified', direction: 'desc' },
        10,
        0
      );

      expect(result.total).toBe(1);
      expect(result.rows[0].note_id).toBe('task-1');
    });

    it('should handle status negation', () => {
      const result = queryNotes(
        db,
        { status: { not: 'closed' } },
        { field: 'modified', direction: 'desc' },
        10,
        0
      );

      // Should return notes that are NOT closed (open + note without status)
      expect(result.total).toBe(2);
      expect(result.rows.every((r: any) => r.status !== 'closed')).toBe(true);
    });
  });
});
