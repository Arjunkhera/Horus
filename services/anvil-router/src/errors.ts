/**
 * errors.ts — HTTP error handlers for anvil-router.
 *
 * Converts RouteResolutionError codes to the standard JSON envelope:
 *   { error: { code, message, retryAfter? } }
 *
 * HTTP status mapping (per Q4 locked decision):
 *   REGISTRY_MISS        → 425 Too Early  (provisioning incomplete, retry)
 *   INSTANCE_UNAVAILABLE → 503 Service Unavailable
 *   VALIDATION_ERROR     → 400 Bad Request
 */

import type { FastifyReply } from 'fastify';
import { RouteResolutionError } from '@horus/router-core';

const CODE_TO_STATUS: Record<string, number> = {
  REGISTRY_MISS: 425,
  INSTANCE_UNAVAILABLE: 503,
  VALIDATION_ERROR: 400,
};

/**
 * Writes the standard error envelope and sets Retry-After header when present.
 * Returns the reply so callers can chain `.send()`.
 */
export function sendRouteResolutionError(
  reply: FastifyReply,
  err: RouteResolutionError,
): FastifyReply {
  const status = CODE_TO_STATUS[err.code] ?? 500;

  if (err.retryAfter !== undefined) {
    void reply.header('Retry-After', String(err.retryAfter));
  }

  return reply.status(status).send({
    error: {
      code: err.code,
      message: err.message,
      ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
    },
  });
}
