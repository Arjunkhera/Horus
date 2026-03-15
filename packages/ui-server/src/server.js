import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 8400

const ANVIL_URL = process.env.ANVIL_URL ?? 'http://anvil:8100'
const VAULT_URL = process.env.VAULT_URL ?? 'http://vault-mcp:8300'
const FORGE_URL = process.env.FORGE_URL ?? 'http://forge:8200'

// ─── File helpers (atomic write) ─────────────────────────────────────────────

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.tmp.' + randomBytes(4).toString('hex')
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)   // atomic on POSIX — prevents half-written reads
}

const DEFAULTS = {
  preferences: { user: { name: '' }, primitives: {}, settings: {} },
  dashboards:  { dashboards: [] },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function probeHealth(name, url) {
  const start = Date.now()
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    return { name, url, status: res.ok ? 'healthy' : 'degraded', latency: Date.now() - start }
  } catch {
    return { name, url, status: 'unreachable', latency: null }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json())

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const [anvil, vault, forge] = await Promise.all([
    probeHealth('anvil', ANVIL_URL),
    probeHealth('vault', VAULT_URL),
    probeHealth('forge', FORGE_URL),
  ])
  const services = [anvil, vault, forge]
  const overall = services.every(s => s.status === 'healthy') ? 'healthy'
    : services.some(s => s.status === 'healthy')              ? 'degraded'
    : 'unhealthy'
  res.json({ overall, services })
})

// ─── Proxy routes ─────────────────────────────────────────────────────────────

const proxyOpts = (target) => ({
  target,
  changeOrigin: true,
  on: {
    error: (err, _req, res) => {
      res.status(502).json({ error: 'upstream_error', detail: err.message })
    },
  },
})

app.use('/api/anvil', createProxyMiddleware({ ...proxyOpts(ANVIL_URL), pathRewrite: { '^/api/anvil': '' } }))
app.use('/api/vault', createProxyMiddleware({ ...proxyOpts(VAULT_URL), pathRewrite: { '^/api/vault': '' } }))
app.use('/api/forge', createProxyMiddleware({ ...proxyOpts(FORGE_URL), pathRewrite: { '^/api/forge': '' } }))

// ─── Config (persistence in _system/ui/) ──────────────────────────────────────

const DATA_DIR  = process.env.HORUS_DATA_PATH ?? join(__dirname, '../../..', '.horus-data')
const UI_PREFS  = join(DATA_DIR, '_system/ui/preferences.json')
const UI_DASH   = join(DATA_DIR, '_system/ui/dashboards.json')
const SVCCONFIG = join(DATA_DIR, '_system/ui/services.json')

app.get('/api/config/preferences', async (_req, res) => {
  res.json(await readJsonFile(UI_PREFS, DEFAULTS.preferences))
})

app.put('/api/config/preferences', async (req, res) => {
  const current = await readJsonFile(UI_PREFS, DEFAULTS.preferences)
  // merge semantics: top-level keys are merged, sub-objects overwritten
  const updated = { ...current, ...req.body }
  await writeJsonAtomic(UI_PREFS, updated)
  res.json(updated)
})

app.get('/api/config/dashboards', async (_req, res) => {
  res.json(await readJsonFile(UI_DASH, DEFAULTS.dashboards))
})

app.put('/api/config/dashboards', async (req, res) => {
  await writeJsonAtomic(UI_DASH, req.body)
  res.json(req.body)
})

app.get('/api/config/services', async (_req, res) => {
  res.json(await readJsonFile(SVCCONFIG, {
    anvil: { url: ANVIL_URL },
    vault: { url: VAULT_URL },
    forge: { url: FORGE_URL },
  }))
})

// ─── Setup ────────────────────────────────────────────────────────────────────

app.get('/api/setup/status', async (_req, res) => {
  const [anvil, vault, forge] = await Promise.all([
    probeHealth('anvil', ANVIL_URL),
    probeHealth('vault', VAULT_URL),
    probeHealth('forge', FORGE_URL),
  ])
  const all = [anvil, vault, forge]
  const reachable = all.filter(s => s.status === 'healthy').map(s => s.name)
  res.json({
    ready: reachable.length === 3,
    reachable,
    missing: ['anvil', 'vault', 'forge'].filter(n => !reachable.includes(n)),
  })
})

// ─── Static ───────────────────────────────────────────────────────────────────

const PUBLIC_DIR = join(__dirname, '../public')
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR))
  app.get('*', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')))
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`@horus/ui-server listening on :${PORT}`)
  console.log(`  anvil → ${ANVIL_URL}`)
  console.log(`  vault → ${VAULT_URL}`)
  console.log(`  forge → ${FORGE_URL}`)
})
