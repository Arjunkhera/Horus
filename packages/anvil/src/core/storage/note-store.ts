// Note storage abstraction wrapping file-store and indexer

import type { AnvilDb } from '../../index/sqlite.js';
import type { Note } from '../../types/note.js';
import {
  readNote,
  writeNote,
  generateFilePath,
  deleteFile,
} from '../../storage/file-store.js';
import {
  upsertNote,
  deleteNote,
  getNote,
  getForwardRelationships,
  getReverseRelationships,
} from '../../index/indexer.js';

/**
 * NoteStore wraps file-store and indexer operations into a cohesive API.
 * All write operations are atomic - updates to both filesystem and database.
 */
export class NoteStore {
  constructor(private db: AnvilDb, private vaultPath: string) {}

  /**
   * Create a new note: write to filesystem and index in database
   */
  async create(note: Note): Promise<void> {
    // Write to filesystem
    await writeNote(note);

    // Index in database
    upsertNote(this.db, note);
  }

  /**
   * Retrieve a note by ID from filesystem
   */
  async get(noteId: string): Promise<Note | null> {
    // Get note metadata from database
    const result = getNote(this.db, noteId);
    if (!result) {
      return null;
    }

    // Read full note from filesystem
    const filePath = (result as any).file_path || (result as any).filePath;
    const readResult = await readNote(filePath);
    if ('error' in readResult) {
      return null;
    }

    return readResult.note;
  }

  /**
   * Update a note: write to filesystem and re-index
   */
  async update(note: Note): Promise<void> {
    // Write to filesystem
    await writeNote(note);

    // Re-index in database
    upsertNote(this.db, note);
  }

  /**
   * Delete a note: remove from filesystem and database
   */
  async delete(noteId: string): Promise<void> {
    // Get file path from database
    const result = getNote(this.db, noteId);
    if (result) {
      // Delete from filesystem
      const filePath = (result as any).file_path || (result as any).filePath;
      await deleteFile(filePath);
    }

    // Delete from database (cascade deletes relationships and tags)
    deleteNote(this.db, noteId);
  }

  /**
   * Get forward and reverse relationships for a note
   */
  async getRelated(noteId: string): Promise<{
    forward: any[];
    reverse: any[];
  }> {
    const forward = getForwardRelationships(this.db, noteId) || [];
    const reverse = getReverseRelationships(this.db, noteId) || [];

    return { forward, reverse };
  }

  /**
   * Generate a file path for a new note
   */
  async generateFilePath(
    title: string,
    type: string
  ): Promise<string> {
    return generateFilePath(this.vaultPath, title, type, 'flat');
  }
}
