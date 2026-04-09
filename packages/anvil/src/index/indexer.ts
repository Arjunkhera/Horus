import type { AnvilDb } from './sqlite.js';
import type { Note, NoteMetadata, Relationship } from '../types/index.js';
import { extractWikiLinks, parseWikiLinkText } from '../storage/wiki-links.js';
import { parseWikiLink } from '../types/note.js';

/**
 * Ensure type exists in the types table (for foreign key constraint)
 */
function ensureTypeExists(db: AnvilDb, typeId: string): void {
  const existing = db.getOne('SELECT type_id FROM types WHERE type_id = ?', [typeId]);
  if (!existing) {
    db.run(
      `INSERT INTO types (type_id, name, schema_json, updated_at) VALUES (?, ?, ?, ?)`,
      [typeId, typeId, '{}', new Date().toISOString()]
    );
  }
}

/**
 * Upsert a note into the database within a single transaction.
 * This includes:
 * 1. Upsert into notes table
 * 2. Sync note_tags table
 * 3. Sync relationships table
 * 4. Forward reference reconciliation
 */
export function upsertNote(db: AnvilDb, note: Note): void {
  db.transaction(() => {
    upsertNoteInternal(db, note);
  });
  db.save();
}

/**
 * Delete a note and update related data.
 * 1. Set target_id = NULL in relationships where target_id = noteId (preserve forward ref)
 * 2. Delete from notes (cascade deletes tags and relationships where source_id = noteId)
 * 3. Optimize after deletion
 */
export function deleteNote(db: AnvilDb, noteId: string): void {
  db.transaction(() => {
    // Step 1: Set target_id = NULL in relationships where target_id = noteId
    db.run(`UPDATE relationships SET target_id = NULL WHERE target_id = ?`, [noteId]);

    // Step 2: Delete from notes (cascade deletes tags and relationships)
    db.run('DELETE FROM notes WHERE note_id = ?', [noteId]);

    // Step 3: Optimize after deletion
    db.exec('PRAGMA optimize;');
  });
  db.save();
}

/**
 * Full rebuild within a single transaction.
 * 1. DELETE all notes (cascade deletes tags, relationships)
 * 2. Upsert all notes one by one
 */
export function fullRebuild(db: AnvilDb, notes: Note[]): void {
  db.transaction(() => {
    // Step 1: Delete all notes
    db.run('DELETE FROM notes', []);

    // Step 2: Upsert all notes one by one (within the same transaction)
    for (const note of notes) {
      upsertNoteInternal(db, note);
    }
  });
  db.save();
}

/**
 * Internal upsert function for use within transactions (doesn't create its own transaction or save)
 */
function upsertNoteInternal(db: AnvilDb, note: Note): void {
  // Ensure type exists for foreign key constraint
  ensureTypeExists(db, note.type);

  // Upsert into notes table
  const archived = note.fields?.archived ? 1 : 0;
  const pinned = note.fields?.pinned ? 1 : 0;

  db.run(
    `INSERT OR REPLACE INTO notes (
      note_id, type, title, description, file_path, created, modified,
      archived, pinned, scope_context, scope_team, scope_service,
      status, priority, due, effort, recurrence, last_swept_at, body_text
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note.noteId,
      note.type,
      note.title,
      note.fields?.description || null,
      note.filePath,
      note.created,
      note.modified,
      archived,
      pinned,
      note.scope?.context || null,
      note.scope?.team || null,
      note.scope?.service || null,
      note.status || null,
      note.priority || null,
      note.due || null,
      note.effort || null,
      note.fields?.recurrence || null,
      note.fields?.last_swept_at || null,
      note.body,
    ]
  );

  // Sync note_tags table
  db.run('DELETE FROM note_tags WHERE note_id = ?', [note.noteId]);

  if (note.tags && note.tags.length > 0) {
    for (const tag of note.tags) {
      db.run(`INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)`, [note.noteId, tag]);
    }
  }

  // Sync relationships table
  db.run('DELETE FROM relationships WHERE source_id = ?', [note.noteId]);

  const relationshipsToInsert: Array<{
    targetTitle: string;
    relationType: string;
  }> = [];

  // Insert explicit 'related' entries
  if (note.related && note.related.length > 0) {
    for (const relStr of note.related) {
      const targetTitle = parseWikiLink(relStr);
      if (targetTitle) {
        relationshipsToInsert.push({ targetTitle, relationType: 'related' });
      }
    }
  }

  // Extract body wiki-links as 'mentions' relationships
  const bodyLinks = extractWikiLinks(note.body);
  for (const linkTitle of bodyLinks) {
    relationshipsToInsert.push({ targetTitle: linkTitle, relationType: 'mentions' });
  }

  // Extract typed reference relationships from fields
  for (const [fieldName, fieldValue] of Object.entries(note.fields || {})) {
    if (fieldValue && typeof fieldValue === 'string') {
      const parsedTarget = parseWikiLink(fieldValue);
      if (parsedTarget) {
        relationshipsToInsert.push({ targetTitle: parsedTarget, relationType: fieldName });
      }
    }
  }

  // For each relationship, try to resolve target_id
  for (const rel of relationshipsToInsert) {
    const targetIdRow = db.getOne<{ note_id: string }>(
      'SELECT note_id FROM notes WHERE title = ? LIMIT 1',
      [rel.targetTitle]
    );
    const targetId = targetIdRow?.note_id || null;

    db.run(
      `INSERT OR IGNORE INTO relationships (source_id, target_id, target_title, relation_type)
       VALUES (?, ?, ?, ?)`,
      [note.noteId, targetId, rel.targetTitle, rel.relationType]
    );
  }

  // Forward reference reconciliation
  db.run(
    `UPDATE relationships SET target_id = ? WHERE target_id IS NULL AND target_title = ?`,
    [note.noteId, note.title]
  );
}

/**
 * Get a note's metadata by ID
 */
export function getNote(
  db: AnvilDb,
  noteId: string
): NoteMetadata | null {
  const row = db.getOne<any>(
    `SELECT
      note_id as noteId, type, title, created, modified,
      status, priority, due, effort,
      scope_context as scopeContext, scope_team as scopeTeam, scope_service as scopeService,
      description
    FROM notes
    WHERE note_id = ?`,
    [noteId]
  );

  if (!row) return null;

  const tagRows = db.getAll<{ tag: string }>(
    'SELECT tag FROM note_tags WHERE note_id = ?',
    [noteId]
  );
  const tags = tagRows.map((r) => r.tag);

  const relatedRows = db.getAll<{ target_title: string }>(
    `SELECT target_title FROM relationships WHERE source_id = ? AND relation_type = 'related'`,
    [noteId]
  );
  const related = relatedRows.map((r) => `[[${r.target_title}]]`);

  return {
    noteId: row.noteId,
    type: row.type,
    title: row.title,
    created: row.created,
    modified: row.modified,
    tags,
    related,
    status: row.status !== null ? row.status : undefined,
    priority: row.priority !== null ? row.priority : undefined,
    due: row.due !== null ? row.due : undefined,
    effort: row.effort !== null ? row.effort : undefined,
    scope: row.scopeContext || row.scopeTeam || row.scopeService
      ? {
          context: row.scopeContext || undefined,
          team: row.scopeTeam || undefined,
          service: row.scopeService || undefined,
        }
      : undefined,
    fields: {},
  };
}

/**
 * Get forward relationships (relationships where this note is the source)
 */
export function getForwardRelationships(
  db: AnvilDb,
  noteId: string
): Relationship[] {
  const rows = db.getAll<{
    sourceId: string;
    targetId: string | null;
    targetTitle: string;
    relationType: string;
  }>(
    `SELECT source_id as sourceId, target_id as targetId, target_title as targetTitle, relation_type as relationType
     FROM relationships
     WHERE source_id = ?`,
    [noteId]
  );

  return rows.map((row) => ({
    sourceId: row.sourceId,
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    relationType: row.relationType,
    resolved: row.targetId !== null,
  }));
}

/**
 * Get reverse relationships (relationships where this note is the target)
 */
export function getReverseRelationships(
  db: AnvilDb,
  noteId: string
): Relationship[] {
  const rows = db.getAll<{
    sourceId: string;
    targetId: string | null;
    targetTitle: string;
    relationType: string;
  }>(
    `SELECT source_id as sourceId, target_id as targetId, target_title as targetTitle, relation_type as relationType
     FROM relationships
     WHERE target_id = ?`,
    [noteId]
  );

  return rows.map((row) => ({
    sourceId: row.sourceId,
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    relationType: row.relationType,
    resolved: row.targetId !== null,
  }));
}

/**
 * Get all indexed note paths and their metadata for startup catchup
 */
export function getAllNotePaths(
  db: AnvilDb
): Array<{ noteId: string; filePath: string; modified: string }> {
  return db.getAll<{ noteId: string; filePath: string; modified: string }>(
    `SELECT note_id as noteId, file_path as filePath, modified FROM notes`
  );
}
