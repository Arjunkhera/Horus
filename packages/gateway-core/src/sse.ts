/**
 * SSE reverse-proxy route factory.
 *
 * Extracted from anvil-router's proxy/sse.ts. The streaming technique is
 * preserved verbatim: reply.from + rewriteHeaders (force SSE headers) +
 * onResponse (flushHeaders immediately, then pipeline the upstream Readable
 * into reply.raw). The per-user registry lookup is generalized to
 * `resolveTarget(request) => upstreamUrl`.
 *
 * Why onResponse + flushHeaders: without it, headers are buffered until the
 * first data chunk, delaying the SSE handshake and confusing clients.
 */

import '@fastify/reply-from'; // load the reply.from type augmentation onto FastifyReply
import { pipeline } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRequestId, sendError, UpstreamResolutionError } from './errors.js';

const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
  connection: 'keep-alive',
};

export interface SseProxyRouteOptions {
  /** Fastify route URL, e.g. `/api/v1/events`. */
  url: string;
  /** Resolve the fully-qualified upstream SSE URL for this request. */
  resolveTarget: (request: FastifyRequest) => string | Promise<string>;
  /** Mutate outgoing headers (after transfer-encoding is stripped, accept forced). */
  rewriteRequestHeaders?: (
    request: FastifyRequest,
    headers: IncomingHttpHeaders,
  ) => IncomingHttpHeaders;
}

export function registerSseProxyRoute(
  fastify: FastifyInstance,
  opts: SseProxyRouteOptions,
): void {
  fastify.route({
    method: 'GET',
    url: opts.url,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = getRequestId(request);

      let target: string;
      try {
        target = await opts.resolveTarget(request);
      } catch (err) {
        if (err instanceof UpstreamResolutionError) {
          return sendError(reply, err.status, err.code, err.message, requestId, err.retryAfter);
        }
        throw err;
      }

      return reply.from(target, {
        rewriteRequestHeaders: (_req, headers) => {
          headers['accept'] = 'text/event-stream';
          delete headers['transfer-encoding'];
          return opts.rewriteRequestHeaders
            ? opts.rewriteRequestHeaders(request, headers)
            : headers;
        },

        rewriteHeaders: (upstreamHeaders) => ({ ...upstreamHeaders, ...SSE_HEADERS }),

        onResponse: (_request, rep, stream) => {
          const raw = rep.raw;
          for (const [k, v] of Object.entries(SSE_HEADERS)) {
            raw.setHeader(k, v);
          }
          if ('flushHeaders' in raw && typeof raw.flushHeaders === 'function') {
            raw.flushHeaders();
          }
          pipeline(stream as unknown as NodeJS.ReadableStream, raw, (err) => {
            if (err && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_DESTROYED') {
              request.log?.warn({ err }, 'SSE pipeline ended with error');
            }
          });
        },

        onError: (rep, error) => {
          const inner = (error as { error: Error & { code?: string; statusCode?: number } }).error;
          const msg = inner?.message ?? String(inner);
          if (!rep.sent) {
            void sendError(
              rep as unknown as FastifyReply,
              502,
              'UPSTREAM_UNAVAILABLE',
              `Upstream unreachable: ${msg}`,
              requestId,
            );
          }
        },
      });
    },
  });
}
