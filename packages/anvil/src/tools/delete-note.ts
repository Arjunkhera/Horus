// Handler for anvil_delete_note tool

import { promises as fs } from 'node:fs';
import type { AnvilError } from '../types/index.js';
import { makeError, ERROR_CODES } from '../types/index.js';
import { deleteNote } from '../index/indexer.js';
import { deleteFromTypesense } from '../core/search/typesense-doc.js';
import type { ToolContext } from './create-note.js';

export type DeleteNoteInput = {
  noteId: string;
  force?: boolean;
};

export type DeleteNoteOutput = {
  noteId: string;
  deleted: boolean;
};

/**
 * Handle anvil_delete_note request.
 *
 * Default (force: false): deletes the backing file then removes the index entry.
 * Returns NOT_FOUND if the note or its file is missing.
 *
 * force: true: escape hatch for orphaned index entries whose backing file is gone.
 * Removes the index entry regardless; swallows ENOENT on file deletion.
 * Succeeds even if the noteId is not in the index (pure no-op).
 */
export async function handleDeleteNote(
  input: DeleteNoteInput,
  ctx: ToolContext
): Promise<DeleteNoteOutput | AnvilError> {
  const force = input.force ?? false;

  try {
    // Look up the note to get its backing file path.
    const noteRow = ctx.db.raw.getOne<{ file_path: string }>(
      'SELECT file_path FROM notes WHERE note_id = ?',
      [input.noteId]
    );

    if (!noteRow) {
      if (force) {
        // Nothing in the index — already clean. Succeed silently.
        return { noteId: input.noteId, deleted: true };
      }
      return makeError(ERROR_CODES.NOT_FOUND, `Note not found: ${input.noteId}`);
    }

    // Attempt to delete the backing file.
    try {
      await fs.unlink(noteRow.file_path);
    } catch (err) {
      const isEnoent = err instanceof Error && 'code' in err && err.code === 'ENOENT';
      if (isEnoent && force) {
        // File already gone — that's fine, proceed to clean up the index entry.
      } else if (isEnoent) {
        return makeError(
          ERROR_CODES.NOT_FOUND,
          `Backing file missing for note ${input.noteId}: ${noteRow.file_path}. Use force=true to remove the orphaned index entry.`
        );
      } else {
        throw err;
      }
    }

    // Remove from SQLite index.
    deleteNote(ctx.db.raw, input.noteId);

    // Remove from Typesense (fire-and-forget — already swallows errors internally).
    if (ctx.typesenseClient) {
      void deleteFromTypesense(ctx.typesenseClient, input.noteId);
    }

    return { noteId: input.noteId, deleted: true };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Failed to delete note: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
