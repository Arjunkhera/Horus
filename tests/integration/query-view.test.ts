// Integration tests for query views

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AnvilDatabase } from '../../src/index/sqlite.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { handleCreateNote } from '../../src/tools/create-note.js';
import { handleQueryView } from '../../src/tools/query-view.js';
import type { CreateNoteInput } from '../../src/types/index.js';
import { isAnvilError } from '../../src/types/index.js';

describe('Integration: Query Views', () => {
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

  it('should create notes and render list view with pagination', async () => {
    // Create multiple notes
    for (let i = 0; i < 5; i++) {
      const input: CreateNoteInput = {
        type: 'note',
        title: `List View Note ${i}`,
        content: `Content for note ${i}`,
      };
      await handleCreateNote(input, ctx);
    }

    // Query with list view and pagination
    const queryResult = await handleQueryView(
      {
        view: 'list',
        limit: 2,
        offset: 0,
      },
      ctx
    );

    expect(!isAnvilError(queryResult)).toBe(true);
    if (!isAnvilError(queryResult)) {
      expect(queryResult.view).toBe('list');
      expect(Array.isArray(queryResult.items)).toBe(true);
      expect(queryResult.items!.length).toBeLessThanOrEqual(2);
    }
  });

  it('should render table view with custom columns', async () => {
    // Create notes of different types
    const noteInput: CreateNoteInput = {
      type: 'note',
      title: 'Table View Note',
      content: 'Test content',
    };

    const taskInput: CreateNoteInput = {
      type: 'task',
      title: 'Table View Task',
      fields: {
        status: 'open',
        priority: 'P1-high',
      },
    };

    await handleCreateNote(noteInput, ctx);
    await handleCreateNote(taskInput, ctx);

    // Query with table view
    const queryResult = await handleQueryView(
      {
        view: 'table',
        columns: ['title', 'type', 'status', 'priority'],
      },
      ctx
    );

    expect(!isAnvilError(queryResult)).toBe(true);
    if (!isAnvilError(queryResult)) {
      expect(queryResult.view).toBe('table');
      expect(queryResult.columns).toBeDefined();
      expect(Array.isArray(queryResult.rows)).toBe(true);
    }
  });
});
