/**
 * horus-service — public API gateway for the Horus Control Plane.
 *
 * Single external entry point (ADR-0004, ADR-0008). All backends are ClusterIP
 * behind it. Responsibilities:
 *   - Edge/Identity: verify inbound Authorization via a pluggable TokenVerifier,
 *     normalize to a Principal, mint a 60s internal X-Horus-Principal JWT, and
 *     inject it downstream (replacing the raw Authorization).
 *   - Proxy map: /api/v1/vault/* → vault-router, /api/v1/forge/* → forge-registry,
 *     /api/v1/events → SSE. Reuses @horus/gateway-core primitives.
 *   - Aggregation: federate remote domains only (Vault + Forge). Anvil
 *     federation is client-side (ADR-0004 amendment).
 *   - Observability: /metrics, structured logs, X-Request-ID generation/forwarding.
 */

import type { IncomingHttpHeaders } from 'node:http';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import replyFrom from '@fastify/reply-from';
import {
  registerRestProxyRoute,
  registerSseProxyRoute,
  getRequestId,
  sendError,
} from '@horus/gateway-core';
import type { CredentialVerifier, Principal } from '@horus/auth';
import { registerMetrics } from './metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    /** The minted internal X-Horus-Principal JWT (raw compact form). */
    horusPrincipalToken?: string;
    /** Stable request id for this request (inbound X-Request-Id or minted). */
    horusRequestId?: string;
  }
}

export interface Upstreams {
  /** Base URL of vault-router (no trailing path). */
  vaultRouter: string;
  /** Base URL of forge-registry. */
  forgeRegistry: string;
  /** Base URL of the SSE event source. */
  events: string;
}

export interface BuildServerOptions {
  /** Verifies an inbound Authorization header → Principal (pluggable: in-process / enterprise HTTP). */
  tokenVerifier: CredentialVerifier;
  /** Mints the short-lived internal JWT for a verified principal. */
  principalSigner: (principal: Principal) => Promise<string>;
  upstreams: Upstreams;
  /** Fastify logger option. Defaults to false (tests); production enables JSON logs. */
  logger?: boolean;
}

const AUTH_SKIP_PATHS = new Set(['/health', '/metrics']);

function rewritePath(request: FastifyRequest, prefix: string): string {
  const url = request.raw.url ?? request.url;
  const stripped = url.slice(prefix.length);
  if (stripped === '' || stripped === '?') return '/';
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function stripTrailingSlash(base: string): string {
  return base.replace(/\/$/, '');
}

export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const { tokenVerifier, principalSigner, upstreams } = opts;
  const fastify = Fastify({ logger: opts.logger ?? false });

  // ── X-Request-ID: generate (or adopt inbound) and echo on the response ──────
  fastify.addHook('onRequest', async (request, reply) => {
    const id = getRequestId(request);
    request.horusRequestId = id;
    void reply.header('x-request-id', id);
  });

  // ── Edge/Identity: fail-closed auth + principal normalization ───────────────
  fastify.addHook('onRequest', async (request, reply) => {
    const pathOnly = (request.raw.url ?? request.url).split('?')[0];
    if (AUTH_SKIP_PATHS.has(pathOnly)) return;

    const requestId = request.horusRequestId ?? getRequestId(request);
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing Authorization header', requestId);
    }

    let principal: Principal;
    try {
      principal = await tokenVerifier.verify(authHeader);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const tenantMismatch = /tenant/i.test(msg);
      return sendError(
        reply,
        tenantMismatch ? 403 : 401,
        tenantMismatch ? 'TENANT_MISMATCH' : 'UNAUTHORIZED',
        msg,
        requestId,
      );
    }

    request.principal = principal;
    request.horusPrincipalToken = await principalSigner(principal);
  });

  // Forward identity + request id downstream; never leak the raw client token.
  const injectIdentity = (request: FastifyRequest, headers: IncomingHttpHeaders) => {
    delete headers['authorization'];
    if (request.horusPrincipalToken) {
      headers['x-horus-principal'] = request.horusPrincipalToken;
    }
    if (request.horusRequestId) {
      headers['x-request-id'] = request.horusRequestId;
    }
    return headers;
  };

  void fastify.register(async (instance) => {
    await instance.register(replyFrom);

    // SSE must register before the wildcard REST routes.
    registerSseProxyRoute(instance, {
      url: '/api/v1/events',
      resolveTarget: (request) =>
        stripTrailingSlash(upstreams.events) + rewritePath(request, '/api/v1/events'),
      rewriteRequestHeaders: injectIdentity,
    });

    registerRestProxyRoute(instance, {
      url: '/api/v1/vault/*',
      resolveTarget: (request) =>
        stripTrailingSlash(upstreams.vaultRouter) + rewritePath(request, '/api/v1/vault'),
      rewriteRequestHeaders: injectIdentity,
    });

    registerRestProxyRoute(instance, {
      url: '/api/v1/forge/*',
      resolveTarget: (request) =>
        stripTrailingSlash(upstreams.forgeRegistry) + rewritePath(request, '/api/v1/forge'),
      rewriteRequestHeaders: injectIdentity,
    });
  });

  // ── Aggregation: federate remote domains only (Vault + Forge) ───────────────
  fastify.get('/api/v1/aggregate/status', async (request) => {
    const probe = async (base: string): Promise<'up' | 'down'> => {
      try {
        const res = await fetch(`${stripTrailingSlash(base)}/health`);
        return res.ok ? 'up' : 'down';
      } catch {
        return 'down';
      }
    };
    const [vault, forge] = await Promise.all([
      probe(upstreams.vaultRouter),
      probe(upstreams.forgeRegistry),
    ]);
    return {
      principal: request.principal,
      domains: { vault, forge },
    };
  });

  // ── Health (Seq 1 client probes this) ───────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', service: 'horus-service' }));

  registerMetrics(fastify);

  return fastify;
}
