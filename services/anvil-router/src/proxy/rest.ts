/**
 * REST proxy route handler (TA-6).
 *
 * Handles ALL /api/* requests EXCEPT /api/events (SSE — reserved for TA-7).
 * Resolves the authenticated Principal to a per-user Anvil instance URL via
 * the RegistryReader, then proxies the request transparently using
 * @fastify/reply-from.
 *
 * Locked decisions applied:
 *   Q1:  @fastify/reply-from for proxy primitives
 *   Fork 3: Router proxies both MCP-over-HTTP and REST (this file = REST path)
 *
 * Header contract:
 *   - Authorization:  forwarded as request.forwardedAuth (the original user token)
 *   - Content-Type:   forwarded verbatim
 *   - Accept:         forwarded verbatim
 *   - Host:           rewritten to the upstream target (reply-from handles this)
 *
 * Error mapping:
 *   - RegistryMissError (REGISTRY_MISS) → 425 Too Early
 *   - Upstream unreachable (ECONNREFUSED/etc.)  → 502 Bad Gateway
 *   - Upstream application errors (4xx/5xx)     → forwarded verbatim
 *
 * Out of scope for TA-6:
 *   - SSE GET streaming (GET /api/events) — covered by TA-7
 *   - MCP-over-HTTP proxying (/mcp) — covered by TA-5
 *   - Response body transformation or caching
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RegistryReader } from '../registry/index.js'
import { RouteResolutionError } from '@horus/router-core'
import { sendRouteResolutionError } from '../errors.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The SSE path that TA-7 owns. The REST proxy must not match this path.
 * We register an explicit wildcard and check the incoming URL at handler time
 * so TA-7 can register its own route without ordering conflicts.
 */
const SSE_PATH = '/api/events'

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Register the wildcard /api/* proxy route on the given Fastify instance.
 *
 * The route is added AFTER the auth plugin (which runs in preHandler) and
 * AFTER the MCP proxy, so request.principal and request.forwardedAuth are
 * always populated when this handler runs.
 *
 * TA-7 (SSE) should register its GET /api/events route BEFORE this handler
 * so that Fastify's route matching resolves the more-specific SSE route first.
 * This handler defends in depth by checking and skipping the SSE path anyway.
 *
 * @param fastify   The Fastify instance (already has reply-from registered).
 * @param registry  The RegistryReader singleton (injected from app.ts).
 */
export function registerRestProxyRoute(
  fastify: FastifyInstance,
  registry: RegistryReader,
): void {
  /**
   * ALL /api/* — proxy any REST method to the per-user Anvil REST endpoint.
   *
   * The auth preHandler has already verified the JWT and set:
   *   request.principal    — { tenant, user, role }
   *   request.forwardedAuth — "Bearer <token>" for forwarding
   *
   * We use Fastify's wildcard `*` syntax to match all methods and all sub-paths
   * under /api/. The constraint `constraints: { version: undefined }` is not
   * needed here; we rely on method-wildcard routing.
   */
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const) {
    fastify.route({
      method,
      url: '/api/*',
      // Disable body parsing — stream the raw body to upstream unchanged.
      config: { rawBody: false },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        // ── SSE exclusion fence ───────────────────────────────────────────────
        // /api/events is TA-7's surface. If for any reason Fastify routes a
        // request here before TA-7 registers its own route, we return 404 to
        // avoid accidentally proxying a long-lived SSE connection through the
        // stateless REST handler.
        const rawUrl = request.raw.url ?? request.url
        const pathOnly = rawUrl.split('?')[0]
        if (pathOnly === SSE_PATH) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Route not found' },
          })
        }

        const principal = request.principal
        if (!principal) {
          // Should never happen — auth preHandler runs before this — but guard defensively.
          return reply.status(401).send({
            error: { code: 'UNAUTHORIZED', message: 'Missing principal' },
          })
        }

        // ── 1. Resolve Principal → Anvil instance URL ──────────────────────────
        let instanceUrl: string
        try {
          const entry = registry.lookup(principal.tenant, principal.user)
          instanceUrl = entry.url
        } catch (err) {
          if (err instanceof RouteResolutionError) {
            return sendRouteResolutionError(reply, err)
          }
          throw err
        }

        // The upstream URL is the instance base URL + the full incoming path + query
        // e.g. /api/notes/abc?foo=bar → http://anvil-user-1/api/notes/abc?foo=bar
        const upstreamBase = instanceUrl.replace(/\/$/, '')
        const incomingPathAndQuery = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
        const upstreamTarget = upstreamBase + incomingPathAndQuery

        // ── 2. Proxy via reply-from ─────────────────────────────────────────────
        //
        // reply.from() streams the request/response bodies through without buffering.
        // The upstream Anvil application errors (404, 422, etc.) are forwarded
        // verbatim — we do NOT remap them.
        return reply.from(upstreamTarget, {
          rewriteRequestHeaders: (_originalRequest, headers) => {
            // Forward the user token exactly as stored by the auth plugin
            if (request.forwardedAuth) {
              headers['authorization'] = request.forwardedAuth
            }
            // Remove transfer-encoding to avoid double-chunking
            delete headers['transfer-encoding']
            return headers
          },
          onError: (_reply, error) => {
            // Map upstream connection errors to 502 Bad Gateway.
            // reply-from passes { error: Error } — extract the inner error first
            // (same pattern as mcp.ts, per convention 5).
            const inner = error.error as Error & { code?: string; statusCode?: number }
            const msg = inner.message ?? String(inner)
            const nodeCode = inner.code
            const is5xx =
              nodeCode === 'ECONNREFUSED' ||
              nodeCode === 'ECONNRESET' ||
              nodeCode === 'ETIMEDOUT' ||
              nodeCode === 'ENOTFOUND' ||
              nodeCode === 'ERR_GOT_REQUEST_BODY' ||
              // reply-from wraps node errors in a FastifyError; check statusCode
              inner.statusCode === 502 ||
              inner.statusCode === 503 ||
              inner.statusCode === 504

            if (is5xx || !_reply.sent) {
              void _reply.status(502).send({
                error: {
                  code: 'UPSTREAM_UNAVAILABLE',
                  message: `Upstream Anvil instance unreachable: ${msg}`,
                },
              })
            }
          },
        })
      },
    })
  }
}
