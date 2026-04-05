// Core note types — identity, metadata, relationships, content

/** How a note reference was established */
export type RelationType = string; // 'related', 'mentions', or a typed field name like 'assignee', 'project'

/** A directional link between notes, stored in the relationships table */
export type Relationship = {
  sourceId: string;
  /** NULL when target note doesn't exist yet (forward reference) */
  targetId: string | null;
  /** The original wiki-link text used to identify the target */
  targetTitle: string;
  relationType: RelationType;
  resolved: boolean;
};

/** Optional context/team/service scoping on any note */
export type Scope = {
  context?: 'personal' | 'work';
  team?: string;
  service?: string;
};

/**
 * All frontmatter fields of a note.
 * Core fields are always present; type-specific fields live in `fields`.
 */
export type NoteMetadata = {
  noteId: string;
  type: string;
  title: string;
  created: string;  // ISO datetime
  modified: string; // ISO datetime
  tags: string[];
  related: string[]; // wiki-link strings e.g. ["[[Other Note]]"]
  scope?: Scope;

  // Common typed fields (nullable — present when type warrants)
  status?: string;
  priority?: string;
  due?: string;
  effort?: number;

  // Type-specific extra fields
  fields: Record<string, unknown>;
};

/** Full note including body text and filesystem path */
export type Note = NoteMetadata & {
  body: string;
  filePath: string;
};

/** Note enriched with bidirectional relationship data */
export type NoteWithRelationships = Note & {
  relationships: {
    /** Relationships where this note is the source */
    forward: Relationship[];
    /** Relationships where this note is the target */
    reverse: Relationship[];
  };
};

/** Lightweight summary used in list/search results */
export type NoteSummary = {
  noteId: string;
  type: string;
  title: string;
  status?: string;
  priority?: string;
  due?: string;
  tags: string[];
  modified: string;
  filePath: string;
};

// --- Type guards ---

export function isNote(value: unknown): value is Note {
  return (
    typeof value === 'object' &&
    value !== null &&
    'noteId' in value &&
    'type' in value &&
    'title' in value &&
    'body' in value &&
    'filePath' in value
  );
}

export function isNoteMetadata(value: unknown): value is NoteMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    'noteId' in value &&
    'type' in value &&
    'title' in value
  );
}

/**
 * Parse a wiki-link string into the note title it references.
 * "[[My Note]]" → "My Note"
 * "[[My Note|Display Text]]" → "My Note"
 */
export function parseWikiLink(link: string): string | null {
  const match = link.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  return match ? match[1].trim() : null;
}

/**
 * Format a note title as a wiki-link string.
 * "My Note" → "[[My Note]]"
 */
export function toWikiLink(title: string): string {
  return `[[${title}]]`;
}
