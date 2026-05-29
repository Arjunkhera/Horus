/**
 * Structured error envelope shared by every Horus gateway/service.
 *
 * Wire shape (service-wide contract, §E decision 90bd262c):
 *   { error: { code, message, request_id, retryAfter? } }
 *
 * Extracted from anvil-router's TA-10 model (observability/errors.ts) so
 * horus-service and any future adopter render errors identically.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface ErrorBody {
  code: string;
  message: string;
  request_id: string;
  retryAfter?: number;
}

export interface ErrorEnvelope {
  error: ErrorBody;
}

export function buildErrorBody(
  code: string,
  message: string,
  requestId: string,
  retryAfter?: number,
): ErrorEnvelope {
  const body: ErrorBody = { code, message, request_id: requestId };
  if (retryAfter !== undefined) {
    body.retryAfter = retryAfter;
  }
  return { error: body };
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
  retryAfter?: number,
): FastifyReply {
  if (retryAfter !== undefined) {
    void reply.header('Retry-After', String(retryAfter));
  }
  return reply.status(status).send(buildErrorBody(code, message, requestId, retryAfter));
}

/** Resolve the request id from the inbound X-Request-Id header, else mint one. */
export function getRequestId(request: FastifyRequest): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  if (Array.isArray(header) && header[0]) {
    return header[0];
  }
  return randomUUID();
}

/**
 * Thrown by a `resolveTarget` callback when the upstream cannot be determined
 * (e.g. registry miss, instance unavailable). The proxy renders it via
 * {@link sendError} with the carried status/code/retryAfter. Generalizes
 * anvil-router's RouteResolutionError → sendRouteResolutionError mapping.
 */
export class UpstreamResolutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'UpstreamResolutionError';
  }
}
