// Unit tests for anvil_delete_note tool

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { AnvilDatabase, type AnvilDb } from '../../src/index/sqlite.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import { upsertNote } from '../../src/index/indexer.js';
import { handleDeleteNote } from '../../src/tools/delete-note.js';
import type { ToolContext } from '../../src/tools/create-note.js';
import type { Note } from '../../src/types/note.js';

const mkdtempAsync = promisify(mkdtemp);

function makeNote(filePath: string, noteId = 'test-note-id-1234'): Note {
  return {
    noteId,
    type: 'note',
    title: 'Test Note',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    tags: [],
    related: [],
    body: 'Test body',
    filePath,
    fields: {},
  };
}

describe('handleDeleteNote', () => {
  let tmpDir: string;
  let anvilDb: AnvilDatabase;
  let db: AnvilDb;
  let ctx: ToolContext;

  beforeEach(async () => {
    tmpDir = await mkdtempAsync(join(tmpdir(), 'anvil-delete-test-'));
    anvilDb = AnvilDatabase.create(':memory:');
    db = anvilDb.raw;
    const registry = new TypeRegistry();

    ctx = {
      vaultPath: tmpDir,
      registry,
      db: anvilDb,
    } as unknown as ToolContext;
  });

  afterEach(async () => {
    try {
      anvilDb.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('deletes backing file and index entry when note exists (force: false)', async () => {
    const filePath = join(tmpDir, 'test-note.md');
    await fs.writeFile(filePath, '# Test', 'utf-8');
    const note = makeNote(filePath);
    upsertNote(db, note);

    const result = await handleDeleteNote({ noteId: note.noteId }, ctx);

    expect(result).toEqual({ noteId: note.noteId, deleted: true });

    // File should be gone
    await expect(fs.access(filePath)).rejects.toThrow();

    // Index entry should be gone
    const row = db.getOne('SELECT note_id FROM notes WHERE note_id = ?', [note.noteId]);
    expect(row).toBeNull();
  });

  it('returns NOT_FOUND when noteId is not in the index (force: false)', async () => {
    const result = await handleDeleteNote({ noteId: 'nonexistent-id', force: false }, ctx);

    expect(result).toMatchObject({ error: true, code: 'NOT_FOUND' });
  });

  it('returns NOT_FOUND when note is indexed but backing file is missing (force: false)', async () => {
    const filePath = join(tmpDir, 'already-deleted.md');
    // Index the note without creating the file
    const note = makeNote(filePath);
    upsertNote(db, note);

    const result = await handleDeleteNote({ noteId: note.noteId, force: false }, ctx);

    expect(result).toMatchObject({ error: true, code: 'NOT_FOUND' });
    // Index entry should still be there (delete was rejected)
    const row = db.getOne('SELECT note_id FROM notes WHERE note_id = ?', [note.noteId]);
    expect(row).not.toBeNull();
  });

  it('removes orphaned index entry when backing file is missing (force: true)', async () => {
    const filePath = join(tmpDir, 'orphaned-note.md');
    // Index the note without creating the file — simulates the orphan scenario
    const note = makeNote(filePath);
    upsertNote(db, note);

    const result = await handleDeleteNote({ noteId: note.noteId, force: true }, ctx);

    expect(result).toEqual({ noteId: note.noteId, deleted: true });

    // Index entry should be gone
    const row = db.getOne('SELECT note_id FROM notes WHERE note_id = ?', [note.noteId]);
    expect(row).toBeNull();
  });

  it('succeeds silently when noteId is unknown (force: true)', async () => {
    const result = await handleDeleteNote({ noteId: 'totally-unknown-id', force: true }, ctx);

    expect(result).toEqual({ noteId: 'totally-unknown-id', deleted: true });
  });
});
