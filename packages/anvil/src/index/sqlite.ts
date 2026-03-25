import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResolvedType } from '../types/index.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS types (
  type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  template_json TEXT,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag),
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationships (
  source_id TEXT NOT NULL,
  target_id TEXT,
  target_title TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  PRIMARY KEY (source_id, target_title, relation_type),
  FOREIGN KEY (source_id) REFERENCES notes(note_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_due ON notes(due);
CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified);
CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
`;

const _require = createRequire(import.meta.url);
const { Database } = _require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
type SqliteDatabase = InstanceType<typeof Database>;

/**
 * Thin wrapper around node-sqlite3-wasm providing a consistent query interface.
 * Replaces better-sqlite3 to eliminate native binary dependencies.
 * node-sqlite3-wasm is a WASM SQLite build with synchronous API and file persistence.
 */
export class AnvilDb {
  private sqlDb: SqliteDatabase;

  constructor(sqlDb: SqliteDatabase) {
    this.sqlDb = sqlDb;
  }

  /** Execute a write statement (INSERT, UPDATE, DELETE, PRAGMA) */
  run(sql: string, params?: any[]): void {
    this.sqlDb.run(sql, params);
  }

  /** Execute a SELECT and return the first row, or null */
  getOne<T = any>(sql: string, params?: any[]): T | null {
    const result = this.sqlDb.get(sql, params) as T | undefined;
    return result ?? null;
  }

  /** Execute a SELECT and return all rows */
  getAll<T = any>(sql: string, params?: any[]): T[] {
    return this.sqlDb.all(sql, params) as T[];
  }

  /** Execute one or more statements with no parameters (migrations, DDL) */
  exec(sql: string): void {
    this.sqlDb.exec(sql);
  }

  /** Execute fn inside a BEGIN/COMMIT transaction; rolls back on error */
  transaction<T>(fn: () => T): T {
    this.sqlDb.run('BEGIN');
    try {
      const result = fn();
      this.sqlDb.run('COMMIT');
      return result;
    } catch (err) {
      this.sqlDb.run('ROLLBACK');
      throw err;
    }
  }

  /** No-op: node-sqlite3-wasm persists to disk automatically */
  save(): void {}

  close(): void {
    this.sqlDb.close();
  }
}

export class AnvilDatabase {
  private _db: AnvilDb;

  private constructor(db: AnvilDb) {
    this._db = db;
  }

  /** Synchronous factory */
  static create(dbPath: string): AnvilDatabase {
    const isMemory = dbPath === ':memory:';

    let sqlDb: SqliteDatabase;
    if (isMemory) {
      sqlDb = new Database();
    } else {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      sqlDb = new Database(dbPath);
    }

    const db = new AnvilDb(sqlDb);
    db.run('PRAGMA foreign_keys = ON');

    const instance = new AnvilDatabase(db);
    instance.initialize();
    return instance;
  }

  /** Run migrations to bring schema up to current version */
  private initialize(): void {
    this._db.exec(SCHEMA_SQL);
  }

  /** Expose raw AnvilDb for use by indexer/query modules */
  get raw(): AnvilDb {
    return this._db;
  }

  /** Cache resolved type definitions in the types table */
  upsertType(type: ResolvedType): void {
    this._db.run(
      `INSERT INTO types (type_id, name, schema_json, template_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(type_id) DO UPDATE SET
         name = excluded.name,
         schema_json = excluded.schema_json,
         template_json = excluded.template_json,
         updated_at = excluded.updated_at`,
      [
        type.id,
        type.name,
        JSON.stringify({ fields: type.fields, behaviors: type.behaviors }),
        type.template ? JSON.stringify(type.template) : null,
        new Date().toISOString(),
      ]
    );
  }

  close(): void {
    this._db.close();
  }
}
