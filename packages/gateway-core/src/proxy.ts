/**
 * REST reverse-proxy route factory.
 *
 * Extracted from anvil-router's proxy/rest.ts. The per-user `registry.lookup`
 * is generalized to a pluggable `resolveTarget(request) => upstreamUrl`, so the
 * same primitive serves horus-service's static route map AND anvil-router's
 * per-principal registry resolution.
 *
 * Header contract: body streamed unchanged; `transfer-encoding` stripped to
 * avoid double-chunking; caller's `rewriteRequestHeaders` runs last (e.g. to
 * inject X-Horus-Principal and drop the inbound Authorization).
 *
 * Error mapping:
 *   - resolveTarget throws UpstreamResolutionError → its status + envelope
 *   - upstream unreachable (ECONNREFUSED/etc.)     → 502 UPSTREAM_UNAVAILABLE
 *   - upstream application 4xx/5xx                 → forwarded verbatim
 */

import '@fastify/reply-from'; // load the reply.from type augmentation onto FastifyReply
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import { getRequestId, sendError, UpstreamResolutionError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

const DEFAULT_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export interface RestProxyRouteOptions {
  /** Fastify route URL pattern, e.g. `/api/v1/vault/*`. */
  url: string;
  /** Resolve the fully-qualified upstream URL (base + path + query) for this request. */
  resolveTarget: (request: FastifyRequest) => string | Promise<string>;
  /** Mutate outgoing headers (after transfer-encoding is stripped). */
  rewriteRequestHeaders?: (
    request: FastifyRequest,
    headers: IncomingHttpHeaders,
  ) => IncomingHttpHeaders;
  /** HTTP methods to register. Defaults to all proxy-safe methods. */
  methods?: HttpMethod[];
}

const PASSTHROUGH_FLAG = Symbol.for('horus.gateway.passthroughBody');

/**
 * Register a transparent body passthrough parser once per instance so the proxy
 * can forward arbitrary content types (JSON/text keep their built-in parsers).
 */
function ensurePassthroughBodyParser(fastify: FastifyInstance): void {
  const f = fastify as unknown as Record<symbol, boolean>;
  if (f[PASSTHROUGH_FLAG]) return;
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body: Buffer, done) =>
    done(null, body),
  );
  f[PASSTHROUGH_FLAG] = true;
}

export function registerRestProxyRoute(
  fastify: FastifyInstance,
  opts: RestProxyRouteOptions,
): void {
  ensurePassthroughBodyParser(fastify);
  const methods = opts.methods ?? DEFAULT_METHODS;

  for (const method of methods) {
    fastify.route({
      method,
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
          rewriteRequestHeaders: (_originalReq, headers) => {
            delete headers['transfer-encoding'];
            return opts.rewriteRequestHeaders
              ? opts.rewriteRequestHeaders(request, headers)
              : headers;
          },
          onError: (rep, error) => {
            const inner = (error as { error: Error & { code?: string; statusCode?: number } })
              .error;
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
}
