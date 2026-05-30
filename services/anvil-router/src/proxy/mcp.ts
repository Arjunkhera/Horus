/**
 * MCP-over-HTTP proxy route handler (TA-5).
 *
 * Handles POST /mcp requests. Resolves the authenticated Principal
 * to a per-user Anvil instance URL via the RegistryReader, then
 * proxies the request transparently using @fastify/reply-from.
 *
 * Locked decisions applied:
 *   Q1:  @fastify/reply-from for proxy primitives
 *   Q6:  Local backend speaks MCP-over-HTTP to anvil-router
 *   Fork 3: Router proxies MCP-over-HTTP (this file = MCP path; REST = TA-6)
 *
 * Header contract:
 *   - mcp-session-id: forwarded verbatim upstream and back downstream
 *   - Authorization:  forwarded as request.forwardedAuth (the original user token)
 *   - Content-Type:   forwarded verbatim
 *   - Accept:         forwarded verbatim
 *   - Host:           rewritten to the upstream target (reply-from handles this)
 *
 * Error mapping:
 *   - RegistryMissError (REGISTRY_MISS) → 425 Too Early
 *   - Upstream unreachable (ECONNREFUSED/etc.)  → 502 Bad Gateway
 *
 * Out of scope for TA-5:
 *   - SSE GET streaming (GET /mcp with Accept: text/event-stream) — covered by TA-7
 *   - REST endpoint proxying (/api/*) — covered by TA-6
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RegistryReader } from '../registry/index.js'
import { RouteResolutionError } from '@horus/router-core'
import { sendRouteResolutionError } from '../errors.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The path on the upstream Anvil instance that serves MCP requests. */
const UPSTREAM_MCP_PATH = '/mcp'

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Register the POST /mcp proxy route on the given Fastify instance.
 *
 * The route is added AFTER the auth plugin (which runs in preHandler),
 * so request.principal and request.forwardedAuth are always populated
 * when this handler runs.
 *
 * @param fastify   The Fastify instance (already has reply-from registered).
 * @param registry  The RegistryReader singleton (injected from app.ts).
 */
export function registerMcpProxyRoute(
  fastify: FastifyInstance,
  registry: RegistryReader,
): void {
  /**
   * POST /mcp — proxy a JSON-RPC request to the per-user Anvil MCP endpoint.
   *
   * The auth preHandler has already verified the JWT and set:
   *   request.principal    — { tenant, user, role }
   *   request.forwardedAuth — "Bearer <token>" for forwarding
   */
  fastify.route({
    method: 'POST',
    url: '/mcp',
    // Disable body parsing — we stream the raw body to upstream unchanged.
    // This avoids Fastify's built-in JSON parser, which would buffer and
    // potentially reject large payloads, and ensures streaming correctness.
    config: { rawBody: false },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = request.principal
      if (!principal) {
        // Should never happen — auth preHandler runs before this — but guard defensively.
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Missing principal' },
        })
      }

      // ── 1. Resolve Principal → Anvil instance URL ─────────────────────────
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

      const upstreamTarget = instanceUrl.replace(/\/$/, '') + UPSTREAM_MCP_PATH

      // ── 2. Proxy via reply-from ───────────────────────────────────────────
      //
      // reply.from() streams the request/response bodies through without buffering.
      // rewriteRequestHeaders: rewrite Host to match the target, and ensure the
      //   forwarded Authorization header (forwardedAuth) is used — not the
      //   original inbound header which might have been replaced by plugins.
      //
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
          // Map upstream connection errors to 502 Bad Gateway
          // reply-from passes { error: Error } — extract the inner error first
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

          if (is5xx || !reply.sent) {
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
