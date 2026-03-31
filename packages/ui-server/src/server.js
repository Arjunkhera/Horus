import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createChatHandler } from './chat.js'
import { mountConversationRoutes } from './conversations.js'
import { getApiKeyStatus } from './provider.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 8400

const ANVIL_URL  = process.env.ANVIL_URL  ?? 'http://anvil:8100'
const VAULT_URL  = process.env.VAULT_URL  ?? 'http://vault-mcp:8300'
const FORGE_URL  = process.env.FORGE_URL  ?? 'http://forge:8200'
const SEARCH_URL = process.env.SEARCH_URL ?? 'http://search:8108'

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

// ─── Service config ───────────────────────────────────────────────────────────

/**
 * Default service list. Used when services.json does not exist or is empty.
 * Each entry: { name: string, url: string }
 */
const DEFAULT_SERVICES = [
  { name: 'anvil',  url: ANVIL_URL  },
  { name: 'vault',  url: VAULT_URL  },
  { name: 'forge',  url: FORGE_URL  },
  { name: 'search', url: SEARCH_URL },
]

/**
 * Read the service list from services.json.
 * Supports both the legacy object format ({ anvil: { url }, ... }) and the
 * new array format ([{ name, url }, ...]). Always returns an array.
 */
async function readServiceList(path) {
  const raw = await readJsonFile(path, null)
  if (!raw) return DEFAULT_SERVICES

  // New array format
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw : DEFAULT_SERVICES
  }

  // Legacy object format — migrate on the fly
  const entries = Object.entries(raw).map(([name, cfg]) => ({
    name,
    url: typeof cfg === 'string' ? cfg : (cfg?.url ?? ''),
  }))
  return entries.length > 0 ? entries : DEFAULT_SERVICES
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
  const serviceList = await readServiceList(SVCCONFIG)
  const checkedAt = new Date().toISOString()
  const results = await Promise.all(serviceList.map(svc => probeHealth(svc.name, svc.url)))
  const overall = results.every(s => s.status === 'healthy') ? 'healthy'
    : results.some(s => s.status === 'healthy')              ? 'degraded'
    : 'unhealthy'
  res.json({ overall, services: results, checkedAt })
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

const DATA_DIR  = process.env.HORUS_DATA_PATH ?? join(__dirname, '../../..', 'data')
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

/**
 * GET /api/config/services
 * Returns the current service list as an array: [{ name, url }]
 */
app.get('/api/config/services', async (_req, res) => {
  res.json(await readServiceList(SVCCONFIG))
})

/**
 * PUT /api/config/services
 * Replace the entire service list. Body: [{ name, url }]
 */
app.put('/api/config/services', async (req, res) => {
  const list = req.body
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'Body must be an array of { name, url } objects' })
  }
  await writeJsonAtomic(SVCCONFIG, list)
  res.json(list)
})

// ─── Chat (Phase 2) ──────────────────────────────────────────────────────────

const chatHandler = createChatHandler({
  anvilUrl: ANVIL_URL,
  vaultUrl: VAULT_URL,
  forgeUrl: FORGE_URL,
})

app.post('/api/chat', chatHandler)

app.get('/api/chat/status', async (_req, res) => {
  res.json(await getApiKeyStatus())
})

// ─── Conversations (Phase 2) ─────────────────────────────────────────────────

mountConversationRoutes(app)

// ─── Setup ────────────────────────────────────────────────────────────────────

app.get('/api/setup/status', async (_req, res) => {
  const serviceList = await readServiceList(SVCCONFIG)
  const results = await Promise.all(serviceList.map(svc => probeHealth(svc.name, svc.url)))
  const reachable = results.filter(s => s.status === 'healthy').map(s => s.name)
  const allNames  = serviceList.map(s => s.name)
  res.json({
    ready: reachable.length === allNames.length,
    reachable,
    missing: allNames.filter(n => !reachable.includes(n)),
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
  console.log(`  anvil  → ${ANVIL_URL}`)
  console.log(`  vault  → ${VAULT_URL}`)
  console.log(`  forge  → ${FORGE_URL}`)
  console.log(`  search → ${SEARCH_URL}`)
})
