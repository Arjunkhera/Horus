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
const SEARCH_URL = process.env.SEARCH_URL ?? 'http://typesense:8108'

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

/** Load the configured service list (saved config merged over defaults). */
async function loadServices() {
  const saved = await readJsonFile(SVCCONFIG, {})
  return { ...DEFAULT_SERVICES(), ...saved }
}

app.get('/api/health', async (_req, res) => {
  const svcMap = await loadServices()
  const checkedAt = new Date().toISOString()
  const results = await Promise.all(
    Object.entries(svcMap).map(([name, cfg]) => probeHealth(name, cfg.url))
  )
  const services = results.map(s => ({ ...s, checkedAt }))
  const overall = services.every(s => s.status === 'healthy') ? 'healthy'
    : services.some(s => s.status === 'healthy')               ? 'degraded'
    : 'unhealthy'
  res.json({ overall, services, checkedAt })
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

const DEFAULT_SERVICES = () => ({
  anvil:  { url: ANVIL_URL },
  vault:  { url: VAULT_URL },
  forge:  { url: FORGE_URL },
  search: { url: SEARCH_URL },
})

app.get('/api/config/services', async (_req, res) => {
  // Merge saved config over defaults so new services appear automatically
  const saved = await readJsonFile(SVCCONFIG, {})
  res.json({ ...DEFAULT_SERVICES(), ...saved })
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
  const svcMap = await loadServices()
  const results = await Promise.all(
    Object.entries(svcMap).map(([name, cfg]) => probeHealth(name, cfg.url))
  )
  const reachable = results.filter(s => s.status === 'healthy').map(s => s.name)
  const all = Object.keys(svcMap)
  res.json({
    ready: reachable.length === all.length,
    reachable,
    missing: all.filter(n => !reachable.includes(n)),
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
