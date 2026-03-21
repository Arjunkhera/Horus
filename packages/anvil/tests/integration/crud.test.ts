// Integration tests for CRUD operations on notes

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AnvilDatabase } from '../../src/index/sqlite.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { handleCreateNote } from '../../src/tools/create-note.js';
import { handleGetNote } from '../../src/tools/get-note.js';
import { handleUpdateNote } from '../../src/tools/update-note.js';
import { handleSearch } from '../../src/tools/search.js';
import type { CreateNoteInput } from '../../src/types/index.js';
import { isAnvilError } from '../../src/types/index.js';

describe('Integration: CRUD Operations', () => {
  let tempDir: string;
  let vaultDir: string;
  let db: AnvilDatabase;
  let registry: TypeRegistry;
  let ctx: ToolContext;

  beforeAll(async () => {
    // Create temp directory for vault
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-test-'));
    vaultDir = path.join(tempDir, 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });

    // Create subdirectories for different note types
    fs.mkdirSync(path.join(vaultDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'journals'), { recursive: true });

    // Create database using AnvilDatabase which initializes schema
    const dbPath = path.join(tempDir, 'test.db');
    db = AnvilDatabase.create(dbPath);

    // Load type registry WITHOUT passing db to avoid caching issues
    registry = new TypeRegistry();
    const projectRoot = process.cwd();
    const typeError = await registry.loadTypes(
      path.join(projectRoot, 'defaults')
    );
    if (isAnvilError(typeError)) {
      throw new Error(`Failed to load types: ${typeError.message}`);
    }

    // Set up context
    ctx = {
      vaultPath: vaultDir,
      registry,
      db,
      watcher: undefined,
    };
  });

  afterAll(() => {
    // Cleanup
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create a note and verify in database', async () => {
    const input: CreateNoteInput = {
      type: 'task',
      title: 'Test Task',
      fields: {
        status: 'open',
        priority: 'P1-high',
      },
    };

    const result = await handleCreateNote(input, ctx);
    expect(!isAnvilError(result)).toBe(true);
    if (!isAnvilError(result)) {
      expect(result.noteId).toBeDefined();
      expect(result.filePath).toBeDefined();
      expect(result.title).toBe('Test Task');
      expect(result.type).toBe('task');
    }
  });

  it('should get a note by ID and verify content matches', async () => {
    // First create a note
    const createInput: CreateNoteInput = {
      type: 'note',
      title: 'Architecture Note',
      content: 'This is a test architecture note with important information.',
    };

    const createResult = await handleCreateNote(createInput, ctx);
    expect(!isAnvilError(createResult)).toBe(true);

    if (!isAnvilError(createResult)) {
      const noteId = createResult.noteId;

      // Now get the note
      const getResult = await handleGetNote({ noteId }, ctx);
      expect(!isAnvilError(getResult)).toBe(true);

      if (!isAnvilError(getResult)) {
        expect(getResult.noteId).toBe(noteId);
        expect(getResult.title).toBe('Architecture Note');
        expect(getResult.type).toBe('note');
        expect(getResult.body).toContain('architecture note');
      }
    }
  });

  it('should create note, update fields, get note, and verify updated fields', async () => {
    // Create
    const createInput: CreateNoteInput = {
      type: 'task',
      title: 'Update Test Task',
      fields: {
        status: 'open',
        priority: 'P3-low',
      },
    };

    const createResult = await handleCreateNote(createInput, ctx);
    expect(!isAnvilError(createResult)).toBe(true);

    if (!isAnvilError(createResult)) {
      const noteId = createResult.noteId;

      // Update
      const updateResult = await handleUpdateNote(
        {
          noteId,
          fields: {
            status: 'in-progress',
            priority: 'P1-high',
          },
        },
        ctx
      );
      expect(!isAnvilError(updateResult)).toBe(true);

      // Get updated
      const getResult = await handleGetNote({ noteId }, ctx);
      expect(!isAnvilError(getResult)).toBe(true);

      if (!isAnvilError(getResult)) {
        expect(getResult.status).toBe('in-progress');
        expect(getResult.priority).toBe('P1-high');
      }
    }
  });

  it('should return TYPE_NOT_FOUND error for invalid type', async () => {
    const input: CreateNoteInput = {
      type: 'nonexistent_type',
      title: 'Invalid Type Note',
    };

    const result = await handleCreateNote(input, ctx);
    expect(isAnvilError(result)).toBe(true);
    if (isAnvilError(result)) {
      expect(result.code).toBe('TYPE_NOT_FOUND');
    }
  });

  it('should return VALIDATION_ERROR for invalid task status', async () => {
    const input: CreateNoteInput = {
      type: 'task',
      title: 'Invalid Status Task',
      fields: {
        status: 'invalid_status',
        priority: 'P2-medium',
      },
    };

    const result = await handleCreateNote(input, ctx);
    expect(isAnvilError(result)).toBe(true);
    if (isAnvilError(result)) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should create note and search for it by title keyword', async () => {
    // Create
    const createInput: CreateNoteInput = {
      type: 'task',
      title: 'Unique Searchable Task',
      fields: {
        status: 'open',
      },
    };

    const createResult = await handleCreateNote(createInput, ctx);
    expect(!isAnvilError(createResult)).toBe(true);

    if (!isAnvilError(createResult)) {
      // Search
      const searchResult = await handleSearch(
        {
          query: 'Searchable',
        },
        ctx
      );
      expect(!isAnvilError(searchResult)).toBe(true);

      if (!isAnvilError(searchResult)) {
        expect(searchResult.results.length).toBeGreaterThan(0);
        const found = searchResult.results.some(
          (r) => r.title === 'Unique Searchable Task'
        );
        expect(found).toBe(true);
      }
    }
  });

  it('should persist explicit content over template body when both are present', async () => {
    // story type has a template body — content should take precedence
    const customContent = '## Custom Content\n\nThis is my custom story content.';
    const input: CreateNoteInput = {
      type: 'story',
      title: 'Story With Custom Content',
      content: customContent,
      fields: {
        status: 'open',
      },
    };

    const result = await handleCreateNote(input, ctx);
    expect(!isAnvilError(result)).toBe(true);

    if (!isAnvilError(result)) {
      const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
      expect(!isAnvilError(getResult)).toBe(true);

      if (!isAnvilError(getResult)) {
        expect(getResult.body).toContain('Custom Content');
        expect(getResult.body).not.toContain('Acceptance Criteria');
      }
    }
  });

  it('should use template body when no content is provided for templated types', async () => {
    const input: CreateNoteInput = {
      type: 'story',
      title: 'Story With Template',
      fields: {
        status: 'open',
      },
    };

    const result = await handleCreateNote(input, ctx);
    expect(!isAnvilError(result)).toBe(true);

    if (!isAnvilError(result)) {
      const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
      expect(!isAnvilError(getResult)).toBe(true);

      if (!isAnvilError(getResult)) {
        expect(getResult.body).toContain('Acceptance Criteria');
      }
    }
  });
});
