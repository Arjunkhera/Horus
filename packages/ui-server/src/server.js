import express from 'express'

const app = express()
const PORT = process.env.PORT ?? 8400

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    overall: 'healthy',
    services: [
      { name: 'anvil', url: process.env.ANVIL_URL ?? 'http://anvil:8100', status: 'unknown', latency: null },
      { name: 'vault', url: process.env.VAULT_URL ?? 'http://vault:8000', status: 'unknown', latency: null },
      { name: 'forge', url: process.env.FORGE_URL ?? 'http://forge:8200', status: 'unknown', latency: null },
    ],
  })
})

app.listen(PORT, () => {
  console.log(`@horus/ui-server listening on port ${PORT}`)
})
