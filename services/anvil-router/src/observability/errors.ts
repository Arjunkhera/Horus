/**
 * observability/errors.ts — Structured error envelope for anvil-router (TA-10).
 *
 * All error responses (4xx, 5xx) return a JSON body:
 *   { error: { code: string, message: string, request_id: string, retryAfter?: number } }
 *
 * This module exports:
 *   - ErrorEnvelope — the TypeScript type for the wire shape
 *   - buildErrorBody — creates the envelope object from parts
 *   - sendError — writes the envelope to a FastifyReply
 *
 * Locked decisions applied:
 *   Cross-cutting concern "Error Model" from design proposal b711ce02:
 *     { error: { code, message, retryAfter? } } — extended with request_id per TA-10 spec.
 *   HTTP status codes documented in TA-10 acceptance criteria:
 *     401 UNAUTHORIZED, 403 TENANT_MISMATCH, 425 NOT_YET_PROVISIONED,
 *     502 UPSTREAM_ERROR, 503 INSTANCE_UNAVAILABLE, 504 UPSTREAM_TIMEOUT
 */

import type { FastifyReply } from 'fastify'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorBody {
  code: string
  message: string
  request_id: string
  retryAfter?: number
}

export interface ErrorEnvelope {
  error: ErrorBody
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the structured error envelope from parts.
 *
 * @param code       Machine-readable error code (UPPERCASE_SNAKE_CASE).
 * @param message    Human-readable description.
 * @param requestId  The request ID (from X-Request-Id header or generated UUID).
 * @param retryAfter Optional Retry-After seconds (for 425, 503).
 */
export function buildErrorBody(
  code: string,
  message: string,
  requestId: string,
  retryAfter?: number,
): ErrorEnvelope {
  const body: ErrorBody = { code, message, request_id: requestId }
  if (retryAfter !== undefined) {
    body.retryAfter = retryAfter
  }
  return { error: body }
}

/**
 * Write the structured error envelope to a Fastify reply and set any relevant headers.
 *
 * @param reply      The Fastify reply to write to.
 * @param status     HTTP status code.
 * @param code       Machine-readable error code.
 * @param message    Human-readable description.
 * @param requestId  Request ID string to include in the body.
 * @param retryAfter Optional Retry-After seconds (also set as response header).
 */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
  retryAfter?: number,
): FastifyReply {
  if (retryAfter !== undefined) {
    void reply.header('Retry-After', String(retryAfter))
  }
  return reply.status(status).send(buildErrorBody(code, message, requestId, retryAfter))
}
