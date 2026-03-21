/**
 * Anthropic provider for Vercel AI SDK.
 * Reads API key from env var or _system/ui/preferences.json.
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.HORUS_DATA_PATH ?? join(__dirname, '../../..', '.horus-data')
const UI_PREFS = join(DATA_DIR, '_system/ui/preferences.json')

async function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const prefs = JSON.parse(await readFile(UI_PREFS, 'utf8'))
    return prefs?.llm?.apiKey ?? prefs?.settings?.anthropicApiKey ?? null
  } catch {
    return null
  }
}

export async function getProvider() {
  const apiKey = await loadApiKey()
  if (!apiKey) return null
  return createAnthropic({ apiKey })
}

export async function getApiKeyStatus() {
  const apiKey = await loadApiKey()
  if (!apiKey) return { configured: false }
  const masked = apiKey.slice(0, 10) + '...' + apiKey.slice(-4)
  return { configured: true, masked }
}
