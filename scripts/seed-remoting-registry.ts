/**
 * scripts/seed-remoting-registry.ts
 *
 * Seeds the SQLite service registry used by anvil-router with test entries
 * for the opt-in .testenv remoting profile (TA-9).
 *
 * Creates the registry DB at ANVIL_REGISTRY_PATH (required) and inserts rows
 * for user-a and user-b pointing to the mock Anvil container URLs.
 *
 * Usage:
 *   ANVIL_REGISTRY_PATH=/data/registry.db \
 *   ANVIL_USER_A_URL=http://anvil-user-a:8201 \
 *   ANVIL_USER_B_URL=http://anvil-user-b:8202 \
 *   ANVIL_ROUTER_TENANT=horus-remoting-test \
 *   pnpm tsx scripts/seed-remoting-registry.ts
 *
 * Env vars:
 *   ANVIL_REGISTRY_PATH    — path to the SQLite DB file to create/seed (required)
 *   ANVIL_USER_A_URL       — upstream URL for user-a (default: http://anvil-user-a:8201)
 *   ANVIL_USER_B_URL       — upstream URL for user-b (default: http://anvil-user-b:8202)
 *   ANVIL_ROUTER_TENANT    — tenant identifier (default: horus-remoting-test)
 *
 * The script is idempotent: it creates the table if absent and uses INSERT OR
 * REPLACE so re-running updates existing rows.
 *
 * Locked decision Q8: opt-in remoting profile; this seed script is only invoked
 * by the test:remoting workflow, never by the default CI pipeline.
 */

import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const { Database } = _require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm')

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REGISTRY_PATH = process.env['ANVIL_REGISTRY_PATH']
if (!REGISTRY_PATH) {
  console.error('[seed-remoting-registry] ANVIL_REGISTRY_PATH is required')
  process.exit(1)
}

const TENANT = process.env['ANVIL_ROUTER_TENANT'] ?? 'horus-remoting-test'
const USER_A_URL = process.env['ANVIL_USER_A_URL'] ?? 'http://anvil-user-a:8201'
const USER_B_URL = process.env['ANVIL_USER_B_URL'] ?? 'http://anvil-user-b:8202'

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const REGISTRY_DDL = `
  CREATE TABLE IF NOT EXISTS service_registry (
    tenant              TEXT NOT NULL,
    user                TEXT NOT NULL,
    url                 TEXT NOT NULL,
    schema_version      INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'active',
    last_provisioned_at TEXT,
    PRIMARY KEY (tenant, user)
  );
`

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

console.log(`[seed-remoting-registry] Opening registry at ${REGISTRY_PATH}`)
const db = new Database(REGISTRY_PATH)

db.exec(REGISTRY_DDL)

const upsert = (user: string, url: string) => {
  db.run(
    `INSERT OR REPLACE INTO service_registry
       (tenant, user, url, schema_version, status, last_provisioned_at)
     VALUES (?, ?, ?, 1, 'active', datetime('now'))`,
    [TENANT, user, url],
  )
  console.log(`[seed-remoting-registry] Seeded ${TENANT}/${user} → ${url}`)
}

upsert('user-a', USER_A_URL)
upsert('user-b', USER_B_URL)

db.close()

console.log('[seed-remoting-registry] Done. Registry seeded with 2 entries.')
