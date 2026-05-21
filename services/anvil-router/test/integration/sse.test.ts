/**
 * TA-9: Integration smoke tests — SSE proxy through the remoting stack.
 *
 * Verifies that the SSE proxy (TA-7) continues to work correctly when the
 * router is operating in per-user alpha mode with a seeded SQLite registry
 * (the remoting profile scenario).
 *
 * AC (d) from story TA-9: "SSE stream flows through router"
 *
 * The tests spin up a real fake SSE server per-user to confirm:
 *   - user-a token → SSE events arrive from anvil-a's stream
 *   - user-b token → SSE events arrive from anvil-b's stream
 *   - Auth failure (no token) → 401 before upstream connection
 *   - Unknown user → 425 Too Early
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, request as httpRequest } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { createRequire } from 'node:module'
import {
  createJwtKeyPair,
  createJwtProvider,
  type JwtKeyPair,
} from '@horus/auth'
import { buildServer } from '../../src/app.js'

// ---------------------------------------------------------------------------
// SQLite helpers
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
// Fake SSE upstream server
// ---------------------------------------------------------------------------

interface FakeSseServer {
  server: Server
  url: string
  userLabel: string
}

function startFakeSseServer(userLabel: string, eventCount = 2): Promise<FakeSseServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders()

      let i = 0
      const emit = () => {
        if (i >= eventCount) {
          res.end()
          return
        }
        res.write(`data: ${userLabel}-event-${i}\n\n`)
        i++
        setTimeout(emit, 30)
      }
      emit()
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, userLabel })
    })

    server.on('error', reject)
  })
}

function stopFakeSse(s: FakeSseServer): Promise<void> {
  return new Promise((res) => s.server.close(() => res()))
}

// ---------------------------------------------------------------------------
// HTTP helpers for real streaming
// ---------------------------------------------------------------------------

function listenOnFreePort(app: FastifyInstance): Promise<number> {
  return new Promise((resolve, reject) => {
    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) { reject(err); return }
      resolve(parseInt(new URL(address).port, 10))
    })
  })
}

function collectSseChunks(
  port: number,
  authHeader: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/events',
        method: 'GET',
        headers: { authorization: authHeader },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const TENANT = 'sse-remoting-test-tenant'

async function makeAuthHeader(keyPair: JwtKeyPair, user: string): Promise<string> {
  const provider = createJwtProvider({
    privateKey: keyPair.privateKey,
    kid: keyPair.kid,
    alg: 'RS256',
    tenant: TENANT,
    user,
    role: 'admin',
    ttlSeconds: 300,
  })
  return provider.authorizationHeader()
}

// ---------------------------------------------------------------------------
// Suite A: SSE stream for user-a arrives from anvil-a
// ---------------------------------------------------------------------------

describe('TA-9 SSE — user-a stream flows from anvil-user-a', () => {
  let app: FastifyInstance
  let sseA: FakeSseServer
  let sseB: FakeSseServer
  let authA: string
  let keyPair: JwtKeyPair
  let serverPort: number

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })

    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    sseA = await startFakeSseServer('user-a', 2)
    sseB = await startFakeSseServer('user-b', 2)

    const db = createMemoryDb()
    seedEntry(db, TENANT, 'user-a', sseA.url)
    seedEntry(db, TENANT, 'user-b', sseB.url)

    app = await buildServer({ registryDb: db })
    serverPort = await listenOnFreePort(app)

    authA = await makeAuthHeader(keyPair, 'user-a')
  })

  afterAll(async () => {
    await app.close()
    await stopFakeSse(sseA)
    await stopFakeSse(sseB)
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('SSE stream for user-a returns 200', async () => {
    const { statusCode } = await collectSseChunks(serverPort, authA)
    expect(statusCode).toBe(200)
  }, 5000)

  it('SSE body contains user-a events (not user-b events)', async () => {
    const { body } = await collectSseChunks(serverPort, authA)
    expect(body).toContain('user-a-event-0')
    expect(body).not.toContain('user-b-event')
  }, 5000)
})

// ---------------------------------------------------------------------------
// Suite B: SSE stream for user-b arrives from anvil-b
// ---------------------------------------------------------------------------

describe('TA-9 SSE — user-b stream flows from anvil-user-b', () => {
  let app: FastifyInstance
  let sseA: FakeSseServer
  let sseB: FakeSseServer
  let authB: string
  let keyPair: JwtKeyPair
  let serverPort: number

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })

    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    sseA = await startFakeSseServer('user-a', 2)
    sseB = await startFakeSseServer('user-b', 2)

    const db = createMemoryDb()
    seedEntry(db, TENANT, 'user-a', sseA.url)
    seedEntry(db, TENANT, 'user-b', sseB.url)

    app = await buildServer({ registryDb: db })
    serverPort = await listenOnFreePort(app)

    authB = await makeAuthHeader(keyPair, 'user-b')
  })

  afterAll(async () => {
    await app.close()
    await stopFakeSse(sseA)
    await stopFakeSse(sseB)
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('SSE stream for user-b returns 200', async () => {
    const { statusCode } = await collectSseChunks(serverPort, authB)
    expect(statusCode).toBe(200)
  }, 5000)

  it('SSE body contains user-b events (not user-a events)', async () => {
    const { body } = await collectSseChunks(serverPort, authB)
    expect(body).toContain('user-b-event-0')
    expect(body).not.toContain('user-a-event')
  }, 5000)
})

// ---------------------------------------------------------------------------
// Suite C: SSE auth failures
// ---------------------------------------------------------------------------

describe('TA-9 SSE — auth failure → 401', () => {
  let app: FastifyInstance
  let keyPair: JwtKeyPair

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })

    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    app = await buildServer({ registryDb: db })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/events without Authorization → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events' })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Suite D: SSE registry miss → 425
// ---------------------------------------------------------------------------

describe('TA-9 SSE — unknown user → 425', () => {
  let app: FastifyInstance
  let keyPair: JwtKeyPair
  let authUnknown: string

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })

    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb() // empty
    app = await buildServer({ registryDb: db })
    await app.ready()

    authUnknown = await makeAuthHeader(keyPair, 'ghost-user')
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/events with valid token but no registry entry → 425', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: authUnknown },
    })
    expect(res.statusCode).toBe(425)
  })

  it('425 body has code REGISTRY_MISS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: authUnknown },
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('REGISTRY_MISS')
  })
})
