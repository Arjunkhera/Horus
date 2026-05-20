/**
 * TA-7: RED spec — SSE proxy for /api/events
 *
 * AC covered:
 *   (a) Happy path: valid JWT + registry entry → GET /api/events forwarded to
 *       upstream SSE server; events arrive incrementally (not buffered)
 *   (b) Correct SSE response headers: Content-Type: text/event-stream,
 *       Cache-Control includes no-cache, Connection: keep-alive,
 *       X-Accel-Buffering: no
 *   (c) Auth failure (no token) → 401 before upstream connection
 *   (d) Registry miss (valid token, no entry) → 425 Too Early
 *   (e) Instance unreachable → 502 Bad Gateway
 *   (f) Upstream close propagates cleanly to client (stream ends)
 *   (g) Incremental delivery: chunks arrive progressively, not as one buffered blob
 *
 * Streaming assertion strategy:
 *   app.inject() buffers the full response; to test incremental delivery we spin
 *   up the server on a real OS port (listen(0)) and use a raw http.request so we
 *   can observe chunks arriving as the upstream emits them.
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
import { buildServer } from '../src/app.js'

// ---------------------------------------------------------------------------
// SQLite helpers (mirrors mcp-proxy.test.ts pattern)
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
// Fake upstream SSE server
// ---------------------------------------------------------------------------

interface FakeSseOpts {
  /** How many events to emit. Default: 3 */
  eventCount?: number
  /** Delay between events in ms. Default: 50 */
  delayBetweenEventsMs?: number
  /** If true, destroy socket immediately (simulates unreachable) */
  destroyImmediately?: boolean
}

/**
 * Starts a minimal HTTP server that speaks SSE. Emits `eventCount` events
 * with `delayBetweenEventsMs` gaps, then ends the response.
 *
 * The server only responds to GET requests; it sets the standard SSE headers
 * itself to verify that the router propagates them (or overrides with its own).
 */
function startFakeSseServer(opts: FakeSseOpts = {}): Promise<{
  server: Server
  url: string
}> {
  const {
    eventCount = 3,
    delayBetweenEventsMs = 50,
    destroyImmediately = false,
  } = opts

  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      if (destroyImmediately) {
        _req.socket.destroy()
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      })
      // Flush headers immediately so the client sees a 200 right away
      res.flushHeaders()

      let i = 0
      const writeNext = () => {
        if (i >= eventCount) {
          res.end()
          return
        }
        res.write(`data: event-${i}\n\n`)
        i++
        setTimeout(writeNext, delayBetweenEventsMs)
      }

      writeNext()
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
      })
    })

    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Helper: collect all chunks via real HTTP (not inject) for streaming tests
// ---------------------------------------------------------------------------

/**
 * Opens a real HTTP connection to the given Fastify server (must already be
 * listening on a real port via listenOnFreePort), makes a GET request with the
 * given headers, and resolves with an array of chunks as they arrive plus the
 * response headers.
 *
 * Returns chunks, statusCode, and responseHeaders.
 */
function collectChunksViaHttp(
  port: number,
  path: string,
  authHeader: string,
): Promise<{
  chunks: Buffer[]
  statusCode: number
  responseHeaders: Record<string, string | string[] | undefined>
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { authorization: authHeader },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            chunks,
            statusCode: res.statusCode ?? 0,
            responseHeaders: res.headers as Record<string, string | string[] | undefined>,
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/**
 * Start listening on a free port. Returns the assigned port.
 */
function listenOnFreePort(app: FastifyInstance): Promise<number> {
  return new Promise((resolve, reject) => {
    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) { reject(err); return }
      const port = parseInt(new URL(address).port, 10)
      resolve(port)
    })
  })
}

// ---------------------------------------------------------------------------
// Test-wide fixtures
// ---------------------------------------------------------------------------

const TENANT = 'sse-proxy-test-tenant'
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

// ---------------------------------------------------------------------------
// Suite A: Happy-path forwarding — inject (headers + body frames)
// ---------------------------------------------------------------------------

describe('TA-7 SSE proxy — happy path (inject)', () => {
  let app: FastifyInstance
  let fakeAnvil: Awaited<ReturnType<typeof startFakeSseServer>>
  let validAuth: string

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeSseServer({ eventCount: 3 })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, fakeAnvil.url)

    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => fakeAnvil.server.close(() => res()))
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/events returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(200)
  })

  it('response Content-Type is text/event-stream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.headers['content-type']).toContain('text/event-stream')
  })

  it('Cache-Control header indicates no-cache', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    const cc = res.headers['cache-control'] ?? ''
    expect(cc).toMatch(/no-cache/)
  })

  it('Connection header is keep-alive', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    // HTTP/1.1 inject may omit Connection; the important thing is it's not 'close'
    const conn = res.headers['connection'] ?? 'keep-alive'
    expect(conn.toLowerCase()).not.toBe('close')
  })

  it('X-Accel-Buffering header is no', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.headers['x-accel-buffering']).toBe('no')
  })

  it('response body contains all 3 event frames', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    // SSE frames: "data: event-0\n\n", "data: event-1\n\n", "data: event-2\n\n"
    expect(res.payload).toContain('data: event-0')
    expect(res.payload).toContain('data: event-1')
    expect(res.payload).toContain('data: event-2')
  })
})

// ---------------------------------------------------------------------------
// Suite B: Incremental delivery (real HTTP — chunks must arrive progressively)
// ---------------------------------------------------------------------------

describe('TA-7 SSE proxy — incremental delivery (real HTTP)', () => {
  let app: FastifyInstance
  let fakeAnvil: Awaited<ReturnType<typeof startFakeSseServer>>
  let validAuth: string
  let serverPort: number

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    // Emit 3 events with 50ms gaps — total ~150ms
    fakeAnvil = await startFakeSseServer({ eventCount: 3, delayBetweenEventsMs: 50 })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, fakeAnvil.url)

    app = await buildServer({ registryDb: db })
    serverPort = await listenOnFreePort(app)

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => fakeAnvil.server.close(() => res()))
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('events arrive as multiple chunks, not as one buffered blob', async () => {
    const { chunks, statusCode } = await collectChunksViaHttp(
      serverPort,
      '/api/events',
      validAuth,
    )

    expect(statusCode).toBe(200)

    // The key SSE property: upstream writes events with 50ms gaps, so the proxy
    // must NOT buffer and must forward each write as a separate TCP chunk.
    // With buffering disabled we expect >1 chunk (the frames arrive progressively).
    // With buffering enabled we'd get exactly 1 chunk (all frames at once at the end).
    // We tolerate >=2 chunks to account for TCP segment coalescing in degenerate cases.
    expect(chunks.length).toBeGreaterThan(1)

    // All event data must be present in the concatenated payload
    const full = Buffer.concat(chunks).toString('utf-8')
    expect(full).toContain('data: event-0')
    expect(full).toContain('data: event-1')
    expect(full).toContain('data: event-2')
  }, 5000)
})

// ---------------------------------------------------------------------------
// Suite C: Auth failure → 401
// ---------------------------------------------------------------------------

describe('TA-7 SSE proxy — no auth → 401', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
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
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
    })
    expect(res.statusCode).toBe(401)
  })

  it('401 body has code UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('UNAUTHORIZED')
  })
})

// ---------------------------------------------------------------------------
// Suite D: Registry miss → 425
// ---------------------------------------------------------------------------

describe('TA-7 SSE proxy — registry miss → 425', () => {
  let app: FastifyInstance
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb() // empty — no entries
    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/events with valid token but no registry entry returns 425', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(425)
  })

  it('425 response includes Retry-After header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('425 body has code REGISTRY_MISS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('REGISTRY_MISS')
  })
})

// ---------------------------------------------------------------------------
// Suite E: Instance unreachable → 502
// ---------------------------------------------------------------------------

describe('TA-7 SSE proxy — instance unreachable → 502', () => {
  let app: FastifyInstance
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    // Point at a port with nothing listening
    seedEntry(db, TENANT, USER, 'http://127.0.0.1:19998')

    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/events to unreachable upstream returns 502', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(502)
  })

  it('502 body has code UPSTREAM_UNAVAILABLE', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('UPSTREAM_UNAVAILABLE')
  })
})

// ---------------------------------------------------------------------------
// Suite F: Upstream close propagates to client
// ---------------------------------------------------------------------------

describe('TA-7 SSE proxy — upstream close propagates', () => {
  let app: FastifyInstance
  let fakeAnvil: Awaited<ReturnType<typeof startFakeSseServer>>
  let validAuth: string
  let serverPort: number

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    // Server emits 1 event then closes immediately
    fakeAnvil = await startFakeSseServer({ eventCount: 1, delayBetweenEventsMs: 10 })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, fakeAnvil.url)

    app = await buildServer({ registryDb: db })
    serverPort = await listenOnFreePort(app)

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((res) => fakeAnvil.server.close(() => res()))
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('client stream ends when upstream closes', async () => {
    // If the proxy leaks, this promise would never resolve. The test timeout
    // acts as the guard.
    const { chunks, statusCode } = await collectChunksViaHttp(
      serverPort,
      '/api/events',
      validAuth,
    )

    expect(statusCode).toBe(200)
    // Should have received the 1 event and then stream ended cleanly
    const full = Buffer.concat(chunks).toString('utf-8')
    expect(full).toContain('data: event-0')
  }, 5000)
})
