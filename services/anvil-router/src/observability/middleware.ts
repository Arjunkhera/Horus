/**
 * observability/middleware.ts — Fastify plugin for request-level observability (TA-10).
 *
 * This plugin registers two cross-cutting concerns as Fastify hooks:
 *
 *   1. onRequest — generate or preserve X-Request-Id; record request start time
 *   2. onSend    — add X-Request-Id to response headers; record end-time; log the
 *                  structured request log line; increment request counter + duration histogram
 *
 * The plugin is registered with fastify-plugin so it decorates the top-level
 * scope (no encapsulation boundary).
 *
 * logCapture (injected via BuildServerOptions in tests):
 *   If provided, each structured log object is passed to this function instead of
 *   (or in addition to) the Fastify logger. This gives unit tests a clean way to
 *   assert log fields without capturing pino output.
 *
 * Locked decisions applied:
 *   Cross-cutting concern "Observability" from design proposal b711ce02:
 *     log fields: request_id (traceId), tenant, user, upstream (N/A at middleware level),
 *                 method, path, status, duration_ms
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { requestsTotal, requestDurationMs } from './metrics.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured request log entry emitted at response time. */
export interface RequestLogEntry {
  request_id: string
  method: string
  path: string
  status: number
  duration_ms: number
  /** Present when the auth plugin has already attached a principal. */
  principal?: {
    tenant: string
    user: string
    role?: string
  }
  upstream_url?: string
}

export type LogCaptureFn = (entry: RequestLogEntry) => void

export interface ObservabilityPluginOptions {
  logCapture?: LogCaptureFn
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const observabilityPlugin: FastifyPluginAsync<ObservabilityPluginOptions> = async (
  fastify,
  opts,
) => {
  /**
   * onRequest — runs first, before body parsing and route matching.
   * Reads or generates the X-Request-Id and stores the start timestamp on
   * request.startTimeMs for duration calculation in onSend.
   */
  fastify.addHook('onRequest', async (request) => {
    const inbound = request.headers['x-request-id']
    const requestId =
      typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID()

    request.requestId = requestId
    request.startTimeMs = Date.now()
  })

  /**
   * onSend — runs after the route handler, before bytes are written to the socket.
   * At this point we know the status code and can compute duration.
   */
  fastify.addHook('onSend', async (request, reply) => {
    const requestId = request.requestId ?? randomUUID()
    const method = request.method
    const path = request.routeOptions?.url ?? request.url
    const status = reply.statusCode
    const duration_ms = Date.now() - (request.startTimeMs ?? Date.now())

    // Inject the request ID header onto the outgoing response.
    void reply.header('x-request-id', requestId)

    // Increment Prometheus request counter.
    requestsTotal.inc({ method, status: String(status) })

    // Observe request duration histogram.
    requestDurationMs.observe({ method, status: String(status) }, duration_ms)

    // Build the structured log entry.
    const entry: RequestLogEntry = {
      request_id: requestId,
      method,
      path,
      status,
      duration_ms,
    }

    if (request.principal) {
      entry.principal = {
        tenant: request.principal.tenant,
        user: request.principal.user,
        role: request.principal.role,
      }
    }

    // Emit via the logCapture seam (tests) and/or Fastify logger.
    if (opts.logCapture) {
      opts.logCapture(entry)
    }
    // Always log at info level through Fastify's pino logger.
    request.log.info(entry, 'request completed')
  })
}

export default fp(observabilityPlugin, {
  name: 'observability',
  fastify: '4.x',
})
