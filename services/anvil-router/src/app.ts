import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

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

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  })

  const version = getVersion()

  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'anvil-router',
      version,
    })
  })

  return app
}
