// Handler for anvil_get_note tool

import type {
  GetNoteInput,
  NoteWithRelationships,
  AnvilError,
} from '../types/index.js';
import { makeError, ERROR_CODES } from '../types/index.js';
import { readNote, findNoteOnDisk } from '../storage/file-store.js';
import { getNote, upsertNote, getForwardRelationships, getReverseRelationships } from '../index/indexer.js';
import type { ToolContext } from './create-note.js';

/**
 * Handle anvil_get_note request.
 * Retrieves a note by ID with full content, relationships, and metadata.
 */
export async function handleGetNote(
  input: GetNoteInput,
  ctx: ToolContext
): Promise<NoteWithRelationships | AnvilError> {
  try {
    // 1. Look up note in SQLite to get filePath.
    // If the index misses it (e.g. post-restart before catchup completes or after
    // an unclean shutdown), fall back to a vault scan and re-index on the fly.
    let noteMetadata = getNote(ctx.db.raw, input.noteId);
    if (!noteMetadata) {
      const diskResult = await findNoteOnDisk(ctx.vaultPath, input.noteId);
      if (!diskResult || 'error' in diskResult) {
        return makeError(
          ERROR_CODES.NOT_FOUND,
          `Note not found: ${input.noteId}`
        );
      }
      upsertNote(ctx.db.raw, diskResult.note);
      noteMetadata = getNote(ctx.db.raw, input.noteId);
      if (!noteMetadata) {
        return makeError(
          ERROR_CODES.NOT_FOUND,
          `Note not found: ${input.noteId}`
        );
      }
    }

    const noteRow = ctx.db.raw.getOne<{ file_path: string }>(
      `SELECT file_path FROM notes WHERE note_id = ?`,
      [input.noteId]
    );

    if (!noteRow) {
      return makeError(
        ERROR_CODES.NOT_FOUND,
        `Note not found: ${input.noteId}`
      );
    }

    // 2. Read file from filesystem
    const readResult = await readNote(noteRow.file_path);
    if ('error' in readResult) {
      return readResult;
    }

    const { note } = readResult;

    // 3. Get forward relationships
    const forward = getForwardRelationships(ctx.db.raw, input.noteId);

    // 4. Get reverse relationships
    const reverse = getReverseRelationships(ctx.db.raw, input.noteId);

    // 5. Return full note with relationships
    return {
      ...note,
      relationships: {
        forward,
        reverse,
      },
    };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error retrieving note: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
