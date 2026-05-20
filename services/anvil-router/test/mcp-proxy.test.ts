/**
 * TA-5: RED spec — MCP-over-HTTP proxy via @fastify/reply-from
 *
 * AC covered:
 *   (a) Happy path: valid JWT + Principal in registry → request forwarded to
 *       <instanceUrl>/mcp, response streamed back, mcp-session-id header preserved
 *   (b) Registry miss (authenticated but no record) → 425 Too Early
 *   (c) Auth failure (missing token) → 401 (delegated to TA-4 auth plugin)
 *   (d) Instance unreachable (upstream ECONNREFUSED) → 502 Bad Gateway
 *   (e) Header preservation: mcp-session-id, Accept, Content-Type forwarded;
 *       Authorization carries the forwarded user token
 *   (f) POST streaming body: large JSON-RPC payload (~1MB) forwarded without buffering
 *
 * Note: GET SSE-style proxying is out of scope for TA-5 (covered by TA-7).
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
// SQLite helpers (mirrors registry.test.ts pattern)
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
// Minimal fake upstream Anvil server
// ---------------------------------------------------------------------------

interface FakeAnvilOpts {
  /** Response body to return. Default: canned tools/list JSON-RPC response */
  responseBody?: string
  responseStatus?: number
  responseHeaders?: Record<string, string>
  /** If true the server immediately destroys the connection (simulates unreachable) */
  destroyImmediately?: boolean
}

function startFakeAnvil(opts: FakeAnvilOpts = {}): Promise<{ server: Server; url: string; receivedHeaders: Record<string, string | string[]>; receivedBody: string }> {
  return new Promise((resolve, reject) => {
    const state = {
      receivedHeaders: {} as Record<string, string | string[]>,
      receivedBody: '',
    }

    const server = createServer((req, res) => {
      if (opts.destroyImmediately) {
        req.socket.destroy()
        return
      }

      state.receivedHeaders = { ...req.headers } as Record<string, string | string[]>

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        state.receivedBody = Buffer.concat(chunks).toString('utf-8')

        const body =
          opts.responseBody ??
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { tools: [] },
          })

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
        get receivedHeaders() {
          return state.receivedHeaders
        },
        get receivedBody() {
          return state.receivedBody
        },
      })
    })

    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Test-wide fixtures
// ---------------------------------------------------------------------------

const TENANT = 'mcp-proxy-test-tenant'
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
// Suite A: Happy-path forwarding
// ---------------------------------------------------------------------------

describe('TA-5 MCP proxy — happy path', () => {
  let app: FastifyInstance
  let fakeAnvil: Awaited<ReturnType<typeof startFakeAnvil>>
  let validAuth: string

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })
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

  it('POST /mcp returns 200 when upstream responds 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(200)
  })

  it('response body is forwarded verbatim from upstream', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    const body = JSON.parse(res.payload)
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      result: { tools: [] },
    })
  })

  it('upstream receives the request at /mcp path', async () => {
    await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    // The fake anvil recorded the headers — confirm it was reached
    expect(fakeAnvil.receivedHeaders['authorization']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Suite B: mcp-session-id header preservation
// ---------------------------------------------------------------------------

describe('TA-5 MCP proxy — session ID round-trip', () => {
  let app: FastifyInstance
  let fakeAnvil: Awaited<ReturnType<typeof startFakeAnvil>>
  let validAuth: string

  const SESSION_ID = 'test-session-abc-123'

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    fakeAnvil = await startFakeAnvil({
      responseHeaders: { 'mcp-session-id': SESSION_ID },
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

  it('mcp-session-id header sent upstream is preserved', async () => {
    await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
        'mcp-session-id': SESSION_ID,
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(fakeAnvil.receivedHeaders['mcp-session-id']).toBe(SESSION_ID)
  })

  it('mcp-session-id header returned from upstream is forwarded to client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.headers['mcp-session-id']).toBe(SESSION_ID)
  })

  it('Authorization header forwarded to upstream carries the forwarded user token', async () => {
    await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(fakeAnvil.receivedHeaders['authorization']).toBe(validAuth)
  })

  it('Content-Type forwarded verbatim to upstream', async () => {
    await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(fakeAnvil.receivedHeaders['content-type']).toContain('application/json')
    expect(fakeAnvil.receivedHeaders['accept']).toBe('application/json')
  })
})

// ---------------------------------------------------------------------------
// Suite C: Auth failure → 401
// ---------------------------------------------------------------------------

describe('TA-5 MCP proxy — auth failure', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    seedEntry(db, TENANT, USER, 'http://127.0.0.1:9999') // doesn't matter — auth blocks first

    app = await buildServer({ registryDb: db })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('POST /mcp without Authorization header returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(401)
  })

  it('401 body has code UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('UNAUTHORIZED')
  })
})

// ---------------------------------------------------------------------------
// Suite D: Registry miss → 425
// ---------------------------------------------------------------------------

describe('TA-5 MCP proxy — registry miss → 425', () => {
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

  it('POST /mcp with valid token but no registry entry returns 425', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(425)
  })

  it('425 response includes Retry-After header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('425 body has code REGISTRY_MISS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    const body = JSON.parse(res.payload)
    expect(body.error?.code).toBe('REGISTRY_MISS')
  })
})

// ---------------------------------------------------------------------------
// Suite E: Instance unreachable → 502
// ---------------------------------------------------------------------------

describe('TA-5 MCP proxy — instance unreachable → 502', () => {
  let app: FastifyInstance
  let validAuth: string

  beforeAll(async () => {
    keyPair = keyPair ?? await createJwtKeyPair({ alg: 'RS256' })
    process.env['ANVIL_ROUTER_TENANT'] = TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    const db = createMemoryDb()
    // Point at a port that's bound to nothing (use a high port unlikely to be in use)
    seedEntry(db, TENANT, USER, 'http://127.0.0.1:19999')

    app = await buildServer({ registryDb: db })
    await app.ready()

    validAuth = await makeAuthHeader()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  it('POST /mcp to unreachable instance returns 502', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.statusCode).toBe(502)
  })
})

// ---------------------------------------------------------------------------
// Suite F: Large payload streaming (>1 MB body)
// ---------------------------------------------------------------------------

describe('TA-5 MCP proxy — large JSON-RPC body streaming', () => {
  let app: FastifyInstance
  let fakeAnvil: Awaited<ReturnType<typeof startFakeAnvil>>
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

  it('forwards a ~1MB JSON-RPC payload to upstream correctly', async () => {
    // Build a ~1MB payload: embed a large string in params
    const largeString = 'x'.repeat(1024 * 1024) // 1 MB of 'x'
    const largePayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method: 'notes/createBulk',
      params: { data: largeString },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: validAuth,
        'content-type': 'application/json',
      },
      payload: largePayload,
    })

    expect(res.statusCode).toBe(200)
    // Upstream received the body intact
    const upstream = JSON.parse(fakeAnvil.receivedBody)
    expect(upstream.params.data).toHaveLength(1024 * 1024)
  })
})
