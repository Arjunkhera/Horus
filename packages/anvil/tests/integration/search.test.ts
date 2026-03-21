// Integration tests for search functionality

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AnvilDatabase } from '../../src/index/sqlite.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { handleCreateNote } from '../../src/tools/create-note.js';
import { handleSearch } from '../../src/tools/search.js';
import type { CreateNoteInput } from '../../src/types/index.js';
import { isAnvilError } from '../../src/types/index.js';

describe('Integration: Search', () => {
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

    // Create subdirectories
    fs.mkdirSync(path.join(vaultDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'projects'), { recursive: true });

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

  it('should create notes of different types and filter by type', async () => {
    // Create different types
    const taskInput: CreateNoteInput = {
      type: 'task',
      title: 'Type Filter Test Task',
      fields: { status: 'open' },
    };

    const noteInput: CreateNoteInput = {
      type: 'note',
      title: 'Type Filter Test Note',
    };

    const projectInput: CreateNoteInput = {
      type: 'project',
      title: 'Type Filter Test Project',
      fields: { status: 'active' },
    };

    await handleCreateNote(taskInput, ctx);
    await handleCreateNote(noteInput, ctx);
    await handleCreateNote(projectInput, ctx);

    // Search with type filter
    const taskSearch = await handleSearch(
      {
        filters: {
          type: 'task',
        },
      },
      ctx
    );

    expect(!isAnvilError(taskSearch)).toBe(true);
    if (!isAnvilError(taskSearch)) {
      // All results should be tasks
      const allTasks = taskSearch.results.every((r) => r.type === 'task');
      expect(allTasks).toBe(true);
    }
  });

  it('should create note with unique content and find via FTS search', async () => {
    const uniqueKeyword = 'xyzuniquekeyword12345';
    const input: CreateNoteInput = {
      type: 'note',
      title: 'FTS Test Note',
      content: `This note contains the ${uniqueKeyword} that we will search for.`,
    };

    const createResult = await handleCreateNote(input, ctx);
    expect(!isAnvilError(createResult)).toBe(true);

    // Search for the unique keyword
    const searchResult = await handleSearch(
      {
        query: uniqueKeyword,
      },
      ctx
    );

    expect(!isAnvilError(searchResult)).toBe(true);
    if (!isAnvilError(searchResult)) {
      expect(searchResult.results.length).toBeGreaterThan(0);
      const found = searchResult.results.some(
        (r) => r.title === 'FTS Test Note'
      );
      expect(found).toBe(true);
    }
  });

  it('should search with combined type and status filters', async () => {
    // Create tasks with different statuses
    const openTask: CreateNoteInput = {
      type: 'task',
      title: 'Combined Filter Open Task',
      fields: { status: 'open' },
    };

    const inProgressTask: CreateNoteInput = {
      type: 'task',
      title: 'Combined Filter In Progress Task',
      fields: { status: 'in-progress' },
    };

    await handleCreateNote(openTask, ctx);
    await handleCreateNote(inProgressTask, ctx);

    // Search with type + status filter
    const searchResult = await handleSearch(
      {
        filters: {
          type: 'task',
          status: 'open',
        },
      },
      ctx
    );

    expect(!isAnvilError(searchResult)).toBe(true);
    if (!isAnvilError(searchResult)) {
      // All results should be open tasks
      const correctResults = searchResult.results.every(
        (r) => r.type === 'task' && r.status === 'open'
      );
      expect(correctResults).toBe(true);
    }
  });
});
