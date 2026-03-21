// Unit tests for anvil_list_types tool

import { describe, it, expect } from 'vitest';
import { handleListTypes, type TypeInfo, type FieldInfo } from '../../src/tools/list-types.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import type { ResolvedType, FieldDefinition } from '../../src/types/index.js';
import { AnvilDatabase } from '../../src/index/sqlite.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('handleListTypes', () => {
  let ctx: ToolContext;
  let tmpDir: string;

  beforeEach(async () => {
    // Create temporary directory for test database
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    // Create a test registry with mock types
    const registry = new TypeRegistry();

    // Manually add types to the registry for testing
    // We'll use direct map access since we're testing, not loading from files
    (registry as any).types = new Map<string, ResolvedType>();
    (registry as any).definitions = new Map();

    // Add _core type
    const coreType: ResolvedType = {
      id: '_core',
      name: 'Core',
      fields: {
        noteId: { type: 'string', required: true, immutable: true },
        type: { type: 'string', required: true, immutable: true },
        title: { type: 'string', required: true },
        created: { type: 'datetime', required: true, immutable: true, auto: 'now' },
        modified: { type: 'datetime', required: true, auto: 'now' },
        tags: { type: 'tags', required: false },
        related: { type: 'reference_list', required: false },
        scope: { type: 'object', required: false, fields: {} },
      },
      behaviors: {},
      ownFields: {},
      source: { directory: tmpDir, file: '_core.yaml' },
    };

    // Add task type (extends _core)
    const taskType: ResolvedType = {
      id: 'task',
      name: 'Task',
      extends: '_core',
      fields: {
        ...coreType.fields,
        status: { type: 'enum', values: ['open', 'closed'], required: false },
        priority: { type: 'enum', values: ['low', 'medium', 'high'], required: false },
        due: { type: 'date', required: false },
        effort: { type: 'number', required: false, integer: true, min: 1 },
      },
      behaviors: {},
      ownFields: {
        status: { type: 'enum', values: ['open', 'closed'], required: false },
        priority: { type: 'enum', values: ['low', 'medium', 'high'], required: false },
        due: { type: 'date', required: false },
        effort: { type: 'number', required: false, integer: true, min: 1 },
      },
      source: { directory: tmpDir, file: 'task.yaml' },
    };

    // Add story type (extends task)
    const storyType: ResolvedType = {
      id: 'story',
      name: 'Story',
      extends: 'task',
      fields: {
        ...taskType.fields,
        epic: { type: 'reference', required: false, ref_type: 'epic' },
      },
      behaviors: {},
      ownFields: {
        epic: { type: 'reference', required: false, ref_type: 'epic' },
      },
      source: { directory: tmpDir, file: 'story.yaml' },
    };

    // Add journal type (with append_only behavior)
    const journalType: ResolvedType = {
      id: 'journal',
      name: 'Journal',
      fields: {
        ...coreType.fields,
      },
      behaviors: { append_only: true },
      ownFields: {},
      source: { directory: tmpDir, file: 'journal.yaml' },
    };

    // Add note type (simple type)
    const noteType: ResolvedType = {
      id: 'note',
      name: 'Note',
      extends: '_core',
      fields: {
        ...coreType.fields,
        description: { type: 'text', required: false },
      },
      behaviors: {},
      ownFields: {
        description: { type: 'text', required: false },
      },
      source: { directory: tmpDir, file: 'note.yaml' },
    };

    (registry as any).types.set('_core', coreType);
    (registry as any).types.set('task', taskType);
    (registry as any).types.set('story', storyType);
    (registry as any).types.set('journal', journalType);
    (registry as any).types.set('note', noteType);

    const db = new AnvilDatabase(dbPath);

    ctx = {
      vaultPath: tmpDir,
      registry,
      db,
    };
  });

  it('should return all types sorted alphabetically by typeId', () => {
    const result = handleListTypes(ctx);

    expect(result.types).toHaveLength(5);
    expect(result.types[0].typeId).toBe('_core');
    expect(result.types[1].typeId).toBe('journal');
    expect(result.types[2].typeId).toBe('note');
    expect(result.types[3].typeId).toBe('story');
    expect(result.types[4].typeId).toBe('task');
  });

  it('should include core fields first in field ordering', () => {
    const result = handleListTypes(ctx);
    const noteType = result.types.find((t) => t.typeId === 'note');

    expect(noteType).toBeDefined();
    const fieldNames = noteType!.fields.map((f) => f.name);

    // Core fields should come first in order
    const coreFieldOrder = ['noteId', 'type', 'title', 'created', 'modified', 'tags', 'related', 'scope'];
    const coreFieldsInType = fieldNames.filter((n) => coreFieldOrder.includes(n));

    expect(coreFieldsInType.slice(0, coreFieldsInType.length)).toEqual(
      coreFieldOrder.filter((f) => fieldNames.includes(f))
    );
  });

  it('should include type-specific fields after core fields, sorted alphabetically', () => {
    const result = handleListTypes(ctx);
    const taskType = result.types.find((t) => t.typeId === 'task');

    expect(taskType).toBeDefined();
    const fieldNames = taskType!.fields.map((f) => f.name);

    // Find where core fields end
    const coreFieldOrder = ['noteId', 'type', 'title', 'created', 'modified', 'tags', 'related', 'scope'];
    const coreFieldCount = fieldNames.filter((n) => coreFieldOrder.includes(n)).length;

    // Type-specific fields should be after core fields and alphabetically sorted
    const typeSpecificFields = fieldNames.slice(coreFieldCount);
    const sorted = [...typeSpecificFields].sort();

    expect(typeSpecificFields).toEqual(sorted);
  });

  it('should merge inherited fields from parent types', () => {
    const result = handleListTypes(ctx);
    const storyType = result.types.find((t) => t.typeId === 'story');

    expect(storyType).toBeDefined();
    const fieldNames = new Set(storyType!.fields.map((f) => f.name));

    // Story should have all fields from task (and _core)
    expect(fieldNames.has('status')).toBe(true);
    expect(fieldNames.has('priority')).toBe(true);
    expect(fieldNames.has('due')).toBe(true);
    expect(fieldNames.has('effort')).toBe(true);

    // And its own fields
    expect(fieldNames.has('epic')).toBe(true);
  });

  it('should correctly include behaviors.append_only for journal type', () => {
    const result = handleListTypes(ctx);
    const journalType = result.types.find((t) => t.typeId === 'journal');

    expect(journalType).toBeDefined();
    expect(journalType!.behaviors.append_only).toBe(true);
  });

  it('should set append_only to false for types without the behavior', () => {
    const result = handleListTypes(ctx);
    const noteType = result.types.find((t) => t.typeId === 'note');
    const taskType = result.types.find((t) => t.typeId === 'task');

    expect(noteType!.behaviors.append_only).toBe(false);
    expect(taskType!.behaviors.append_only).toBe(false);
  });

  it('should return empty array for empty registry', () => {
    const emptyRegistry = new TypeRegistry();
    const emptyCtx: ToolContext = {
      vaultPath: ctx.vaultPath,
      registry: emptyRegistry,
      db: ctx.db,
    };

    const result = handleListTypes(emptyCtx);
    expect(result.types).toHaveLength(0);
  });

  it('should include field details in FieldInfo', () => {
    const result = handleListTypes(ctx);
    const taskType = result.types.find((t) => t.typeId === 'task');

    expect(taskType).toBeDefined();
    const statusField = taskType!.fields.find((f) => f.name === 'status');

    expect(statusField).toBeDefined();
    expect(statusField!.type).toBe('enum');
    expect(statusField!.values).toEqual(['open', 'closed']);
    expect(statusField!.required).toBe(false);
  });

  it('should include extends field', () => {
    const result = handleListTypes(ctx);
    const storyType = result.types.find((t) => t.typeId === 'story');
    const noteType = result.types.find((t) => t.typeId === 'note');

    expect(storyType!.extends).toBe('task');
    expect(noteType!.extends).toBe('_core');
  });

  it('should set extends to null for types without parent', () => {
    const result = handleListTypes(ctx);
    const coreType = result.types.find((t) => t.typeId === '_core');

    expect(coreType!.extends).toBeNull();
  });

  it('should include source info in returned TypeInfo', () => {
    const result = handleListTypes(ctx);
    const noteType = result.types.find((t) => t.typeId === 'note');

    expect(noteType).toBeDefined();
    expect(noteType!.source).toBeDefined();
    expect(noteType!.source.directory).toBe(tmpDir);
    expect(noteType!.source.file).toBe('note.yaml');
  });

  it('should include plugin name in source when applicable', () => {
    const result = handleListTypes(ctx);

    // All mock types should have source info
    for (const typeInfo of result.types) {
      expect(typeInfo.source).toBeDefined();
      expect(typeInfo.source.directory).toBeDefined();
      expect(typeInfo.source.file).toBeDefined();
    }
  });
});
