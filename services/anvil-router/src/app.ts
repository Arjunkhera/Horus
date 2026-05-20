import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { RegistryReader, createRegistryReader, type SqliteDb } from './registry/index.js'
import { RouteResolutionError } from '@horus/router-core'
import { sendRouteResolutionError } from './errors.js'

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
  })

  const version = getVersion()

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

  return app
}
