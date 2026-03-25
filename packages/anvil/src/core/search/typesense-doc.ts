// Utilities for mapping Anvil Note objects to horus_documents Typesense documents

import type { TypesenseClient } from '@horus/search';
import type { Note } from '../../types/note.js';

const BODY_TRUNCATE_CHARS = 20_000;

/** Extract UUID from a wiki-link string like [[uuid]] */
function extractWikiLinkId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.match(/\[\[([^\]]+)\]\]/);
  return m?.[1];
}

export interface AnvilDocument {
  id: string;
  source: 'anvil';
  source_type: string;
  title: string;
  body: string;
  tags: string[];
  status?: string;
  priority?: string;
  project_id?: string;
  created_at: number;
  modified_at: number;
}

/**
 * Map an Anvil Note to a horus_documents Typesense document.
 */
export function buildAnvilDocument(note: Note): AnvilDocument {
  const doc: AnvilDocument = {
    id: note.noteId,
    source: 'anvil',
    source_type: note.type,
    title: note.title,
    body: note.body ? note.body.slice(0, BODY_TRUNCATE_CHARS) : '',
    tags: note.tags ?? [],
    created_at: Math.floor(new Date(note.created).getTime() / 1000),
    modified_at: Math.floor(new Date(note.modified).getTime() / 1000),
  };

  if (note.status) doc.status = note.status;
  if (note.priority) doc.priority = note.priority;

  const projectRef = note.fields?.project;
  const projectId = extractWikiLinkId(projectRef);
  if (projectId) doc.project_id = projectId;

  return doc;
}

/**
 * Push a note to Typesense. Fire-and-forget — logs errors but never throws.
 */
export async function pushToTypesense(
  client: TypesenseClient,
  note: Note,
): Promise<void> {
  try {
    await client
      .collections('horus_documents')
      .documents()
      .upsert(buildAnvilDocument(note) as unknown as Record<string, unknown>);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        message: `Typesense upsert failed for note ${note.noteId}: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}

/**
 * Delete a note from Typesense by ID. Fire-and-forget — logs errors but never throws.
 */
export async function deleteFromTypesense(
  client: TypesenseClient,
  noteId: string,
): Promise<void> {
  try {
    await client.collections('horus_documents').documents(noteId).delete();
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        message: `Typesense delete failed for note ${noteId}: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}
