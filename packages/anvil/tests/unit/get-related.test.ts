// Unit tests for anvil_get_related tool

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnvilDatabase, type AnvilDb } from '../../src/index/sqlite.js';
import { handleGetRelated, type RelatedResponse } from '../../src/tools/get-related.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { isAnvilError } from '../../src/types/error.js';

describe('handleGetRelated', () => {
  let db: AnvilDb;
  let anvilDb: AnvilDatabase;
  let ctx: ToolContext;

  beforeEach(async () => {
    // Use in-memory database for tests
    anvilDb = AnvilDatabase.create(':memory:');
    db = anvilDb.raw;

    // Create a simple registry
    const registry = new TypeRegistry();

    ctx = {
      vaultPath: '/tmp/test-vault',
      registry,
      db: anvilDb,
    };

    // Insert type definitions first (for foreign key constraints)
    const typesSql = `INSERT INTO types (type_id, name, schema_json, updated_at) VALUES (?, ?, ?, ?)`;
    db.run(typesSql, ['task', 'Task', '{}', new Date().toISOString()]);
    db.run(typesSql, ['project', 'Project', '{}', new Date().toISOString()]);

    // Insert test notes
    const notesSql = `INSERT INTO notes (note_id, type, title, file_path, created, modified) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(notesSql, ['note-1', 'task', 'Task 1', 'notes/task1.md', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z']);
    db.run(notesSql, ['note-2', 'task', 'Task 2', 'notes/task2.md', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z']);
    db.run(notesSql, ['note-3', 'project', 'My Project', 'notes/project.md', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z']);
    db.run(notesSql, ['note-4', 'task', 'Unresolved Task', 'notes/task4.md', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z']);
  });

  afterEach(() => {
    anvilDb.close();
  });

  it('should return note with forward and reverse relationships', () => {
    // Add relationships: note-1 -> note-2 (project), note-1 -> note-3 (mentions)
    const relSql = `INSERT INTO relationships (source_id, target_id, target_title, relation_type) VALUES (?, ?, ?, ?)`;

    db.run(relSql, ['note-1', 'note-2', 'Task 2', 'project']);
    db.run(relSql, ['note-1', 'note-3', 'My Project', 'mentions']);

    // Add reverse relationship: note-4 -> note-1 (assignee)
    db.run(relSql, ['note-4', 'note-1', 'Task 1', 'assignee']);

    const result = handleGetRelated({ noteId: 'note-1' }, ctx);

    expect(!isAnvilError(result)).toBe(true);
    if (isAnvilError(result)) return;

    const response = result as RelatedResponse;
    expect(response.noteId).toBe('note-1');
    expect(response.title).toBe('Task 1');
    expect(response.type).toBe('task');

    // Check forward relationships
    expect(response.forward['project']).toBeDefined();
    expect(response.forward['mentions']).toBeDefined();
    expect(response.forward['project']).toHaveLength(1);
    expect(response.forward['mentions']).toHaveLength(1);

    // Check reverse relationships
    expect(response.reverse['assignee']).toBeDefined();
    expect(response.reverse['assignee']).toHaveLength(1);
  });

  it('should group relationships by relationType', () => {
    const relSql = `INSERT INTO relationships (source_id, target_id, target_title, relation_type) VALUES (?, ?, ?, ?)`;

    // Multiple forward relationships of different types
    db.run(relSql, ['note-1', 'note-2', 'Task 2', 'project']);
    db.run(relSql, ['note-1', 'note-3', 'My Project', 'project']);
    db.run(relSql, ['note-1', 'note-2', 'Task 2', 'depends_on']);

    const result = handleGetRelated({ noteId: 'note-1' }, ctx) as RelatedResponse;

    expect(result.forward['project']).toHaveLength(2);
    expect(result.forward['depends_on']).toHaveLength(1);
    expect(Object.keys(result.forward).sort()).toEqual(['depends_on', 'project']);
  });

  it('should include unresolved forward references (targetId = null)', () => {
    const relSql = `INSERT INTO relationships (source_id, target_id, target_title, relation_type) VALUES (?, ?, ?, ?)`;

    // Unresolved forward reference
    db.run(relSql, ['note-1', null, 'Nonexistent Note', 'mentions']);

    const result = handleGetRelated({ noteId: 'note-1' }, ctx) as RelatedResponse;

    expect(result.forward['mentions']).toBeDefined();
    expect(result.forward['mentions']).toHaveLength(1);

    const unresolvedRef = result.forward['mentions'][0];
    expect(unresolvedRef.noteId).toBeNull();
    expect(unresolvedRef.title).toBe('Nonexistent Note');
    expect(unresolvedRef.resolved).toBe(false);
  });

  it('should return empty forward and reverse when note has no relationships', () => {
    const result = handleGetRelated({ noteId: 'note-4' }, ctx) as RelatedResponse;

    expect(result.noteId).toBe('note-4');
    expect(result.title).toBe('Unresolved Task');
    expect(result.type).toBe('task');
    expect(Object.keys(result.forward)).toHaveLength(0);
    expect(Object.keys(result.reverse)).toHaveLength(0);
  });

  it('should return NOT_FOUND error for non-existent noteId', () => {
    const result = handleGetRelated({ noteId: 'nonexistent-note' }, ctx);

    expect(isAnvilError(result)).toBe(true);
    if (isAnvilError(result)) {
      expect(result.code).toBe('NOT_FOUND');
      expect(result.message).toContain('nonexistent-note');
    }
  });

  it('should include note type and resolved status in forward relationships', () => {
    const relSql = `INSERT INTO relationships (source_id, target_id, target_title, relation_type) VALUES (?, ?, ?, ?)`;

    db.run(relSql, ['note-1', 'note-2', 'Task 2', 'depends_on']);

    const result = handleGetRelated({ noteId: 'note-1' }, ctx) as RelatedResponse;

    const dependsOn = result.forward['depends_on'][0];
    expect(dependsOn.noteId).toBe('note-2');
    expect(dependsOn.title).toBe('Task 2');
    expect(dependsOn.type).toBe('task');
    expect(dependsOn.resolved).toBe(true);
  });

  it('should include note type and resolved status in reverse relationships', () => {
    const relSql = `INSERT INTO relationships (source_id, target_id, target_title, relation_type) VALUES (?, ?, ?, ?)`;

    db.run(relSql, ['note-4', 'note-1', 'Task 1', 'assignee']);

    const result = handleGetRelated({ noteId: 'note-1' }, ctx) as RelatedResponse;

    const assignee = result.reverse['assignee'][0];
    expect(assignee.noteId).toBe('note-4');
    expect(assignee.title).toBe('Unresolved Task');
    expect(assignee.type).toBe('task');
    expect(assignee.resolved).toBe(true);
  });

  it('should handle mixed resolved and unresolved relationships', () => {
    const relSql = `INSERT INTO relationships (source_id, target_id, target_title, relation_type) VALUES (?, ?, ?, ?)`;

    // One resolved, one unresolved in same type
    db.run(relSql, ['note-1', 'note-2', 'Task 2', 'mentions']);
    db.run(relSql, ['note-1', null, 'Future Task', 'mentions']);

    const result = handleGetRelated({ noteId: 'note-1' }, ctx) as RelatedResponse;

    const mentions = result.forward['mentions'];
    expect(mentions).toHaveLength(2);

    const resolved = mentions.find((r) => r.resolved);
    const unresolved = mentions.find((r) => !r.resolved);

    expect(resolved).toBeDefined();
    expect(resolved!.noteId).toBe('note-2');
    expect(resolved!.type).toBe('task');

    expect(unresolved).toBeDefined();
    expect(unresolved!.noteId).toBeNull();
    expect(unresolved!.title).toBe('Future Task');
  });

  it('should return correct note metadata in response', () => {
    const result = handleGetRelated({ noteId: 'note-3' }, ctx) as RelatedResponse;

    expect(result.noteId).toBe('note-3');
    expect(result.title).toBe('My Project');
    expect(result.type).toBe('project');
  });
});
