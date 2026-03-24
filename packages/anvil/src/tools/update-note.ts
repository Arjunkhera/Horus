// Handler for anvil_update_note tool

import type {
  UpdateNoteInput,
  UpdateNoteOutput,
  AnvilError,
  Note,
} from '../types/index.js';
import { makeError, ERROR_CODES } from '../types/index.js';
import { readNote, writeNote } from '../storage/file-store.js';
import { getNote, upsertNote } from '../index/indexer.js';
import { validateNote } from '../registry/validator.js';
import type { ToolContext } from './create-note.js';
import { pushToTypesense } from '../core/search/typesense-doc.js';

/**
 * Handle anvil_update_note request.
 * Updates a note with PATCH semantics, respecting append_only and immutable constraints.
 */
export async function handleUpdateNote(
  input: UpdateNoteInput,
  ctx: ToolContext
): Promise<UpdateNoteOutput | AnvilError> {
  try {
    // 1. Look up note in SQLite to get filePath
    const noteMetadata = getNote(ctx.db.raw, input.noteId);
    if (!noteMetadata) {
      return makeError(
        ERROR_CODES.NOT_FOUND,
        `Note not found: ${input.noteId}`
      );
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

    // 2. Read existing note from filesystem
    const readResult = await readNote(noteRow.file_path);
    if ('error' in readResult) {
      return readResult;
    }

    const { note: existingNote } = readResult;

    // Get the type definition
    const type = ctx.registry.getType(existingNote.type);
    if (!type) {
      return makeError(
        ERROR_CODES.TYPE_NOT_FOUND,
        `Type not found: ${existingNote.type}`
      );
    }

    // 3. Check append_only constraint
    if (
      type.behaviors.append_only &&
      input.content &&
      input.content.trim() !== existingNote.body.trim()
    ) {
      // Check if it's actually a replacement vs append
      if (!existingNote.body.includes(input.content)) {
        return makeError(
          ERROR_CODES.APPEND_ONLY,
          `Type ${existingNote.type} has append_only behavior: body can only be appended, not replaced`
        );
      }
    }

    // 4. Check immutable fields
    const immutableFields = new Set(['noteId', 'created']);
    if (input.fields) {
      for (const fieldName of immutableFields) {
        if (fieldName in input.fields) {
          const immutableDef = type.fields[fieldName];
          if (immutableDef?.immutable) {
            const newValue = input.fields[fieldName];
            const oldValue = (existingNote as any)[fieldName];
            if (newValue !== oldValue) {
              return makeError(
                ERROR_CODES.IMMUTABLE_FIELD,
                `Field is immutable and cannot be changed: ${fieldName}`
              );
            }
          }
        }
      }
    }

    // 5. Merge updates (PATCH semantics)
    const updatedNote: Note = {
      ...existingNote,
    };

    // Update provided fields
    if (input.fields) {
      // Update standard fields
      for (const [key, value] of Object.entries(input.fields)) {
        if (
          ['title', 'status', 'priority', 'due', 'effort', 'tags', 'related', 'scope'].includes(
            key
          )
        ) {
          (updatedNote as any)[key] = value;
        }
      }
      // Update type-specific fields
      Object.assign(updatedNote.fields, input.fields);
    }

    // Always update modified timestamp
    const now = new Date().toISOString();
    updatedNote.modified = now;

    // Handle body content
    if (input.content !== undefined) {
      if (type.behaviors.append_only) {
        // Append mode
        if (updatedNote.body && !updatedNote.body.endsWith('\n')) {
          updatedNote.body += '\n';
        }
        updatedNote.body += input.content;
      } else {
        // Replace mode
        updatedNote.body = input.content;
      }
    }

    // 6. Validate merged note against type schema (strict mode)
    const frontmatter: Record<string, unknown> = {
      noteId: updatedNote.noteId,
      type: updatedNote.type,
      title: updatedNote.title,
      created: updatedNote.created,
      modified: updatedNote.modified,
      tags: updatedNote.tags,
      related: updatedNote.related,
    };

    if (updatedNote.scope) {
      frontmatter.scope = updatedNote.scope;
    }
    if (updatedNote.status) {
      frontmatter.status = updatedNote.status;
    }
    if (updatedNote.priority) {
      frontmatter.priority = updatedNote.priority;
    }
    if (updatedNote.due) {
      frontmatter.due = updatedNote.due;
    }
    if (updatedNote.effort !== undefined) {
      frontmatter.effort = updatedNote.effort;
    }

    Object.assign(frontmatter, updatedNote.fields);

    const validation = validateNote(frontmatter, type, 'strict');
    if (!validation.valid) {
      const fieldErrors = validation.errors.map((e) => ({
        field: e.field,
        message: e.message,
        allowed_values: e.allowed_values,
      }));
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Note validation failed`,
        { fields: fieldErrors }
      );
    }

    // 7. Write updated note to filesystem
    try {
      await writeNote(updatedNote);
    } catch (err) {
      return makeError(
        ERROR_CODES.IO_ERROR,
        `Failed to write note: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // 8. Re-index note
    try {
      upsertNote(ctx.db.raw, updatedNote);
    } catch (err) {
      return makeError(
        ERROR_CODES.SERVER_ERROR,
        `Failed to update index: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // 9. Push to Typesense (fire-and-forget)
    if (ctx.typesenseClient) {
      void pushToTypesense(ctx.typesenseClient, updatedNote);
    }

    // 10. Return result with list of changed fields
    const changedFields: string[] = [];

    // Check which fields changed
    if (input.fields) {
      changedFields.push(...Object.keys(input.fields));
    }
    if (input.content !== undefined) {
      changedFields.push('body');
    }
    // modified always changes
    if (!changedFields.includes('modified')) {
      changedFields.push('modified');
    }

    return {
      noteId: input.noteId,
      updatedFields: changedFields,
    };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error updating note: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
