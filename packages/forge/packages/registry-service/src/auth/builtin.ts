/**
 * BuiltinAuthStrategy — bcrypt-hashed API keys stored in sql.js sqlite.
 *
 * Startup behaviour:
 *   - First start: generates one key per admin using crypto.randomBytes(32),
 *     hashes with bcrypt, writes hash to sqlite, logs plaintext key ONCE.
 *   - Subsequent starts: detects existing rows, skips generation entirely.
 *
 * Security invariants:
 *   - Plaintext keys are emitted to logs exactly once, never stored anywhere.
 *   - DB rows store only bcrypt hashes.
 *   - identify() returns userId (not the key) so audit log is clean.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import type { FastifyBaseLogger } from 'fastify';
import type { AuthDecision, AuthStrategy } from './types.js';
import type { ServiceAction, ServiceResource, ServiceUser } from '../types.js';
import type { FastifyRequest } from 'fastify';
import type { AdminUser } from '../config.js';

const BCRYPT_ROUNDS = 12;
const BEARER_PREFIX = 'Bearer ';

export class BuiltinAuthStrategy implements AuthStrategy {
  private db!: Database;
  private readonly dbPath: string;
  private readonly admins: Map<string, AdminUser>;
  private readonly logger: FastifyBaseLogger;
  private initPromise: Promise<void> | null = null;

  constructor(
    dbPath: string,
    admins: AdminUser[],
    logger: FastifyBaseLogger,
  ) {
    this.dbPath = dbPath;
    this.admins = new Map(admins.map((a) => [a.id, a]));
    this.logger = logger;

    // Bootstrap is async; we hold the promise so identify() awaits it
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    if (existsSync(this.dbPath)) {
      this.db = new SQL.Database(readFileSync(this.dbPath));
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS auth_keys (
        user_id   TEXT PRIMARY KEY,
        key_hash  TEXT NOT NULL
      );
    `);

    await this.bootstrapAdmins();

    // Persist schema + any new keys
    writeFileSync(this.dbPath, this.db.export());
  }

  private async bootstrapAdmins(): Promise<void> {
    for (const admin of this.admins.values()) {
      const existing = this.db.exec(
        'SELECT user_id FROM auth_keys WHERE user_id = ?',
        [admin.id],
      );

      if (existing.length > 0 && existing[0].values.length > 0) {
        this.logger.info(
          { userId: admin.id },
          'builtin-auth: existing key found, skipping generation',
        );
        continue;
      }

      // Generate a 32-byte random key and encode as hex (64 chars)
      const plaintext = randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
      this.db.run('INSERT INTO auth_keys (user_id, key_hash) VALUES (?, ?)', [admin.id, hash]);

      // Emit plaintext to startup log ONCE
      this.logger.info(
        {
          event: 'admin_key_generated',
          userId: admin.id,
        },
        `[STARTUP] Admin API key for '${admin.name}' (${admin.id}): ${plaintext}  — save this, it will not be shown again`,
      );
    }
  }

  private async ensureInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  /**
   * Wait for async initialization to complete.
   * Useful in tests and in startup checks.
   */
  async ready(): Promise<void> {
    return this.ensureInit();
  }

  async identify(request: FastifyRequest): Promise<ServiceUser | null> {
    await this.ensureInit();

    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      return null;
    }

    const token = authHeader.slice(BEARER_PREFIX.length).trim();
    if (!token) return null;

    // Fetch all key rows and bcrypt-compare (timing-safe via bcrypt)
    const results = this.db.exec('SELECT user_id, key_hash FROM auth_keys');
    if (!results.length) return null;

    for (const row of results[0].values) {
      const userId = row[0] as string;
      const keyHash = row[1] as string;
      const match = await bcrypt.compare(token, keyHash);
      if (match) {
        const admin = this.admins.get(userId);
        if (!admin) continue; // key exists but user removed from config — deny
        return {
          userId: admin.id,
          name: admin.name,
          role: 'admin',
        };
      }
    }

    return null;
  }

  authorize(
    user: ServiceUser | null,
    action: ServiceAction,
    _resource: ServiceResource,
  ): AuthDecision {
    if (action === 'read') {
      // Anonymous reads are permitted (R6: public reads need no auth)
      return 'permit';
    }

    if (action === 'publish' || action === 'verify') {
      if (user?.role === 'admin') return 'permit';
      return 'deny';
    }

    return 'deny';
  }

  close(): void {
    if (this.db) {
      writeFileSync(this.dbPath, this.db.export());
      this.db.close();
    }
  }
}
