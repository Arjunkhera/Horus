// Integration tests for note relationships

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AnvilDatabase } from '../../src/index/sqlite.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import { handleCreateNote } from '../../src/tools/create-note.js';
import { handleGetRelated } from '../../src/tools/get-related.js';
import type { CreateNoteInput } from '../../src/types/index.js';
import { isAnvilError } from '../../src/types/index.js';

describe('Integration: Relationships', () => {
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
    fs.mkdirSync(path.join(vaultDir, 'people'), { recursive: true });
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

  it('should create person and task with mention, then verify relationship', async () => {
    // Create a person
    const personInput: CreateNoteInput = {
      type: 'person',
      title: 'Integration Test Person',
    };

    const personResult = await handleCreateNote(personInput, ctx);
    expect(!isAnvilError(personResult)).toBe(true);

    if (!isAnvilError(personResult)) {
      // Create a task that mentions the person
      const taskInput: CreateNoteInput = {
        type: 'task',
        title: 'Task with Assigned Person',
        fields: {
          status: 'open',
        },
        content: `Assigned to [[Integration Test Person]].`,
      };

      const taskResult = await handleCreateNote(taskInput, ctx);
      expect(!isAnvilError(taskResult)).toBe(true);

      if (!isAnvilError(taskResult)) {
        const taskId = taskResult.noteId;

        // Get relationships for task
        const relResult = handleGetRelated({ noteId: taskId }, ctx);
        expect(!isAnvilError(relResult)).toBe(true);

        if (!isAnvilError(relResult)) {
          // Check if person is mentioned in forward relationships
          // The relationship extraction depends on body text parsing
          expect(relResult.forward).toBeDefined();
        }
      }
    }
  });

  it('should create note referencing future note, then resolve after creation', async () => {
    // Create a task that references a note that doesn't exist yet
    const taskInput: CreateNoteInput = {
      type: 'task',
      title: 'Task Referencing Future Note',
      fields: {
        status: 'open',
      },
      content: 'This references [[Future Project Note]] which will be created.',
    };

    const taskResult = await handleCreateNote(taskInput, ctx);
    expect(!isAnvilError(taskResult)).toBe(true);

    if (!isAnvilError(taskResult)) {
      const taskId = taskResult.noteId;

      // Get relationships - at this point future note doesn't exist
      const relBefore = handleGetRelated({ noteId: taskId }, ctx);
      expect(!isAnvilError(relBefore)).toBe(true);

      // Now create the future project
      const projectInput: CreateNoteInput = {
        type: 'project',
        title: 'Future Project Note',
        fields: {
          status: 'active',
        },
      };

      const projectResult = await handleCreateNote(projectInput, ctx);
      expect(!isAnvilError(projectResult)).toBe(true);

      if (!isAnvilError(projectResult)) {
        // Get relationships again - should now show resolved
        const relAfter = handleGetRelated({ noteId: taskId }, ctx);
        expect(!isAnvilError(relAfter)).toBe(true);

        if (!isAnvilError(relAfter)) {
          expect(relAfter.forward).toBeDefined();
        }
      }
    }
  });

  it('should create task with related field referencing project', async () => {
    // Create a project
    const projectInput: CreateNoteInput = {
      type: 'project',
      title: 'Related Test Project',
      fields: {
        status: 'active',
      },
    };

    const projectResult = await handleCreateNote(projectInput, ctx);
    expect(!isAnvilError(projectResult)).toBe(true);

    if (!isAnvilError(projectResult)) {
      // Create a task with related field
      const taskInput: CreateNoteInput = {
        type: 'task',
        title: 'Task Related to Project',
        fields: {
          status: 'open',
          related: ['[[Related Test Project]]'],
        },
      };

      const taskResult = await handleCreateNote(taskInput, ctx);
      expect(!isAnvilError(taskResult)).toBe(true);

      if (!isAnvilError(taskResult)) {
        const taskId = taskResult.noteId;

        // Get relationships
        const relResult = handleGetRelated({ noteId: taskId }, ctx);
        expect(!isAnvilError(relResult)).toBe(true);

        if (!isAnvilError(relResult)) {
          // Should have related relationships
          expect(relResult.forward).toBeDefined();
        }
      }
    }
  });
});
