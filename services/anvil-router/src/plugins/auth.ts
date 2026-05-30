/**
 * Fastify auth plugin for anvil-router.
 *
 * Registers a preHandler hook that verifies the inbound JWT on every route
 * except /health and /metrics. Uses hardenedVerifier(createJwtVerifier(...), expectedTenant)
 * for defense-in-depth double-check on the tenant claim (top-level fork 4).
 *
 * Configuration (env vars):
 *   ANVIL_ROUTER_TENANT      — required, the expected tenant string
 *   ANVIL_ROUTER_JWKS_JSON   — required, JSON string of a JWK set { keys: [...] }
 *
 * On success: attaches Principal to request.principal and the raw Authorization
 * header to request.forwardedAuth (for downstream proxy stories TA-5/6/7).
 *
 * On failure:
 *   - missing/invalid/expired token → 401 { error: { code: "UNAUTHORIZED", message, request_id } }
 *   - tenant mismatch             → 403 { error: { code: "TENANT_MISMATCH", message, request_id } }
 *
 * TA-10: error envelopes include request_id from request.requestId (set by observability plugin).
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import {
  createJwtVerifier,
  createLocalJwkSet,
  hardenedVerifier,
  type CredentialVerifier,
} from '@horus/auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthPluginOptions {
  /** Override the verifier (used in tests via buildServer options injection). */
  verifier?: CredentialVerifier
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  // Build the verifier from env unless an override is provided (test seam).
  let verifier: CredentialVerifier

  if (opts.verifier) {
    verifier = opts.verifier
  } else {
    const expectedTenant = process.env['ANVIL_ROUTER_TENANT']
    const jwksJson = process.env['ANVIL_ROUTER_JWKS_JSON']

    if (!expectedTenant) {
      throw new Error('ANVIL_ROUTER_TENANT env var is required for auth plugin')
    }
    if (!jwksJson) {
      throw new Error('ANVIL_ROUTER_JWKS_JSON env var is required for auth plugin')
    }

    let jwkKeys: Array<Record<string, unknown>>
    try {
      const parsed = JSON.parse(jwksJson) as { keys: Array<Record<string, unknown>> }
      jwkKeys = parsed.keys
    } catch {
      throw new Error('ANVIL_ROUTER_JWKS_JSON must be valid JSON with a "keys" array')
    }

    // Build LocalJwkSet from the parsed JWKS
    const localJwkSet = createLocalJwkSet(
      jwkKeys.map((k) => ({
        kid: k['kid'] as string,
        publicJwk: k,
      })),
    )

    const baseVerifier = createJwtVerifier({ jwks: localJwkSet, expectedTenant })
    // Double-verify: hardenedVerifier adds a structural tenant floor on top of the base verifier
    verifier = hardenedVerifier(baseVerifier, expectedTenant)
  }

  // -------------------------------------------------------------------------
  // preHandler hook — runs on every request
  // -------------------------------------------------------------------------
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // /health and /metrics bypass auth (TA-10: metrics must be unauthenticated)
    const routeUrl = request.routeOptions.url
    if (routeUrl === '/health' || routeUrl === '/metrics') return

    const authHeader = request.headers['authorization']
    // TA-10: include request_id in all error envelopes (set by observability plugin's onRequest hook)
    const requestId = request.requestId ?? (request.headers['x-request-id'] as string | undefined) ?? 'unknown'

    if (!authHeader) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Authorization header',
          request_id: requestId,
        },
      })
    }

    try {
      const principal = await verifier.verify(authHeader)
      // Attach principal and forward the original header for downstream proxies
      request.principal = principal
      request.forwardedAuth = authHeader
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // Tenant mismatch errors get 403; all other verify errors get 401
      const isTenantMismatch =
        message.includes('Tenant mismatch') ||
        message.includes('Tenant isolation violation') ||
        message.includes('tenant mismatch')

      if (isTenantMismatch) {
        return reply.status(403).send({
          error: {
            code: 'TENANT_MISMATCH',
            message,
            request_id: requestId,
          },
        })
      }

      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message,
          request_id: requestId,
        },
      })
    }
  })
}

export default fp(authPlugin, {
  name: 'auth',
  fastify: '4.x',
})
