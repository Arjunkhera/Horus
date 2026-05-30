/**
 * TA-8: RED spec — single-tenant fallback DeploymentProfile
 *
 * AC covered:
 *   (a) Single-tenant mode: ANVIL_DEPLOYMENT_PROFILE=single-tenant +
 *       ANVIL_UPSTREAM_URL set → /mcp proxied to <SHARED_URL>/mcp
 *       (registry never consulted)
 *   (b) Single-tenant mode: /api/notes/:id proxied to <SHARED_URL>/api/notes/:id
 *   (c) Single-tenant mode: /api/events proxied to <SHARED_URL>/api/events
 *       with SSE semantics
 *   (d) /health returns { mode: "single-tenant" } when in single-tenant mode
 *   (e) /health returns { mode: "alpha" } (or omits mode) in default mode
 *   (f) Misconfiguration: ANVIL_DEPLOYMENT_PROFILE=single-tenant but no
 *       ANVIL_UPSTREAM_URL → buildServer() rejects with a clear error
 *   (g) Per-user (default) mode: registry is still consulted; existing proxy
 *       behaviour is unchanged (no regression)
 *
 * Design decisions applied:
 *   Q7: Single-tenant kept as a DeploymentProfile variant — no migration script
 *   TA-8 story: env var ANVIL_DEPLOYMENT_PROFILE selects mode at boot time
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { createRequire } from 'node:module'
import {
  createJwtKeyPair,
  createJwtProvider,
  type JwtKeyPair,
} from '@horus/auth'
import { buildServer } from '../src/app.js'

// ---------------------------------------------------------------------------
// SQLite helpers (mirrors mcp-proxy.test.ts pattern — used for per-user mode)
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url)
const { Database } = _require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm')

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

function createMemoryDb() {
  const db = new Database()
  db.exec(REGISTRY_DDL)
  return db
}

function seedEntry(
  db: InstanceType<typeof Database>,
  tenant: string,
  user: string,
  url: string,
) {
  db.run(
    `INSERT INTO service_registry (tenant, user, url, schema_version, status)
     VALUES (?, ?, ?, 1, 'active')`,
    [tenant, user, url],
  )
}

// ---------------------------------------------------------------------------
// Minimal fake upstream server (re-usable across suites)
// ---------------------------------------------------------------------------

interface FakeUpstreamState {
  server: Server
  url: string
  receivedPaths: string[]
  receivedHeaders: Record<string, string | string[]>
}

function startFakeUpstream(): Promise<FakeUpstreamState> {
  return new Promise((resolve, reject) => {
    const state: FakeUpstreamState = {
      server: null as unknown as Server,
      url: '',
      receivedPaths: [],
      receivedHeaders: {},
    }

    const server = createServer((req, res) => {
      state.receivedPaths.push(req.url ?? '')
      state.receivedHeaders = { ...req.headers } as Record<string, string | string[]>

      // Detect SSE request
      const isSSE = req.headers['accept']?.includes('text/event-stream')

      if (isSSE) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        })
        res.write('data: hello\n\n')
        // Keep alive briefly, then end
        setTimeout(() => res.end(), 20)
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: req.url }))
      }
    })

    state.server = server

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      state.url = `http://127.0.0.1:${addr.port}`
      resolve(state)
    })

    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// JWT key pair shared across suites
// ---------------------------------------------------------------------------

const TENANT = 'st-test-tenant'
const USER = 'bob'
let keyPair: JwtKeyPair

async function makeAuthHeader(opts?: { tenant?: string; user?: string }): Promise<string> {
  const provider = createJwtProvider({
    privateKey: keyPair.privateKey,
    kid: keyPair.kid,
    alg: 'RS256',
    tenant: opts?.tenant ?? TENANT,
    user: opts?.user ?? USER,
    role: 'admin',
    ttlSeconds: 300,
  })
  return provider.authorizationHeader()
}

function baseEnv(keys: object) {
  process.env['ANVIL_ROUTER_TENANT'] = TENANT
  process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({ keys })
}

function clearEnv() {
  delete process.env['ANVIL_ROUTER_TENANT']
  delete process.env['ANVIL_ROUTER_JWKS_JSON']
  delete process.env['ANVIL_DEPLOYMENT_PROFILE']
  delete process.env['ANVIL_UPSTREAM_URL']
}

// ---------------------------------------------------------------------------
// Suite A: Single-tenant mode — /mcp proxied to shared URL
// ---------------------------------------------------------------------------

describe('TA-8 single-tenant mode — MCP proxy', () => {
  let app: FastifyInstance
  let upstream: FakeUpstreamState
  let validAuth: string

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })
    upstream = await startFakeUpstream()

    baseEnv([{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }])
    process.env['ANVIL_DEPLOYMENT_PROFILE'] = 'single-tenant'
    process.env['ANVIL_UPSTREAM_URL'] = upstream.url

    // Single-tenant mode: no registryDb injection needed
    app = await buildServer()
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => upstream.server.close(() => res()))
    clearEnv()
  })

  it('POST /mcp returns 200 in single-tenant mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: validAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(200)
  })

  it('upstream receives request at /mcp path', async () => {
    upstream.receivedPaths.length = 0
    await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: validAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(upstream.receivedPaths).toContain('/mcp')
  })
})

// ---------------------------------------------------------------------------
// Suite B: Single-tenant mode — /api/* REST proxy
// ---------------------------------------------------------------------------

describe('TA-8 single-tenant mode — REST proxy', () => {
  let app: FastifyInstance
  let upstream: FakeUpstreamState
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    upstream = await startFakeUpstream()

    baseEnv([{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }])
    process.env['ANVIL_DEPLOYMENT_PROFILE'] = 'single-tenant'
    process.env['ANVIL_UPSTREAM_URL'] = upstream.url

    app = await buildServer()
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => upstream.server.close(() => res()))
    clearEnv()
  })

  it('GET /api/notes/test-id returns 200 in single-tenant mode', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/test-id',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(200)
  })

  it('upstream receives /api/notes/test-id path', async () => {
    upstream.receivedPaths.length = 0
    await app.inject({
      method: 'GET',
      url: '/api/notes/test-id',
      headers: { authorization: validAuth },
    })
    expect(upstream.receivedPaths.some((p) => p.startsWith('/api/notes/'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Suite C: Single-tenant mode — /api/events SSE proxy
// ---------------------------------------------------------------------------

describe('TA-8 single-tenant mode — SSE proxy', () => {
  let app: FastifyInstance
  let upstream: FakeUpstreamState
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    upstream = await startFakeUpstream()

    baseEnv([{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }])
    process.env['ANVIL_DEPLOYMENT_PROFILE'] = 'single-tenant'
    process.env['ANVIL_UPSTREAM_URL'] = upstream.url

    app = await buildServer()
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => upstream.server.close(() => res()))
    clearEnv()
  })

  it('GET /api/events returns 200 with SSE content-type in single-tenant mode', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: {
        authorization: validAuth,
        accept: 'text/event-stream',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
  })

  it('upstream receives /api/events path', async () => {
    upstream.receivedPaths.length = 0
    await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: {
        authorization: validAuth,
        accept: 'text/event-stream',
      },
    })
    expect(upstream.receivedPaths).toContain('/api/events')
  })
})

// ---------------------------------------------------------------------------
// Suite D: Health endpoint reports mode
// ---------------------------------------------------------------------------

describe('TA-8 health endpoint reports mode', () => {
  it('GET /health returns { mode: "single-tenant" } when ANVIL_DEPLOYMENT_PROFILE=single-tenant', async () => {
    const kp = await createJwtKeyPair({ alg: 'RS256' })
    baseEnv([{ ...kp.publicJwk, kid: kp.kid, alg: 'RS256' }])
    process.env['ANVIL_DEPLOYMENT_PROFILE'] = 'single-tenant'
    process.env['ANVIL_UPSTREAM_URL'] = 'http://127.0.0.1:19998'

    let app: FastifyInstance | null = null
    try {
      app = await buildServer()
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.mode).toBe('single-tenant')
    } finally {
      await app?.close()
      clearEnv()
    }
  })

  it('GET /health returns { mode: "alpha" } when ANVIL_DEPLOYMENT_PROFILE is unset', async () => {
    const kp = await createJwtKeyPair({ alg: 'RS256' })
    baseEnv([{ ...kp.publicJwk, kid: kp.kid, alg: 'RS256' }])
    // ANVIL_DEPLOYMENT_PROFILE not set → default alpha

    const db = createMemoryDb() // provide empty db so SQLite factory path is skipped
    let app: FastifyInstance | null = null
    try {
      app = await buildServer({ registryDb: db })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.mode).toBe('alpha')
    } finally {
      await app?.close()
      clearEnv()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite E: Misconfiguration — single-tenant without ANVIL_UPSTREAM_URL
// ---------------------------------------------------------------------------

describe('TA-8 misconfiguration — single-tenant without ANVIL_UPSTREAM_URL', () => {
  it('buildServer() rejects with a clear error when ANVIL_UPSTREAM_URL is missing', async () => {
    const kp = await createJwtKeyPair({ alg: 'RS256' })
    baseEnv([{ ...kp.publicJwk, kid: kp.kid, alg: 'RS256' }])
    process.env['ANVIL_DEPLOYMENT_PROFILE'] = 'single-tenant'
    // Intentionally do NOT set ANVIL_UPSTREAM_URL

    try {
      await expect(buildServer()).rejects.toThrow(/ANVIL_UPSTREAM_URL/i)
    } finally {
      clearEnv()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite F: Per-user (default) mode — registry still consulted (no regression)
// ---------------------------------------------------------------------------

describe('TA-8 per-user mode — registry still consulted (no regression)', () => {
  let app: FastifyInstance
  let upstream: FakeUpstreamState
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    upstream = await startFakeUpstream()

    baseEnv([{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }])
    // No ANVIL_DEPLOYMENT_PROFILE → default alpha (per-user)

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, upstream.url)

    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => upstream.server.close(() => res()))
    clearEnv()
  })

  it('POST /mcp in per-user mode (default) returns 200 via registry lookup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: validAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(200)
  })

  it('per-user mode returns 425 on registry miss (no entry for unknown user)', async () => {
    const otherAuth = await makeAuthHeader({ user: 'unknown-user' })
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: otherAuth, 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(425)
  })
})
