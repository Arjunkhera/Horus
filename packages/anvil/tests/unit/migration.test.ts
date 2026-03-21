// Unit tests for migration tooling

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { mkdtemp } from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';

import {
  inferType,
  inferNamingPrefix,
  DEFAULT_CONFIG,
  type InferenceRule,
} from '../../src/migration/type-inferrer.js';
import {
  extractDataviewFields,
  convertDataviewFields,
  type DataviewField,
} from '../../src/migration/dataview-converter.js';
import {
  createEmptyReport,
  addFileResult,
  formatReportSummary,
  formatReportMarkdown,
  type FileMigrationResult,
} from '../../src/migration/report.js';
import { migrate, type MigrationConfig } from '../../src/migration/migrator.js';

const mkdtempAsync = promisify(mkdtemp);

describe('Migration Tooling', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-migration-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Type Inferrer', () => {
    it('should infer task type from Tasks/ directory', () => {
      const type = inferType('Tasks/my-task.md', {});
      expect(type).toBe('task');
    });

    it('should infer person type from People/ directory', () => {
      const type = inferType('People/John-Doe.md', {});
      expect(type).toBe('person');
    });

    it('should infer project type from Projects/ directory', () => {
      const type = inferType('Projects/my-project.md', {});
      expect(type).toBe('project');
    });

    it('should infer meeting type from Meetings/ directory', () => {
      const type = inferType('Meetings/2024-02-23.md', {});
      expect(type).toBe('meeting');
    });

    it('should infer service type from Services/ directory', () => {
      const type = inferType('Services/my-service.md', {});
      expect(type).toBe('service');
    });

    it('should infer journal type from Journal/ directory', () => {
      const type = inferType('Journal/2024-02-23.md', {});
      expect(type).toBe('journal');
    });

    it('should default to note type for unmatched paths', () => {
      const type = inferType('notes/random.md', {});
      expect(type).toBe('note');
    });

    it('should be case-insensitive for path matching', () => {
      const type = inferType('tasks/my-task.md', {});
      expect(type).toBe('task');
    });

    it('should preserve existing type in frontmatter', () => {
      const type = inferType('Tasks/my-task.md', { type: 'custom' });
      expect(type).toBe('custom');
    });

    it('should use custom config rules if provided', () => {
      const customConfig = {
        rules: [{ pathPattern: 'Custom/', type: 'custom' }],
      };
      const type = inferType('Custom/something.md', {}, customConfig);
      expect(type).toBe('custom');
    });

    it('should infer naming prefix PE for person', () => {
      const type = inferNamingPrefix('PE John Doe');
      expect(type).toBe('person');
    });

    it('should infer naming prefix SV for service', () => {
      const type = inferNamingPrefix('SV My Service');
      expect(type).toBe('service');
    });

    it('should return null for unmatched naming prefix', () => {
      const type = inferNamingPrefix('Random Title');
      expect(type).toBeNull();
    });

    it('should use custom prefix map if provided', () => {
      const prefixMap = { 'XX ': 'custom' };
      const type = inferNamingPrefix('XX Something', prefixMap);
      expect(type).toBe('custom');
    });
  });

  describe('Dataview Converter', () => {
    it('should extract dataview fields from body', () => {
      const body = `Some text
status:: open
due:: 2026-03-01
more text`;
      const fields = extractDataviewFields(body);
      expect(fields).toHaveLength(2);
      expect(fields[0]).toEqual({
        field: 'status',
        value: 'open',
        lineIndex: 1,
      });
      expect(fields[1]).toEqual({
        field: 'due',
        value: '2026-03-01',
        lineIndex: 2,
      });
    });

    it('should not extract invalid field names', () => {
      const body = `Some text
123invalid:: value
_valid:: value`;
      const fields = extractDataviewFields(body);
      expect(fields).toHaveLength(1);
      expect(fields[0].field).toBe('_valid');
    });

    it('should handle fields with special characters in values', () => {
      const body = `status:: [[Link]] with [[stuff]]
note:: some (text) with [brackets]`;
      const fields = extractDataviewFields(body);
      expect(fields).toHaveLength(2);
      expect(fields[0].value).toBe('[[Link]] with [[stuff]]');
      expect(fields[1].value).toBe('some (text) with [brackets]');
    });

    it('should convert dataview fields and remove from body', () => {
      const body = `Line 1
status:: open
Line 3
due:: 2026-03-01
Line 5`;
      const fields = extractDataviewFields(body);
      const { newBody, convertedFields } = convertDataviewFields(body, fields);

      expect(convertedFields).toEqual({
        status: 'open',
        due: '2026-03-01',
      });

      expect(newBody).toBe(`Line 1
Line 3
Line 5`);
    });

    it('should handle empty field list', () => {
      const body = `Some text
more text`;
      const fields: DataviewField[] = [];
      const { newBody, convertedFields } = convertDataviewFields(body, fields);

      expect(newBody).toBe(body);
      expect(convertedFields).toEqual({});
    });

    it('should handle no dataview fields in body', () => {
      const body = `Some text
more text`;
      const fields = extractDataviewFields(body);

      expect(fields).toHaveLength(0);
      const { newBody, convertedFields } = convertDataviewFields(body, fields);
      expect(newBody).toBe(body);
      expect(convertedFields).toEqual({});
    });
  });

  describe('Report Generation', () => {
    it('should create empty report', () => {
      const report = createEmptyReport();

      expect(report.totalFiles).toBe(0);
      expect(report.processed).toBe(0);
      expect(report.noteIdsAdded).toBe(0);
      expect(report.typesAssigned).toBe(0);
      expect(report.dataviewFieldsConverted).toBe(0);
      expect(report.warnings).toHaveLength(0);
      expect(report.errors).toHaveLength(0);
      expect(report.files).toHaveLength(0);
    });

    it('should add file result and update counters', () => {
      const report = createEmptyReport();
      report.totalFiles = 1;

      const fileResult: FileMigrationResult = {
        filePath: 'test.md',
        status: 'ok',
        noteIdAdded: true,
        typeAssigned: 'task',
        dataviewFieldsConverted: ['status', 'due'],
        warnings: ['warning1'],
      };

      addFileResult(report, fileResult);

      expect(report.processed).toBe(1);
      expect(report.noteIdsAdded).toBe(1);
      expect(report.typesAssigned).toBe(1);
      expect(report.dataviewFieldsConverted).toBe(2);
      expect(report.warnings).toContain('warning1');
      expect(report.files).toHaveLength(1);
    });

    it('should format report summary', () => {
      const report = createEmptyReport();
      report.totalFiles = 10;
      report.processed = 9;
      report.noteIdsAdded = 8;
      report.typesAssigned = 9;
      report.dataviewFieldsConverted = 5;

      const summary = formatReportSummary(report);

      expect(summary).toContain('Migration Report Summary');
      expect(summary).toContain('Total files scanned: 10');
      expect(summary).toContain('Successfully processed: 9');
      expect(summary).toContain('Note IDs added: 8');
      expect(summary).toContain('Types assigned: 9');
      expect(summary).toContain('Dataview fields converted: 5');
    });

    it('should format report as markdown', () => {
      const report = createEmptyReport();
      report.totalFiles = 1;
      report.processed = 1;
      report.noteIdsAdded = 1;

      const fileResult: FileMigrationResult = {
        filePath: 'test.md',
        status: 'ok',
        noteIdAdded: true,
        typeAssigned: 'task',
        dataviewFieldsConverted: ['status'],
        warnings: [],
      };

      addFileResult(report, fileResult);

      const markdown = formatReportMarkdown(report);

      expect(markdown).toContain('# Migration Report');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('test.md');
      expect(markdown).toContain('Status: ok');
      expect(markdown).toContain('Type assigned: task');
    });
  });

  describe('Migrator', () => {
    it('should perform dry-run without modifying files', async () => {
      // Create a test file
      const taskDir = join(tmpDir, 'Tasks');
      await fs.mkdir(taskDir, { recursive: true });

      const testFile = join(taskDir, 'test-task.md');
      const originalContent = `---
title: Test Task
---

Some content`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      // Run dry-run migration
      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: true,
      };

      const report = await migrate(config);

      expect(report.totalFiles).toBe(1);
      expect(report.processed).toBe(1);
      expect(report.noteIdsAdded).toBe(1);

      // Verify file was not modified
      const afterContent = await fs.readFile(testFile, 'utf-8');
      expect(afterContent).toBe(originalContent);
    });

    it('should add noteId to files without it', async () => {
      const taskDir = join(tmpDir, 'Tasks');
      await fs.mkdir(taskDir, { recursive: true });

      const testFile = join(taskDir, 'test-task.md');
      const originalContent = `---
title: Test Task
---

Some content`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      // Run migration (not dry-run)
      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      expect(report.processed).toBe(1);
      expect(report.noteIdsAdded).toBe(1);

      // Verify file was modified
      const afterContent = await fs.readFile(testFile, 'utf-8');
      expect(afterContent).not.toBe(originalContent);
      expect(afterContent).toContain('noteId:');
    });

    it('should preserve existing noteId (idempotent)', async () => {
      const taskDir = join(tmpDir, 'Tasks');
      await fs.mkdir(taskDir, { recursive: true });

      const existingId = 'note-123-456';
      const testFile = join(taskDir, 'test-task.md');
      const originalContent = `---
noteId: ${existingId}
title: Test Task
---

Some content`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      // Run migration
      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      // Should skip (status = 'skipped')
      expect(report.files[0].status).toBe('skipped');

      // Verify file still has same ID
      const afterContent = await fs.readFile(testFile, 'utf-8');
      expect(afterContent).toContain(`noteId: ${existingId}`);
    });

    it('should create backup during migration', async () => {
      const taskDir = join(tmpDir, 'Tasks');
      await fs.mkdir(taskDir, { recursive: true });

      const testFile = join(taskDir, 'test-task.md');
      const originalContent = `---
title: Test Task
---

Some content`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      // Run migration
      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      expect(report.processed).toBe(1);

      // Verify backup exists
      const backupPath = join(tmpDir, '.anvil', '.local', 'migration-backup', 'Tasks_test-task.md');
      const backupContent = await fs.readFile(backupPath, 'utf-8');
      expect(backupContent).toBe(originalContent);
    });

    it('should assign type based on path pattern', async () => {
      const taskDir = join(tmpDir, 'Tasks');
      const peopleDir = join(tmpDir, 'People');
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(peopleDir, { recursive: true });

      const taskFile = join(taskDir, 'test.md');
      const personFile = join(peopleDir, 'john.md');

      await fs.writeFile(taskFile, '---\ntitle: Task\n---\nContent', 'utf-8');
      await fs.writeFile(personFile, '---\ntitle: Person\n---\nContent', 'utf-8');

      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      expect(report.typesAssigned).toBe(2);

      // Check task file
      const taskContent = await fs.readFile(taskFile, 'utf-8');
      expect(taskContent).toContain('type: task');

      // Check person file
      const personContent = await fs.readFile(personFile, 'utf-8');
      expect(personContent).toContain('type: person');
    });

    it('should convert dataview fields during migration', async () => {
      const taskDir = join(tmpDir, 'Tasks');
      await fs.mkdir(taskDir, { recursive: true });

      const testFile = join(taskDir, 'test.md');
      const originalContent = `---
title: Task
---

status:: open
due:: 2026-03-01

Body content`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      expect(report.dataviewFieldsConverted).toBe(2);

      // Check that fields were moved to frontmatter
      const afterContent = await fs.readFile(testFile, 'utf-8');
      expect(afterContent).toContain('status:');
      expect(afterContent).toContain('open');
      expect(afterContent).toContain('due:');
      expect(afterContent).toContain('2026-03-01');
      // Body should not contain the inline fields
      expect(afterContent).not.toContain('status::');
      expect(afterContent).not.toContain('due::');
    });

    it('should be idempotent when running migration twice', async () => {
      const taskDir = join(tmpDir, 'Tasks');
      await fs.mkdir(taskDir, { recursive: true });

      const testFile = join(taskDir, 'test.md');
      const originalContent = `---
title: Task
---

Content`;

      await fs.writeFile(testFile, originalContent, 'utf-8');

      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      // First migration
      const report1 = await migrate(config);
      expect(report1.noteIdsAdded).toBe(1);

      // Read noteId from first migration
      const afterFirstMigration = await fs.readFile(testFile, 'utf-8');
      const noteIdMatch = afterFirstMigration.match(/noteId: ([a-f0-9-]+)/);
      const firstNoteId = noteIdMatch ? noteIdMatch[1] : null;

      // Second migration
      const report2 = await migrate(config);
      expect(report2.noteIdsAdded).toBe(0); // Should not add again
      expect(report2.files[0].status).toBe('skipped');

      // Verify same noteId
      const afterSecondMigration = await fs.readFile(testFile, 'utf-8');
      expect(afterSecondMigration).toContain(`noteId: ${firstNoteId}`);
    });

    it('should handle multiple files in different directories', async () => {
      // Create structure with multiple files
      const taskDir = join(tmpDir, 'Tasks');
      const peopleDir = join(tmpDir, 'People');
      const notesDir = join(tmpDir, 'notes');

      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(peopleDir, { recursive: true });
      await fs.mkdir(notesDir, { recursive: true });

      await fs.writeFile(join(taskDir, 'task1.md'), '---\ntitle: Task 1\n---\nContent', 'utf-8');
      await fs.writeFile(join(taskDir, 'task2.md'), '---\ntitle: Task 2\n---\nContent', 'utf-8');
      await fs.writeFile(join(peopleDir, 'john.md'), '---\ntitle: John\n---\nContent', 'utf-8');
      await fs.writeFile(join(notesDir, 'random.md'), '---\ntitle: Note\n---\nContent', 'utf-8');

      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      expect(report.totalFiles).toBe(4);
      expect(report.processed).toBe(4);
      expect(report.noteIdsAdded).toBe(4);
      expect(report.typesAssigned).toBe(4);

      // Verify all files have noteId and correct types
      const task1 = await fs.readFile(join(taskDir, 'task1.md'), 'utf-8');
      expect(task1).toContain('noteId:');
      expect(task1).toContain('type: task');

      const john = await fs.readFile(join(peopleDir, 'john.md'), 'utf-8');
      expect(john).toContain('noteId:');
      expect(john).toContain('type: person');

      const note = await fs.readFile(join(notesDir, 'random.md'), 'utf-8');
      expect(note).toContain('noteId:');
      expect(note).toContain('type: note');
    });

    it('should skip .anvil/.local directory during migration', async () => {
      // Create structure with .anvil/.local directory (matching ignore patterns)
      const anvilDir = join(tmpDir, '.anvil', '.local');
      const taskDir = join(tmpDir, 'Tasks');

      await fs.mkdir(anvilDir, { recursive: true });
      await fs.mkdir(taskDir, { recursive: true });

      await fs.writeFile(
        join(anvilDir, 'ignored.md'),
        '---\ntitle: Ignored\n---\nContent',
        'utf-8',
      );
      await fs.writeFile(join(taskDir, 'task.md'), '---\ntitle: Task\n---\nContent', 'utf-8');

      const config: MigrationConfig = {
        vaultPath: tmpDir,
        dryRun: false,
      };

      const report = await migrate(config);

      // Should only process the task file, not the one in .anvil/.local
      expect(report.totalFiles).toBe(1);
      expect(report.processed).toBe(1);
    });
  });
});
