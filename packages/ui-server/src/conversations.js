/**
 * Conversation CRUD API.
 * Stores conversations as JSON files in _system/ui/conversations/.
 */
import { readFile, writeFile, readdir, unlink, mkdir, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.HORUS_DATA_PATH ?? join(__dirname, '../../..', 'data')
const CONV_DIR = join(DATA_DIR, '_system/ui/conversations')

async function ensureDir() {
  await mkdir(CONV_DIR, { recursive: true })
}

async function writeAtomic(path, data) {
  await ensureDir()
  const tmp = path + '.tmp.' + randomBytes(4).toString('hex')
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)
}

function convPath(id) {
  return join(CONV_DIR, `${id}.json`)
}

export function mountConversationRoutes(app) {
  // List all conversations (metadata only — no messages)
  app.get('/api/conversations', async (_req, res) => {
    try {
      await ensureDir()
      const files = await readdir(CONV_DIR)
      const convs = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const data = JSON.parse(await readFile(join(CONV_DIR, file), 'utf8'))
          convs.push({
            id: data.id,
            title: data.title,
            created: data.created,
            modified: data.modified,
            messageCount: data.messages?.length ?? 0,
          })
        } catch { /* skip corrupt files */ }
      }
      convs.sort((a, b) => new Date(b.modified) - new Date(a.modified))
      res.json({ conversations: convs })
    } catch (err) {
      res.status(500).json({ error: 'list_failed', message: err.message })
    }
  })

  // Get a single conversation with full messages
  app.get('/api/conversations/:id', async (req, res) => {
    try {
      const data = JSON.parse(await readFile(convPath(req.params.id), 'utf8'))
      res.json(data)
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found' })
      res.status(500).json({ error: 'read_failed', message: err.message })
    }
  })

  // Create a new conversation
  app.post('/api/conversations', async (req, res) => {
    try {
      const id = randomUUID()
      const now = new Date().toISOString()
      const conv = {
        id,
        title: req.body.title || 'New conversation',
        created: now,
        modified: now,
        messages: req.body.messages || [],
        pinned: [],
      }
      await writeAtomic(convPath(id), conv)
      res.status(201).json(conv)
    } catch (err) {
      res.status(500).json({ error: 'create_failed', message: err.message })
    }
  })

  // Update a conversation (messages, title, pinned)
  app.put('/api/conversations/:id', async (req, res) => {
    try {
      let existing
      try {
        existing = JSON.parse(await readFile(convPath(req.params.id), 'utf8'))
      } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found' })
        throw err
      }
      const updated = {
        ...existing,
        ...req.body,
        id: existing.id, // prevent ID change
        created: existing.created, // preserve creation time
        modified: new Date().toISOString(),
      }
      await writeAtomic(convPath(existing.id), updated)
      res.json(updated)
    } catch (err) {
      res.status(500).json({ error: 'update_failed', message: err.message })
    }
  })

  // Delete a conversation
  app.delete('/api/conversations/:id', async (req, res) => {
    try {
      await unlink(convPath(req.params.id))
      res.json({ deleted: true })
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not_found' })
      res.status(500).json({ error: 'delete_failed', message: err.message })
    }
  })
}
