/**
 * SQLite persistence (users + audit_log + requests + keys) on a PVC.
 * Uses node-sqlite3-wasm (no native build). Pass ':memory:' in tests.
 */

import sqlite3Wasm from 'node-sqlite3-wasm';
import type { ProvisioningRequest, RequestKind, RequestStatus, Decision } from './model.js';

// node-sqlite3-wasm is CommonJS — under native ESM its named exports aren't
// statically detectable, so default-import the module object and destructure.
const { Database } = sqlite3Wasm;
type Database = InstanceType<typeof Database>;

export interface UserRecord {
  userId: string;
  tenant: string;
  role: string;
  assignedVaults: string[];
  mustRotate: boolean;
  createdAt: string;
}

interface RequestRow {
  id: string;
  kind: string;
  payload: string;
  requester: string;
  tenant: string;
  status: string;
  decision: string | null;
  decided_by: string | null;
  error: string | null;
  steps: string;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  user_id: string;
  tenant: string;
  role: string;
  assigned_vaults: string;
  must_rotate: number;
  created_at: string;
}

export class Store {
  private readonly db: Database;

  constructor(path = ':memory:') {
    this.db = new Database(path);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      requester TEXT NOT NULL, tenant TEXT NOT NULL, status TEXT NOT NULL,
      decision TEXT, decided_by TEXT, error TEXT, steps TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.db.run(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY, tenant TEXT NOT NULL, role TEXT NOT NULL,
      assigned_vaults TEXT NOT NULL, must_rotate INTEGER NOT NULL, created_at TEXT NOT NULL)`);
    this.db.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
      action TEXT NOT NULL, detail TEXT)`);
    this.db.run(`CREATE TABLE IF NOT EXISTS keys (name TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }

  // ── requests ───────────────────────────────────────────────────────────────
  private static toRequest(r: RequestRow): ProvisioningRequest {
    return {
      id: r.id,
      kind: r.kind as RequestKind,
      payload: JSON.parse(r.payload),
      requester: r.requester,
      tenant: r.tenant,
      status: r.status as RequestStatus,
      decision: (r.decision as Decision | null) ?? null,
      decidedBy: r.decided_by,
      error: r.error,
      steps: JSON.parse(r.steps),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  insertRequest(req: ProvisioningRequest): void {
    this.db.run(
      `INSERT INTO requests (id, kind, payload, requester, tenant, status, decision, decided_by, error, steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.id,
        req.kind,
        JSON.stringify(req.payload),
        req.requester,
        req.tenant,
        req.status,
        req.decision,
        req.decidedBy,
        req.error,
        JSON.stringify(req.steps),
        req.createdAt,
        req.updatedAt,
      ],
    );
  }

  saveRequest(req: ProvisioningRequest): void {
    this.db.run(
      `UPDATE requests SET status=?, decision=?, decided_by=?, error=?, steps=?, updated_at=? WHERE id=?`,
      [
        req.status,
        req.decision,
        req.decidedBy,
        req.error,
        JSON.stringify(req.steps),
        new Date().toISOString(),
        req.id,
      ],
    );
  }

  getRequest(id: string): ProvisioningRequest | null {
    const row = this.db.get(`SELECT * FROM requests WHERE id=?`, [id]) as unknown as
      | RequestRow
      | undefined;
    return row ? Store.toRequest(row) : null;
  }

  listRequests(): ProvisioningRequest[] {
    const rows = this.db.all(`SELECT * FROM requests ORDER BY created_at`) as unknown as RequestRow[];
    return rows.map(Store.toRequest);
  }

  // ── users ────────────────────────────────────────────────────────────────
  private static toUser(r: UserRow): UserRecord {
    return {
      userId: r.user_id,
      tenant: r.tenant,
      role: r.role,
      assignedVaults: JSON.parse(r.assigned_vaults),
      mustRotate: r.must_rotate === 1,
      createdAt: r.created_at,
    };
  }

  upsertUser(u: UserRecord): void {
    this.db.run(
      `INSERT INTO users (user_id, tenant, role, assigned_vaults, must_rotate, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tenant=excluded.tenant, role=excluded.role,
         assigned_vaults=excluded.assigned_vaults, must_rotate=excluded.must_rotate`,
      [u.userId, u.tenant, u.role, JSON.stringify(u.assignedVaults), u.mustRotate ? 1 : 0, u.createdAt],
    );
  }

  getUser(userId: string): UserRecord | null {
    const row = this.db.get(`SELECT * FROM users WHERE user_id=?`, [userId]) as unknown as
      | UserRow
      | undefined;
    return row ? Store.toUser(row) : null;
  }

  listUsers(): UserRecord[] {
    return (this.db.all(`SELECT * FROM users ORDER BY created_at`) as unknown as UserRow[]).map(
      Store.toUser,
    );
  }

  deleteUser(userId: string): void {
    this.db.run(`DELETE FROM users WHERE user_id=?`, [userId]);
  }

  // ── audit ──────────────────────────────────────────────────────────────────
  audit(actor: string, action: string, detail?: string): void {
    this.db.run(`INSERT INTO audit_log (ts, actor, action, detail) VALUES (?, ?, ?, ?)`, [
      new Date().toISOString(),
      actor,
      action,
      detail ?? null,
    ]);
  }

  auditCount(): number {
    const row = this.db.get(`SELECT COUNT(*) as n FROM audit_log`) as { n: number };
    return row.n;
  }

  // ── keys (opaque JSON blobs, e.g. persisted JWKs) ──────────────────────────
  getKey(name: string): unknown | null {
    const row = this.db.get(`SELECT data FROM keys WHERE name=?`, [name]) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  putKey(name: string, data: unknown): void {
    this.db.run(
      `INSERT INTO keys (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data=excluded.data`,
      [name, JSON.stringify(data)],
    );
  }

  close(): void {
    this.db.close();
  }
}
