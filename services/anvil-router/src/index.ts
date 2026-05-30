import { buildServer } from './app.js'

const port = Number(process.env['ANVIL_ROUTER_PORT'] ?? 8200)
const host = '0.0.0.0'

const app = await buildServer()

try {
  await app.listen({ port, host })
  console.log(`anvil-router listening on ${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
