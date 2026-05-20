/**
 * TA-4: RED spec — Fastify auth plugin with hardenedVerifier double-verify
 *
 * Tests verify that:
 * - Valid JWT with correct tenant → 200, request.principal populated
 * - Missing Authorization header → 401
 * - Invalid JWT (bad signature) → 401
 * - Expired JWT → 401
 * - Wrong tenant (token claims different tenant than expectedTenant) → 403
 * - /health endpoint bypasses auth → 200 with no token
 * - Token forwarding: plugin attaches raw Authorization header to request for downstream use
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtProvider,
  type JwtKeyPair,
  type Principal,
} from '@horus/auth'
import { SignJWT } from 'jose'
import { buildServer } from '../src/app.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const EXPECTED_TENANT = 'test-tenant'
const TEST_USER = 'alice'
const TEST_ROLE = 'admin'

let keyPair: JwtKeyPair

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeValidToken(opts?: {
  tenant?: string
  user?: string
  role?: string
  ttlSeconds?: number
}): Promise<string> {
  const provider = createJwtProvider({
    privateKey: keyPair.privateKey,
    kid: keyPair.kid,
    alg: 'RS256',
    tenant: opts?.tenant ?? EXPECTED_TENANT,
    user: opts?.user ?? TEST_USER,
    role: opts?.role ?? TEST_ROLE,
    ttlSeconds: opts?.ttlSeconds ?? 300,
  })
  const header = await provider.authorizationHeader()
  return header // "Bearer <token>"
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TA-4 auth middleware', () => {
  let app: FastifyInstance
  let validAuthHeader: string

  beforeAll(async () => {
    // Generate the key pair used for signing test JWTs
    keyPair = await createJwtKeyPair({ alg: 'RS256' })

    // Build the JWKS and expose it via env so the plugin can consume it
    const jwks = createLocalJwkSet([{ kid: keyPair.kid, publicJwk: keyPair.publicJwk }])

    // The plugin reads expectedTenant from env ANVIL_ROUTER_TENANT
    process.env['ANVIL_ROUTER_TENANT'] = EXPECTED_TENANT
    // Provide a JSON JWKS via env so the plugin has keys
    process.env['ANVIL_ROUTER_JWKS_JSON'] = JSON.stringify({
      keys: [{ ...keyPair.publicJwk, kid: keyPair.kid, alg: 'RS256' }],
    })

    app = await buildServer()
    await app.ready()

    validAuthHeader = await makeValidToken()
  })

  afterAll(async () => {
    await app.close()
    delete process.env['ANVIL_ROUTER_TENANT']
    delete process.env['ANVIL_ROUTER_JWKS_JSON']
  })

  // -------------------------------------------------------------------------
  // /health bypasses auth — no token required
  // -------------------------------------------------------------------------

  describe('/health bypass', () => {
    it('GET /health returns 200 without any Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    })

    it('GET /health body is { status: "ok" }', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      const body = JSON.parse(res.payload)
      expect(body.status).toBe('ok')
    })
  })

  // -------------------------------------------------------------------------
  // Happy path — valid JWT with correct tenant
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('request with valid JWT returns 200 (or proxied response) not 401', async () => {
      // We hit a test echo route /echo-principal that the auth spec registers
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: validAuthHeader },
      })
      // Should NOT be 401 — the auth plugin must pass it through
      expect(res.statusCode).not.toBe(401)
      expect(res.statusCode).not.toBe(403)
    })

    it('principal is attached to request after successful verify', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: validAuthHeader },
      })
      const body = JSON.parse(res.payload) as { principal: Principal }
      expect(body.principal).toBeDefined()
      expect(body.principal.tenant).toBe(EXPECTED_TENANT)
      expect(body.principal.user).toBe(TEST_USER)
      expect(body.principal.role).toBe(TEST_ROLE)
    })

    it('forwarded token is attached to request.forwardedAuth for downstream use', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: validAuthHeader },
      })
      const body = JSON.parse(res.payload) as {
        principal: Principal
        forwardedAuth: string
      }
      expect(body.forwardedAuth).toBe(validAuthHeader)
    })
  })

  // -------------------------------------------------------------------------
  // Missing Authorization header → 401
  // -------------------------------------------------------------------------

  describe('missing Authorization header', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
      })
      expect(res.statusCode).toBe(401)
    })

    it('401 body has code UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
      })
      const body = JSON.parse(res.payload)
      expect(body.error?.code).toBe('UNAUTHORIZED')
    })
  })

  // -------------------------------------------------------------------------
  // Invalid JWT (bad signature) → 401
  // -------------------------------------------------------------------------

  describe('invalid JWT', () => {
    it('returns 401 for a tampered/invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: 'Bearer this.is.notavalidjwt' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('401 body has code UNAUTHORIZED for invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: 'Bearer this.is.notavalidjwt' },
      })
      const body = JSON.parse(res.payload)
      expect(body.error?.code).toBe('UNAUTHORIZED')
    })
  })

  // -------------------------------------------------------------------------
  // Expired JWT → 401
  // -------------------------------------------------------------------------

  describe('expired JWT', () => {
    it('returns 401 for an expired token (ttl=1s)', async () => {
      // Craft an expired token by minting with a past expiry using SignJWT from jose
      const nowSec = Math.floor(Date.now() / 1000)
      const expiredToken = await new SignJWT({
        tenant: EXPECTED_TENANT,
        user: TEST_USER,
        role: TEST_ROLE,
      })
        .setProtectedHeader({ alg: 'RS256', kid: keyPair.kid })
        .setIssuedAt(nowSec - 3600)
        .setExpirationTime(nowSec - 1800) // expired 30 min ago
        .sign(keyPair.privateKey)

      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: `Bearer ${expiredToken}` },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  // Wrong tenant → 403
  // -------------------------------------------------------------------------

  describe('wrong tenant', () => {
    it('returns 403 when token has different tenant than expectedTenant', async () => {
      const wrongTenantHeader = await makeValidToken({ tenant: 'attacker-tenant' })
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: wrongTenantHeader },
      })
      expect(res.statusCode).toBe(403)
    })

    it('403 body has code TENANT_MISMATCH', async () => {
      const wrongTenantHeader = await makeValidToken({ tenant: 'attacker-tenant' })
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: wrongTenantHeader },
      })
      const body = JSON.parse(res.payload)
      expect(body.error?.code).toBe('TENANT_MISMATCH')
    })
  })

  // -------------------------------------------------------------------------
  // Token forwarding — plugin stores the original token for downstream proxy use
  // -------------------------------------------------------------------------

  describe('token forwarding', () => {
    it('forwardedAuth on request matches the original Authorization header verbatim', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/echo-principal',
        headers: { authorization: validAuthHeader },
      })
      const body = JSON.parse(res.payload) as { forwardedAuth: string }
      // The exact header value must be forwarded verbatim — proxy stories TA-5/6/7 depend on this
      expect(body.forwardedAuth).toBe(validAuthHeader)
    })
  })
})
