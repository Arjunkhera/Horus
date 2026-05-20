import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import replyFrom from '@fastify/reply-from'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { RegistryReader, createRegistryReader, type SqliteDb } from './registry/index.js'
import { RouteResolutionError } from '@horus/router-core'
import { sendRouteResolutionError } from './errors.js'
import { authPlugin } from './plugins/index.js'
import type { AuthPluginOptions } from './plugins/index.js'
import { registerMcpProxyRoute, registerSseProxyRoute, registerRestProxyRoute } from './proxy/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require(join(__dirname, '..', 'package.json')) as { version: string }
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

export interface BuildServerOptions {
  /** Inject a custom auth verifier (for testing). */
  authOptions?: AuthPluginOptions
  /**
   * Inject a pre-opened SQLite DB for testing.
   * When omitted, the server opens the DB from ANVIL_REGISTRY_PATH env var.
   * The db injection is deferred until the server starts (lazy init) so that
   * unit tests that don't exercise routing can skip the DB entirely.
   */
  registryDb?: SqliteDb
  /** TTL for the registry cache in ms (default 60 000). */
  registryTtlMs?: number
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Increase body limit to 10 MB to allow large JSON-RPC payloads
    // through the MCP proxy without a 413 Content Too Large error.
    bodyLimit: 10 * 1024 * 1024, // 10 MB
  })

  const version = getVersion()

  // Register auth plugin BEFORE any proxy routes.
  // The plugin skips /health internally.
  await app.register(authPlugin, opts.authOptions ?? {})

  // Register @fastify/reply-from — enables reply.from() for transparent proxying.
  // bodyLimit: 0 disables reply-from's own body limit (Fastify's built-in limit
  // still applies; we increase it here to allow large JSON-RPC payloads).
  await app.register(replyFrom, {
    // Allow up to 10 MB request bodies through the proxy without buffering error.
    // reply-from streams; this limit is a safety guard, not a buffer.
    // Disable reply-from's content-length rewrite so upstream gets the original.
    disableRequestContentLengthCheck: true,
  } as Parameters<typeof replyFrom>[1])

  // ── Registry reader (lazy singleton) ────────────────────────────────────
  let _registry: RegistryReader | null = null

  function getRegistry(): RegistryReader {
    if (_registry === null) {
      _registry = opts.registryDb !== undefined
        ? new RegistryReader(opts.registryDb, opts.registryTtlMs ?? 60_000)
        : createRegistryReader(opts.registryTtlMs ?? 60_000)
    }
    return _registry
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  // /health — no auth required (the plugin skips it via routerPath check)
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'anvil-router',
      version,
    })
  })

  /**
   * GET /api/lookup?tenant=<t>&user=<u>
   *
   * Diagnostic / test route that exposes the registry reader over HTTP.
   * Returns the resolved RegistryEntry on hit, 425 on miss.
   * This route is not part of the proxy surface (TA-5/6/7) — it exists to
   * allow integration tests to verify the registry reader without a proxy stub.
   * Auth plugin protects this route (token required).
   */
  app.get('/api/lookup', async (request, reply) => {
    const { tenant, user } = request.query as { tenant?: string; user?: string }

    if (!tenant || !user) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameters "tenant" and "user" are required',
        },
      })
    }

    try {
      const entry = getRegistry().lookup(tenant, user)
      return reply.status(200).send(entry)
    } catch (err) {
      if (err instanceof RouteResolutionError) {
        return sendRouteResolutionError(reply, err)
      }
      throw err
    }
  })

  // /echo-principal — test-only route used in auth.test.ts to inspect what the
  // auth plugin attached to the request. This route is safe in production because:
  // 1. The auth plugin protects it (token required to reach it).
  // 2. It only echoes what was already authenticated.
  // Proxy stories TA-5/6/7 will add the real proxy routes alongside this.
  app.get('/echo-principal', async (request, _reply) => {
    return {
      principal: request.principal,
      forwardedAuth: request.forwardedAuth,
    }
  })

  // ── TA-5: MCP-over-HTTP proxy ─────────────────────────────────────────────
  // Registered AFTER auth plugin and reply-from. Uses getRegistry() to resolve
  // Principal → Anvil instance URL via the lazy registry singleton.
  // We pass a thin delegating object whose lookup() method wraps the lazy
  // getRegistry() call so the DB is not opened until the first request.
  const registryProxy: RegistryReader = {
    lookup: (tenant: string, user: string) => getRegistry().lookup(tenant, user),
    invalidate: (tenant: string, user: string) => getRegistry().invalidate(tenant, user),
    clearCache: () => getRegistry().clearCache(),
  } as unknown as RegistryReader
  registerMcpProxyRoute(app, registryProxy)

  // ── TA-7: SSE proxy (GET /api/events → per-user Anvil SSE stream) ─────────
  // MUST be registered BEFORE the wildcard REST proxy (TA-6) so Fastify's
  // route matching resolves this specific route ahead of the /api/* wildcard.
  // Preserves text/event-stream semantics: no buffering, headers flushed early,
  // Cache-Control: no-cache, X-Accel-Buffering: no.
  registerSseProxyRoute(app, registryProxy)

  // ── TA-6: REST proxy (/api/* → per-user Anvil) ────────────────────────────
  // Registered AFTER SSE proxy. Matches all HTTP methods on /api/* EXCEPT
  // /api/events (guarded both by Fastify route ordering above and by an
  // explicit URL check inside the handler).
  registerRestProxyRoute(app, registryProxy)

  return app
}
