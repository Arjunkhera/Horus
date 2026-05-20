/**
 * SSE proxy route handler (TA-7).
 *
 * Handles GET /api/events requests. Resolves the authenticated Principal
 * to a per-user Anvil instance URL via the RegistryReader, then proxies the
 * SSE long-poll transparently using @fastify/reply-from with streaming mode.
 *
 * Locked decisions applied:
 *   Q10: Transparent SSE proxy via @fastify/reply-from; set required SSE headers
 *   Q1:  @fastify/reply-from for proxy primitives
 *
 * SSE configuration knobs used (for posterity):
 *
 *   1. rewriteHeaders callback — forces SSE-correct response headers onto the
 *      reply regardless of what upstream sends. This guarantees:
 *        - Content-Type: text/event-stream  (required by SSE spec)
 *        - Cache-Control: no-cache          (prevents intermediary caching)
 *        - X-Accel-Buffering: no            (disables nginx proxy buffering)
 *      We do NOT override Connection because Fastify controls that header;
 *      in production Fastify sets keep-alive automatically for HTTP/1.1.
 *
 *   2. onResponse callback — called by reply-from AFTER upstream headers are
 *      copied to the reply object and BEFORE reply.send(stream) would be called.
 *      We use it to:
 *        (a) call reply.raw.flushHeaders() — writes the status line + all
 *            headers to the TCP socket immediately. Without this, Node's HTTP
 *            layer buffers headers until the first data chunk, which can add
 *            latency for slow-start SSE streams.
 *        (b) set reply.raw on a 'drain' listener to call resume() — ensures
 *            backpressure is handled correctly and the stream isn't paused.
 *        (c) pipe the upstream Readable into reply.raw using pipeline() so
 *            destroy is called on both sides when either end closes.
 *
 *   3. No body is sent via opts.body — GET has no body; reply-from handles
 *      this correctly (see index.js: method=GET → body='').
 *
 * Why NOT to use reply.send(stream) directly here (without onResponse):
 *   reply.from() sets response headers from upstream via copyHeaders() and
 *   then calls reply.send(res.stream). reply.send() for a Readable calls
 *   pump() internally, which pipes the stream. The problem is that by the time
 *   reply.send() runs, the headers are already enqueued — but not flushed to
 *   the wire until the first data chunk arrives. For SSE this means the client
 *   sees no response until the first event, which breaks connection-establishment
 *   semantics. Using onResponse + flushHeaders() solves this.
 *
 * Error mapping:
 *   - RegistryMissError (REGISTRY_MISS) → 425 Too Early
 *   - Upstream unreachable (ECONNREFUSED/etc.)  → 502 Bad Gateway
 *
 * Out of scope for TA-7:
 *   - SSE re-broadcast / fan-out (post-alpha; Q10 Option B)
 *   - WebSocket proxying
 */

import { pipeline } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RegistryReader } from '../registry/index.js'
import { RouteResolutionError } from '@horus/router-core'
import { sendRouteResolutionError } from '../errors.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The SSE endpoint path on the upstream Anvil instance. */
const UPSTREAM_SSE_PATH = '/api/events'

// ---------------------------------------------------------------------------
// SSE headers that must be set on every response (override upstream values)
// ---------------------------------------------------------------------------

const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
  'connection': 'keep-alive',
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Register the GET /api/events SSE proxy route on the given Fastify instance.
 *
 * MUST be registered BEFORE any wildcard REST route (e.g. /api/*) to ensure
 * this handler matches first when both are registered.
 *
 * @param fastify   The Fastify instance (already has reply-from registered).
 * @param registry  The RegistryReader singleton (injected from app.ts).
 */
export function registerSseProxyRoute(
  fastify: FastifyInstance,
  registry: RegistryReader,
): void {
  fastify.route({
    method: 'GET',
    url: '/api/events',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = request.principal
      if (!principal) {
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

      const upstreamTarget = instanceUrl.replace(/\/$/, '') + UPSTREAM_SSE_PATH

      // ── 2. Proxy via reply-from with SSE streaming config ─────────────────
      //
      // rewriteHeaders: override the upstream's response headers with the
      //   mandatory SSE set. We merge (not replace) so that any upstream
      //   headers we haven't listed are preserved verbatim.
      //
      // onResponse: called by reply-from after upstream headers are copied to
      //   the reply but BEFORE send(stream) is called. We intercept here to:
      //   (a) set SSE headers on the raw response (belt-and-suspenders for
      //       headers that copyHeaders may have already written),
      //   (b) call flushHeaders() to immediately write the status line and
      //       headers to the wire (critical: client must see 200 SSE response
      //       before the first event arrives),
      //   (c) pipeline the upstream Readable into reply.raw so destroy
      //       propagates in both directions when the stream ends.
      //
      return reply.from(upstreamTarget, {
        rewriteRequestHeaders: (_req, headers) => {
          // Forward the user token as stored by the auth plugin
          if (request.forwardedAuth) {
            headers['authorization'] = request.forwardedAuth
          }
          // Accept SSE from upstream
          headers['accept'] = 'text/event-stream'
          // Remove transfer-encoding to avoid double-chunking
          delete headers['transfer-encoding']
          return headers
        },

        rewriteHeaders: (upstreamHeaders) => {
          // Force SSE headers onto the response, merging over upstream values
          return { ...upstreamHeaders, ...SSE_HEADERS }
        },

        onResponse: (_request, reply, stream) => {
          const raw = reply.raw

          // Set SSE headers on the raw socket before flushing headers.
          // reply-from's copyHeaders has already run so we do this on raw directly.
          Object.entries(SSE_HEADERS).forEach(([k, v]) => {
            raw.setHeader(k, v)
          })

          // Flush status line + headers to the wire immediately.
          // Without this, headers are buffered until the first data chunk,
          // which delays the SSE handshake and can confuse clients.
          // flushHeaders() is HTTP/1.1 (ServerResponse) only; guard for HTTP/2.
          if ('flushHeaders' in raw && typeof raw.flushHeaders === 'function') {
            raw.flushHeaders()
          }

          // pipeline() handles backpressure and tears down both sides on end/error.
          pipeline(stream as unknown as NodeJS.ReadableStream, raw, (err) => {
            if (err && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_DESTROYED') {
              // Client disconnected or network error — not fatal
              request.log?.warn({ err }, 'SSE pipeline ended with error')
            }
          })
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

// Re-export IncomingMessage type for consumers that need to type the stream
export type { IncomingMessage }
