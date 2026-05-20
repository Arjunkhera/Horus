/**
 * TA-6: RED spec — REST proxy via @fastify/reply-from
 *
 * AC covered:
 *   (a) Happy path: GET /api/notes/:id round-trip — valid JWT + Principal in
 *       registry → request forwarded to <instanceUrl>/api/notes/:id, response
 *       status and body returned verbatim
 *   (b) POST /api/search with JSON body — body and headers forwarded verbatim
 *   (c) 404 from upstream forwarded as 404 (not remapped)
 *   (d) 425 Too Early on registry miss (authenticated, no entry)
 *   (e) 401 when Authorization header is absent (delegated to auth plugin)
 *   (f) 502 Bad Gateway when instance is unreachable
 *   (g) Query string preserved when proxying GET requests
 *   (h) Request body preserved for PUT requests
 *   (i) DELETE /api/notes/:id forwarded verbatim
 *   (j) /api/events is NOT proxied by the REST handler (SSE — TA-7 surface)
 *
 * Fake-upstream pattern mirrors mcp-proxy.test.ts exactly.
 * Out of scope: SSE proxying (TA-7), response caching, request body transforms.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
// Minimal fake upstream Anvil REST server
// ---------------------------------------------------------------------------

interface FakeAnvilOpts {
  responseBody?: string
  responseStatus?: number
  responseHeaders?: Record<string, string>
  /** If true the server immediately destroys the connection (simulates unreachable) */
  destroyImmediately?: boolean
}

interface FakeAnvil {
  server: Server
  url: string
  readonly receivedHeaders: Record<string, string | string[]>
  readonly receivedBody: string
  readonly receivedUrl: string
  readonly receivedMethod: string
}

function startFakeAnvil(opts: FakeAnvilOpts = {}): Promise<FakeAnvil> {
  return new Promise((resolve, reject) => {
    const state = {
      receivedHeaders: {} as Record<string, string | string[]>,
      receivedBody: '',
      receivedUrl: '',
      receivedMethod: '',
    }

    const server = createServer((req, res) => {
      if (opts.destroyImmediately) {
        req.socket.destroy()
        return
      }

      state.receivedHeaders = { ...req.headers } as Record<string, string | string[]>
      state.receivedUrl = req.url ?? ''
      state.receivedMethod = req.method ?? ''

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.receivedBody = Buffer.concat(chunks).toString('utf-8')

        const body =
          opts.responseBody ??
          JSON.stringify({ ok: true, data: 'fake-anvil-response' })

        const headers: Record<string, string> = {
          'content-type': 'application/json',
          ...(opts.responseHeaders ?? {}),
        }

        res.writeHead(opts.responseStatus ?? 200, headers)
        res.end(body)
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        get receivedHeaders() { return state.receivedHeaders },
        get receivedBody() { return state.receivedBody },
        get receivedUrl() { return state.receivedUrl },
        get receivedMethod() { return state.receivedMethod },
      })
    })

    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Test-wide fixtures
// ---------------------------------------------------------------------------

const TENANT = 'rest-proxy-test-tenant'
const USER = 'alice'

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
// Suite A: GET /api/notes/:id — happy path round-trip
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — GET /api/notes/:id happy path', () => {
  let app: FastifyInstance
  let fakeAnvil: FakeAnvil
  let validAuth: string

  const NOTE_ID = 'note-abc-123'
  const NOTE_BODY = JSON.stringify({ noteId: NOTE_ID, title: 'Test Note', body: 'hello' })

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil({ responseBody: NOTE_BODY })

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

  it('GET /api/notes/:id returns 200 from upstream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/notes/${NOTE_ID}`,
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(200)
  })

  it('response body is forwarded verbatim from upstream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/notes/${NOTE_ID}`,
      headers: { authorization: validAuth },
    })
    expect(JSON.parse(res.payload)).toMatchObject({ noteId: NOTE_ID })
  })

  it('upstream receives request at /api/notes/:id path', async () => {
    await app.inject({
      method: 'GET',
      url: `/api/notes/${NOTE_ID}`,
      headers: { authorization: validAuth },
    })
    expect(fakeAnvil.receivedUrl).toContain(`/api/notes/${NOTE_ID}`)
  })

  it('Authorization header forwarded to upstream', async () => {
    await app.inject({
      method: 'GET',
      url: `/api/notes/${NOTE_ID}`,
      headers: { authorization: validAuth },
    })
    expect(fakeAnvil.receivedHeaders['authorization']).toBe(validAuth)
  })
})

// ---------------------------------------------------------------------------
// Suite B: DELETE /api/notes/:id — method forwarding
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — DELETE /api/notes/:id method forwarding', () => {
  let app: FastifyInstance
  let fakeAnvil: FakeAnvil
  let validAuth: string

  const NOTE_ID = 'note-to-delete-456'

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil({ responseBody: JSON.stringify({ ok: true }) })

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

  it('DELETE /api/notes/:id returns 200 from upstream', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/notes/${NOTE_ID}`,
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(200)
  })

  it('upstream receives DELETE method', async () => {
    await app.inject({
      method: 'DELETE',
      url: `/api/notes/${NOTE_ID}`,
      headers: { authorization: validAuth },
    })
    expect(fakeAnvil.receivedMethod).toBe('DELETE')
  })
})

// ---------------------------------------------------------------------------
// Suite C: POST /api/search — body and query string forwarding
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — POST /api/search with body', () => {
  let app: FastifyInstance
  let fakeAnvil: FakeAnvil
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil({
      responseBody: JSON.stringify({ results: [{ noteId: 'abc' }] }),
    })

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

  it('POST /api/search returns 200 from upstream', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ query: 'test', type: 'note' }),
    })
    expect(res.statusCode).toBe(200)
  })

  it('request JSON body is forwarded verbatim to upstream', async () => {
    const searchBody = { query: 'hello world', type: 'note', limit: 10 }
    await app.inject({
      method: 'POST',
      url: '/api/search',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify(searchBody),
    })
    const received = JSON.parse(fakeAnvil.receivedBody)
    expect(received).toMatchObject(searchBody)
  })

  it('response body from upstream is forwarded verbatim', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ query: 'test' }),
    })
    const body = JSON.parse(res.payload)
    expect(body).toMatchObject({ results: [{ noteId: 'abc' }] })
  })
})

// ---------------------------------------------------------------------------
// Suite D: Query string preservation
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — query string preserved', () => {
  let app: FastifyInstance
  let fakeAnvil: FakeAnvil
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil()

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

  it('query string is forwarded verbatim to upstream', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/notes/abc-123?include=edges&format=json',
      headers: { authorization: validAuth },
    })
    expect(fakeAnvil.receivedUrl).toContain('include=edges')
    expect(fakeAnvil.receivedUrl).toContain('format=json')
  })
})

// ---------------------------------------------------------------------------
// Suite E: PUT with body
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — PUT /api/notes/:id body preserved', () => {
  let app: FastifyInstance
  let fakeAnvil: FakeAnvil
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil({ responseBody: JSON.stringify({ ok: true }) })

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

  it('PUT /api/notes/:id body is forwarded verbatim', async () => {
    const putBody = { title: 'Updated Title', body: 'Updated content here' }
    await app.inject({
      method: 'PUT',
      url: '/api/notes/note-put-789',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify(putBody),
    })
    const received = JSON.parse(fakeAnvil.receivedBody)
    expect(received).toMatchObject(putBody)
  })
})

// ---------------------------------------------------------------------------
// Suite F: Upstream status passthrough (404 forwarded verbatim)
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — upstream status code passthrough', () => {
  let app: FastifyInstance
  let fakeAnvil: FakeAnvil
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil({
      responseStatus: 404,
      responseBody: JSON.stringify({ error: true, code: 'NOT_FOUND', message: 'Note not found' }),
    })

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

  it('404 from upstream is forwarded as 404 to client (not remapped)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/nonexistent-note',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(404)
  })

  it('404 body from upstream forwarded verbatim', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/nonexistent-note',
      headers: { authorization: validAuth },
    })
    const body = JSON.parse(res.payload)
    expect(body.code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// Suite G: Auth failure → 401
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — auth failure → 401', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, 'http://127.0.0.1:9998') // won't be reached

    app = await buildServer({ registryDb: db })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/notes/:id without Authorization returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/some-note',
    })
    expect(res.statusCode).toBe(401)
  })

  it('401 body has code UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/some-note',
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('UNAUTHORIZED')
  })
})

// ---------------------------------------------------------------------------
// Suite H: Registry miss → 425
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — registry miss → 425', () => {
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

  it('GET /api/notes/:id with valid token but no registry entry returns 425', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/missing-note',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(425)
  })

  it('425 response includes Retry-After header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/missing-note',
      headers: { authorization: validAuth },
    })
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('425 body has code REGISTRY_MISS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/missing-note',
      headers: { authorization: validAuth },
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('REGISTRY_MISS')
  })
})

// ---------------------------------------------------------------------------
// Suite I: Instance unreachable → 502
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — instance unreachable → 502', () => {
  let app: FastifyInstance
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, 'http://127.0.0.1:19998') // bound to nothing

    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/notes/:id to unreachable instance returns 502', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes/unreachable',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).toBe(502)
  })
})

// ---------------------------------------------------------------------------
// Suite J: /api/events is NOT handled by REST proxy (SSE — TA-7 surface)
// ---------------------------------------------------------------------------

describe('TA-6 REST proxy — /api/events NOT proxied by REST handler', () => {
  let app: FastifyInstance
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, 'http://127.0.0.1:9997') // would be proxied if REST handled it

    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('GET /api/events is NOT proxied by the REST handler (returns 404, not 502)', async () => {
    // The REST handler must NOT match /api/events. Since TA-7 is not yet wired,
    // a request to /api/events should yield 404 from Fastify (no route matched),
    // NOT 502 (which would mean the REST proxy attempted to proxy it and failed).
    // This is the key invariant: the REST proxy leaves /api/events as a hole.
    const res = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: { authorization: validAuth },
    })
    expect(res.statusCode).not.toBe(502)
    // It should be a clean 404 from the router — not a proxy error
    expect(res.statusCode).toBe(404)
  })
})
