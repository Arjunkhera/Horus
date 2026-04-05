-- Schema version tracking
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '1');

-- Type registry cache (from .anvil/types/*.yaml)
CREATE TABLE IF NOT EXISTS types (
  type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  template_json TEXT,
  updated_at TEXT NOT NULL
);

-- Core notes table
CREATE TABLE IF NOT EXISTS notes (
  note_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT UNIQUE NOT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  archived INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  scope_context TEXT,
  scope_team TEXT,
  scope_service TEXT,
  status TEXT,
  priority TEXT,
  due TEXT,
  effort INTEGER,
  body_text TEXT,
  FOREIGN KEY (type) REFERENCES types(type_id) ON DELETE SET NULL
);

-- Tags (normalized, one row per tag per note)
CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag),
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE
);

-- Bidirectional relationships
CREATE TABLE IF NOT EXISTS relationships (
  source_id TEXT NOT NULL,
  target_id TEXT,
  target_title TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  PRIMARY KEY (source_id, target_title, relation_type),
  FOREIGN KEY (source_id) REFERENCES notes(note_id) ON DELETE CASCADE
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_due ON notes(due);
CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified);
CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
