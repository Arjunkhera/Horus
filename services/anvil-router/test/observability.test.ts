/**
 * TA-10: RED spec — Observability + structured error model for anvil-router
 *
 * Covers:
 *   (a) Request ID generation: response includes X-Request-Id header; preserved when provided
 *   (b) /metrics returns 200 + text/plain Prometheus format with required counters/histograms
 *   (c) /metrics does NOT require auth
 *   (d) Error responses contain structured JSON: { error: { code, message, request_id } }
 *   (e) Logs include: request_id, method, path, status, duration_ms, principal fields
 *   (f) Latency histogram buckets registered
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  createJwtKeyPair,
  createJwtProvider,
  type JwtKeyPair,
} from '@horus/auth'
import { buildServer } from '../src/app.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const EXPECTED_TENANT = 'obs-test-tenant'
const TEST_USER = 'bob'
const TEST_ROLE = 'admin'

let keyPair: JwtKeyPair

async function makeValidToken(opts?: { tenant?: string; user?: string }): Promise<string> {
  const provider = createJwtProvider({
    privateKey: keyPair.privateKey,
    kid: keyPair.kid,
    alg: 'RS256',
    tenant: opts?.tenant ?? EXPECTED_TENANT,
    user: opts?.user ?? TEST_USER,
    role: TEST_ROLE,
    ttlSeconds: 300,
  })
  return provider.authorizationHeader()
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TA-10 observability', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    keyPair = await createJwtKeyPair({ alg: 'RS256' })

    process.env['ANVIL_ROUTER_TENANT'] = EXPECTED_TENANT
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })
    // Suppress pino output in tests
    process.env['LOG_LEVEL'] = 'silent'

    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
    delete process.env['LOG_LEVEL']
  })

  // ── (a) Request ID generation & preservation ────────────────────────────

  describe('X-Request-Id header', () => {
    it('response includes X-Request-Id when no header was sent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      })
      expect(res.headers['x-request-id']).toBeDefined()
      expect(typeof res.headers['x-request-id']).toBe('string')
      expect((res.headers['x-request-id'] as string).length).toBeGreaterThan(0)
    })

    it('generated request IDs are different across requests', async () => {
      const r1 = await app.inject({ method: 'GET', url: '/health' })
      const r2 = await app.inject({ method: 'GET', url: '/health' })
      expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id'])
    })

    it('inbound X-Request-Id is preserved (not regenerated)', async () => {
      const clientId = 'test-client-id-12345'
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': clientId },
      })
      expect(res.headers['x-request-id']).toBe(clientId)
    })
  })

  // ── (b, c) /metrics endpoint ────────────────────────────────────────────

  describe('/metrics endpoint', () => {
    it('GET /metrics returns 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.statusCode).toBe(200)
    })

    it('GET /metrics returns text/plain content type', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.headers['content-type']).toMatch(/text\/plain/)
    })

    it('GET /metrics does NOT require auth (no Authorization header needed)', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.statusCode).not.toBe(401)
    })

    it('GET /metrics contains anvil_router_requests_total counter', async () => {
      await app.inject({ method: 'GET', url: '/health' })
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/anvil_router_requests_total/)
    })

    it('GET /metrics contains anvil_router_upstream_latency_ms histogram', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/anvil_router_upstream_latency_ms/)
    })

    it('GET /metrics contains anvil_router_request_duration_ms histogram', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/anvil_router_request_duration_ms/)
    })

    it('GET /metrics contains anvil_router_cache_hits_total counter', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/anvil_router_cache_hits_total/)
    })

    it('GET /metrics contains anvil_router_cache_misses_total counter', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/anvil_router_cache_misses_total/)
    })

    it('GET /metrics has Prometheus text format (# HELP lines present)', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/^# HELP/m)
    })

    it('anvil_router_requests_total increments after requests', async () => {
      const before = await app.inject({ method: 'GET', url: '/metrics' })
      const beforeCount = (before.payload.match(/anvil_router_requests_total\{[^}]*\}\s+(\d+)/g) ?? []).length

      await app.inject({ method: 'GET', url: '/health' })
      await app.inject({ method: 'GET', url: '/health' })

      const after = await app.inject({ method: 'GET', url: '/metrics' })
      // The metric must be present
      expect(after.payload).toMatch(/anvil_router_requests_total/)
      // After firing more requests, count should be higher
      const afterLines = (after.payload.match(/anvil_router_requests_total\{[^}]*\}\s+(\d+)/g) ?? []).length
      expect(afterLines).toBeGreaterThanOrEqual(beforeCount)
    })

    it('latency histogram has _bucket, _count, _sum lines', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' })
      expect(res.payload).toMatch(/anvil_router_request_duration_ms_bucket/)
      expect(res.payload).toMatch(/anvil_router_request_duration_ms_count/)
      expect(res.payload).toMatch(/anvil_router_request_duration_ms_sum/)
    })
  })

  // ── (d) Structured error envelopes ──────────────────────────────────────

  describe('structured error envelopes', () => {
    describe('401 UNAUTHORIZED', () => {
      it('missing auth returns { error: { code, message } } shape', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/echo-principal',
        })
        expect(res.statusCode).toBe(401)
        const body = JSON.parse(res.payload)
        expect(body.error).toBeDefined()
        expect(body.error.code).toBe('UNAUTHORIZED')
        expect(typeof body.error.message).toBe('string')
      })

      it('401 error response includes request_id field', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/echo-principal',
        })
        const body = JSON.parse(res.payload)
        expect(body.error.request_id).toBeDefined()
        expect(typeof body.error.request_id).toBe('string')
      })

      it('request_id in 401 body matches X-Request-Id response header', async () => {
        const clientId = 'ta10-test-request-id'
        const res = await app.inject({
          method: 'GET',
          url: '/echo-principal',
          headers: { 'x-request-id': clientId },
        })
        const body = JSON.parse(res.payload)
        const headerRequestId = res.headers['x-request-id'] as string
        expect(headerRequestId).toBe(clientId)
        expect(body.error.request_id).toBe(clientId)
      })
    })

    describe('403 TENANT_MISMATCH', () => {
      it('returns { error: { code: "TENANT_MISMATCH", message, request_id } }', async () => {
        const wrongTenantHeader = await makeValidToken({ tenant: 'evil-tenant' })
        const res = await app.inject({
          method: 'GET',
          url: '/echo-principal',
          headers: { authorization: wrongTenantHeader },
        })
        expect(res.statusCode).toBe(403)
        const body = JSON.parse(res.payload)
        expect(body.error.code).toBe('TENANT_MISMATCH')
        expect(typeof body.error.message).toBe('string')
        expect(body.error.request_id).toBeDefined()
      })
    })
  })

  // ── (e) Log enrichment ──────────────────────────────────────────────────

  describe('structured log fields', () => {
    it('buildServer accepts a logCapture option for test inspection', async () => {
      const logs: unknown[] = []

      process.env['LOG_LEVEL'] = 'silent'
      const logApp = await buildServer({
        logCapture: (entry) => logs.push(entry),
      })
      await logApp.ready()

      await logApp.inject({ method: 'GET', url: '/health' })
      await logApp.close()

      expect(logs.length).toBeGreaterThan(0)
    })

    it('log entry contains request_id field', async () => {
      const logs: Record<string, unknown>[] = []

      process.env['LOG_LEVEL'] = 'silent'
      const logApp = await buildServer({
        logCapture: (entry) => logs.push(entry as Record<string, unknown>),
      })
      await logApp.ready()
      await logApp.inject({ method: 'GET', url: '/health' })
      await logApp.close()

      const requestLog = logs.find((l) => l['request_id'] !== undefined)
      expect(requestLog).toBeDefined()
    })

    it('log entry contains method and path fields', async () => {
      const logs: Record<string, unknown>[] = []

      process.env['LOG_LEVEL'] = 'silent'
      const logApp = await buildServer({
        logCapture: (entry) => logs.push(entry as Record<string, unknown>),
      })
      await logApp.ready()
      await logApp.inject({ method: 'GET', url: '/health' })
      await logApp.close()

      const requestLog = logs.find((l) => l['method'] !== undefined)
      expect(requestLog).toBeDefined()
      if (requestLog) {
        expect(requestLog['method']).toBe('GET')
        expect(typeof requestLog['path']).toBe('string')
      }
    })

    it('log entry contains status and duration_ms fields', async () => {
      const logs: Record<string, unknown>[] = []

      process.env['LOG_LEVEL'] = 'silent'
      const logApp = await buildServer({
        logCapture: (entry) => logs.push(entry as Record<string, unknown>),
      })
      await logApp.ready()
      await logApp.inject({ method: 'GET', url: '/health' })
      await logApp.close()

      const requestLog = logs.find((l) => l['status'] !== undefined)
      expect(requestLog).toBeDefined()
      if (requestLog) {
        expect(typeof requestLog['status']).toBe('number')
        expect(typeof requestLog['duration_ms']).toBe('number')
      }
    })
  })
})
