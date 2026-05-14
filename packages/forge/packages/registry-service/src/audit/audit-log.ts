/**
 * Append-only audit log backed by sql.js (pure WASM sqlite).
 *
 * Data is persisted to a file using Node's fs APIs.
 * All operations are synchronous from the caller's perspective (sql.js is sync).
 *
 * Security: actor is the userId (never an auth key or credential).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';

export type AuditAction = 'publish' | 'read' | 'verify' | 'unverify';

export interface AuditEntry {
  id?: number;
  /** Name of the auth strategy that resolved this identity (e.g. 'builtin', 'webhook', 'trusted-headers') */
  strategy: string;
  actor: string;
  action: AuditAction;
  resource: string;
  decision: 'permit' | 'deny';
  targetType: string;
  targetId: string;
  targetVersion: string;
  timestamp: string; // ISO 8601
  /** Optional extra context (JSON string) */
  meta?: string;
}

/**
 * Lazily initialises sql.js and opens (or creates) the database file.
 */
async function openDb(dbPath: string): Promise<{ SQL: SqlJsStatic; db: Database }> {
  const SQL = await initSqlJs();

  let db: Database;
  if (existsSync(dbPath)) {
    const filebuffer = readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy     TEXT    NOT NULL,
      actor        TEXT    NOT NULL,
      action       TEXT    NOT NULL,
      resource     TEXT    NOT NULL,
      decision     TEXT    NOT NULL,
      target_type  TEXT    NOT NULL,
      target_id    TEXT    NOT NULL,
      target_ver   TEXT    NOT NULL,
      timestamp    TEXT    NOT NULL,
      meta         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_strategy ON audit_log(strategy);
    CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision);
  `);

  // Flush to disk immediately
  writeFileSync(dbPath, db.export());

  return { SQL, db };
}

export class AuditLog {
  private db!: Database;
  private readonly dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = openDb(this.dbPath).then(({ db }) => {
      this.db = db;
      this.initialized = true;
    });
    return this.initPromise;
  }

  /**
   * Append a new audit entry.
   * One row per privileged action; fields match the AC:
   *   strategy, userId (actor), action, resource, decision, timestamp
   */
  async append(entry: Omit<AuditEntry, 'id'>): Promise<void> {
    await this.ensureInit();
    this.db.run(
      `INSERT INTO audit_log (strategy, actor, action, resource, decision, target_type, target_id, target_ver, timestamp, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.strategy,
        entry.actor,
        entry.action,
        entry.resource,
        entry.decision,
        entry.targetType,
        entry.targetId,
        entry.targetVersion,
        entry.timestamp,
        entry.meta ?? null,
      ],
    );
    // Persist to disk after each write
    writeFileSync(this.dbPath, this.db.export());
  }

  /**
   * Fetch recent entries (newest first), optionally filtered by actor.
   */
  async recent(limit = 100, actor?: string): Promise<AuditEntry[]> {
    await this.ensureInit();

    const sql = actor
      ? `SELECT id, strategy, actor, action, resource, decision, target_type, target_id, target_ver, timestamp, meta
         FROM audit_log WHERE actor = ? ORDER BY id DESC LIMIT ?`
      : `SELECT id, strategy, actor, action, resource, decision, target_type, target_id, target_ver, timestamp, meta
         FROM audit_log ORDER BY id DESC LIMIT ?`;

    const params = actor ? [actor, limit] : [limit];
    const results = this.db.exec(sql, params);
    if (!results.length || !results[0].values.length) return [];

    const cols = results[0].columns;
    return results[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      return {
        id: obj['id'] as number,
        strategy: obj['strategy'] as string,
        actor: obj['actor'] as string,
        action: obj['action'] as AuditAction,
        resource: obj['resource'] as string,
        decision: obj['decision'] as 'permit' | 'deny',
        targetType: obj['target_type'] as string,
        targetId: obj['target_id'] as string,
        targetVersion: obj['target_ver'] as string,
        timestamp: obj['timestamp'] as string,
        meta: obj['meta'] as string | undefined,
      };
    });
  }

  close(): void {
    if (this.db) {
      writeFileSync(this.dbPath, this.db.export());
      this.db.close();
    }
  }
}
