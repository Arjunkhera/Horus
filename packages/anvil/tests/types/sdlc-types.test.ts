// Integration tests for SDLC type definitions (work-item, plan, program)

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
import { handleGetRelated } from '../../src/tools/get-related.js';
import type { CreateNoteInput } from '../../src/types/index.js';
import { isAnvilError } from '../../src/types/index.js';

describe('SDLC Types: work-item, plan, program', () => {
  let tempDir: string;
  let vaultDir: string;
  let db: AnvilDatabase;
  let registry: TypeRegistry;
  let ctx: ToolContext;

  beforeAll(async () => {
    // Create temp directory for vault
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-sdlc-test-'));
    vaultDir = path.join(tempDir, 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });

    // Create subdirectories
    fs.mkdirSync(path.join(vaultDir, 'work-items'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'plans'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'programs'), { recursive: true });

    // Create database
    const dbPath = path.join(tempDir, 'test.db');
    db = AnvilDatabase.create(dbPath);

    // Load type registry from Notes vault
    registry = new TypeRegistry();
    const notesTypesDir = '/sessions/gracious-beautiful-thompson/mnt/Repositories/Notes/.anvil/types';
    const typeError = await registry.loadTypes(notesTypesDir);
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

  describe('work-item type', () => {
    it('should load work-item type successfully', () => {
      const types = registry.getType('work-item');
      expect(types).toBeDefined();
      expect(types?.id).toBe('work-item');
      expect(types?.name).toBe('Work Item');
    });

    it('should have all required fields', () => {
      const type = registry.getType('work-item');
      expect(type?.fields.subtype).toBeDefined();
      expect(type?.fields.ceremony).toBeDefined();
      expect(type?.fields.status).toBeDefined();
      expect(type?.fields.priority).toBeDefined();
      expect(type?.fields.project).toBeDefined();
    });

    it('should have subtype as required enum', () => {
      const type = registry.getType('work-item');
      const subtypeField = type?.fields.subtype;
      expect(subtypeField?.type).toBe('enum');
      expect(subtypeField?.required).toBe(true);
      expect(subtypeField?.values).toEqual([
        'feature',
        'bugfix',
        'refactor',
        'spike',
        'hotfix',
        'task',
        'chore',
      ]);
    });

    it('should have status with default draft', () => {
      const type = registry.getType('work-item');
      const statusField = type?.fields.status;
      expect(statusField?.type).toBe('enum');
      expect(statusField?.default).toBe('draft');
      expect(statusField?.values).toEqual([
        'draft',
        'ready',
        'in_progress',
        'in_review',
        'done',
        'blocked',
        'cancelled',
      ]);
    });

    it('should have priority with default P2-medium', () => {
      const type = registry.getType('work-item');
      const priorityField = type?.fields.priority;
      expect(priorityField?.type).toBe('enum');
      expect(priorityField?.default).toBe('P2-medium');
      expect(priorityField?.values).toEqual([
        'P0-critical',
        'P1-high',
        'P2-medium',
        'P3-low',
      ]);
    });

    it('should have project as reference field', () => {
      const type = registry.getType('work-item');
      const projectField = type?.fields.project;
      expect(projectField?.type).toBe('reference');
      expect(projectField?.ref_type).toBe('project');
    });

    it('should create work-item with subtype required', async () => {
      // Should fail without subtype
      const createInputNoSubtype: CreateNoteInput = {
        type: 'work-item',
        title: 'Feature Request',
        fields: {},
      };

      const resultNoSubtype = await handleCreateNote(createInputNoSubtype, ctx);
      expect(isAnvilError(resultNoSubtype)).toBe(true);
    });

    it('should create work-item with all fields', async () => {
      const createInput: CreateNoteInput = {
        type: 'work-item',
        title: 'Implement Login Feature',
        fields: {
          subtype: 'feature',
          ceremony: 'full',
          status: 'ready',
          priority: 'P1-high',
        },
      };

      const result = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        expect(result.noteId).toBeDefined();
        expect(result.type).toBe('work-item');

        // Verify by getting the note
        const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.fields.subtype).toBe('feature');
          expect(getResult.fields.ceremony).toBe('full');
          expect(getResult.status).toBe('ready');
          expect(getResult.priority).toBe('P1-high');
        }
      }
    });

    it('should validate enum values for status', async () => {
      const createInput: CreateNoteInput = {
        type: 'work-item',
        title: 'Bugfix Issue',
        fields: {
          subtype: 'bugfix',
          status: 'invalid-status',
        },
      };

      const result = await handleCreateNote(createInput, ctx);
      // Should fail validation due to invalid status
      expect(isAnvilError(result)).toBe(true);
    });

    it('should use default values for status and priority', async () => {
      const createInput: CreateNoteInput = {
        type: 'work-item',
        title: 'Refactoring Task',
        fields: {
          subtype: 'refactor',
        },
      };

      const result = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.status).toBe('draft');
          expect(getResult.priority).toBe('P2-medium');
        }
      }
    });

    it('should support status transitions', async () => {
      const createInput: CreateNoteInput = {
        type: 'work-item',
        title: 'Spike Investigation',
        fields: {
          subtype: 'spike',
        },
      };

      const createResult = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(createResult)).toBe(true);

      if (!isAnvilError(createResult)) {
        const noteId = createResult.noteId;

        // Transition status
        const updateResult = await handleUpdateNote(
          {
            noteId,
            fields: {
              status: 'in_progress',
            },
          },
          ctx
        );
        expect(!isAnvilError(updateResult)).toBe(true);

        // Verify update
        const getResult = await handleGetNote({ noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.status).toBe('in_progress');
        }
      }
    });
  });

  describe('plan type', () => {
    it('should load plan type successfully', () => {
      const type = registry.getType('plan');
      expect(type).toBeDefined();
      expect(type?.id).toBe('plan');
      expect(type?.name).toBe('Plan');
    });

    it('should have all required fields', () => {
      const type = registry.getType('plan');
      expect(type?.fields.version).toBeDefined();
      expect(type?.fields.approval).toBeDefined();
      expect(type?.fields.work_item).toBeDefined();
    });

    it('should have version with default v1', () => {
      const type = registry.getType('plan');
      const versionField = type?.fields.version;
      expect(versionField?.type).toBe('string');
      expect(versionField?.default).toBe('v1');
    });

    it('should have approval with default draft', () => {
      const type = registry.getType('plan');
      const approvalField = type?.fields.approval;
      expect(approvalField?.type).toBe('enum');
      expect(approvalField?.default).toBe('draft');
      expect(approvalField?.values).toEqual([
        'draft',
        'approved',
        'revised',
        'archived',
      ]);
    });

    it('should have work_item as reference field', () => {
      const type = registry.getType('plan');
      const workItemField = type?.fields.work_item;
      expect(workItemField?.type).toBe('reference');
      expect(workItemField?.ref_type).toBe('work-item');
    });

    it('should create plan with default values', async () => {
      const createInput: CreateNoteInput = {
        type: 'plan',
        title: 'Implementation Plan v1',
      };

      const result = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.fields.version).toBe('v1');
          expect(getResult.fields.approval).toBe('draft');
        }
      }
    });

    it('should support approval status transitions', async () => {
      const createInput: CreateNoteInput = {
        type: 'plan',
        title: 'Feature Plan',
      };

      const createResult = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(createResult)).toBe(true);

      if (!isAnvilError(createResult)) {
        const noteId = createResult.noteId;

        // Transition approval
        const updateResult = await handleUpdateNote(
          {
            noteId,
            fields: {
              approval: 'approved',
            },
          },
          ctx
        );
        expect(!isAnvilError(updateResult)).toBe(true);

        // Verify
        const getResult = await handleGetNote({ noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.fields.approval).toBe('approved');
        }
      }
    });

    it('should support version bumping', async () => {
      const createInput: CreateNoteInput = {
        type: 'plan',
        title: 'Versioned Plan',
      };

      const createResult = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(createResult)).toBe(true);

      if (!isAnvilError(createResult)) {
        const noteId = createResult.noteId;

        // Bump version
        const updateResult = await handleUpdateNote(
          {
            noteId,
            fields: {
              version: 'v2',
            },
          },
          ctx
        );
        expect(!isAnvilError(updateResult)).toBe(true);

        // Verify
        const getResult = await handleGetNote({ noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.fields.version).toBe('v2');
        }
      }
    });
  });

  describe('program type', () => {
    it('should load program type successfully', () => {
      const type = registry.getType('program');
      expect(type).toBeDefined();
      expect(type?.id).toBe('program');
      expect(type?.name).toBe('Program');
    });

    it('should have all required fields', () => {
      const type = registry.getType('program');
      expect(type?.fields.status).toBeDefined();
      expect(type?.fields.owner).toBeDefined();
      expect(type?.fields.codename).toBeDefined();
    });

    it('should have status with default active', () => {
      const type = registry.getType('program');
      const statusField = type?.fields.status;
      expect(statusField?.type).toBe('enum');
      expect(statusField?.default).toBe('active');
      expect(statusField?.values).toEqual([
        'active',
        'paused',
        'completed',
        'archived',
      ]);
    });

    it('should have owner and codename as string fields', () => {
      const type = registry.getType('program');
      const ownerField = type?.fields.owner;
      const codenameField = type?.fields.codename;

      expect(ownerField?.type).toBe('string');
      expect(codenameField?.type).toBe('string');
    });

    it('should create program with default status', async () => {
      const createInput: CreateNoteInput = {
        type: 'program',
        title: 'Project Horus',
        fields: {
          owner: 'Alice Johnson',
          codename: 'Horus',
        },
      };

      const result = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.status).toBe('active');
          expect(getResult.fields.owner).toBe('Alice Johnson');
          expect(getResult.fields.codename).toBe('Horus');
        }
      }
    });

    it('should support status transitions', async () => {
      const createInput: CreateNoteInput = {
        type: 'program',
        title: 'Test Program',
        fields: {
          owner: 'Bob Smith',
        },
      };

      const createResult = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(createResult)).toBe(true);

      if (!isAnvilError(createResult)) {
        const noteId = createResult.noteId;

        // Transition status
        const updateResult = await handleUpdateNote(
          {
            noteId,
            fields: {
              status: 'paused',
            },
          },
          ctx
        );
        expect(!isAnvilError(updateResult)).toBe(true);

        // Verify
        const getResult = await handleGetNote({ noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.status).toBe('paused');
        }
      }
    });

    it('should create program with minimal fields', async () => {
      const createInput: CreateNoteInput = {
        type: 'program',
        title: 'Minimal Program',
      };

      const result = await handleCreateNote(createInput, ctx);
      expect(!isAnvilError(result)).toBe(true);

      if (!isAnvilError(result)) {
        const getResult = await handleGetNote({ noteId: result.noteId }, ctx);
        expect(!isAnvilError(getResult)).toBe(true);

        if (!isAnvilError(getResult)) {
          expect(getResult.status).toBe('active');
          expect(getResult.owner).toBeUndefined();
          expect(getResult.codename).toBeUndefined();
        }
      }
    });
  });

  describe('Cross-type relationships', () => {
    it('should create work-item and link to project', async () => {
      // Create a project first (if project type exists)
      const projectResult = await handleCreateNote(
        {
          type: 'project',
          title: 'Test Project',
        },
        ctx
      );

      if (!isAnvilError(projectResult)) {
        const projectId = projectResult.noteId;

        // Create work-item with project reference
        const workItemResult = await handleCreateNote(
          {
            type: 'work-item',
            title: 'Work Item for Project',
            fields: {
              subtype: 'feature',
              project: `[[${projectId}]]`,
            },
          },
          ctx
        );

        expect(!isAnvilError(workItemResult)).toBe(true);

        if (!isAnvilError(workItemResult)) {
          const getResult = await handleGetNote({ noteId: workItemResult.noteId }, ctx);
          expect(!isAnvilError(getResult)).toBe(true);
        }
      }
    });

    it('should create plan linked to work-item and verify reference persists', async () => {
      // Create work-item
      const workItemResult = await handleCreateNote(
        {
          type: 'work-item',
          title: 'Feature to Plan',
          fields: {
            subtype: 'feature',
          },
        },
        ctx
      );

      expect(!isAnvilError(workItemResult)).toBe(true);

      if (!isAnvilError(workItemResult)) {
        const workItemId = workItemResult.noteId;

        // Create plan linked to work-item
        const planResult = await handleCreateNote(
          {
            type: 'plan',
            title: 'Plan for Feature',
            fields: {
              work_item: `[[${workItemId}]]`,
            },
          },
          ctx
        );

        expect(!isAnvilError(planResult)).toBe(true);

        if (!isAnvilError(planResult)) {
          const planId = planResult.noteId;

          // Verify plan has work_item reference persisted
          const getPlannedResult = await handleGetNote({ noteId: planId }, ctx);
          expect(!isAnvilError(getPlannedResult)).toBe(true);

          if (!isAnvilError(getPlannedResult)) {
            // The work_item field should be stored in the note (as a wiki-link string or reference)
            expect(getPlannedResult.fields.work_item).toBeDefined();
          }
        }
      }
    });
  });
});
