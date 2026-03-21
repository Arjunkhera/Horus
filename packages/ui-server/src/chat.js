/**
 * Chat endpoint — POST /api/chat
 * Uses Vercel AI SDK streamText to orchestrate LLM + tool calls.
 */
import { streamText } from 'ai'
import { getProvider } from './provider.js'
import { createTools } from './tools.js'

const MODEL = process.env.HORUS_CHAT_MODEL ?? 'claude-sonnet-4-5-20250514'

const SYSTEM_PROMPT = `You are Horus, a personal developer assistant. You help the user explore and manage their work across three systems:

- **Anvil** — Notes, tasks, stories, journals, projects. Use anvil_search, anvil_get_note, anvil_query_view.
- **Vault** — Knowledge base with guides, repo profiles, concepts, learnings. Use knowledge_search, knowledge_resolve_context, knowledge_get_page.
- **Forge** — Workspaces and repositories. Use forge_repo_list, forge_workspace_list.

## How to respond

1. When the user asks to see data (tasks, stories, notes, knowledge), call the appropriate search/query tool first.
2. After retrieving results, ALWAYS call renderView to display them visually. Pick the best primitive:
   - "board" for stories/tasks grouped by status — set groupBy to "status"
   - "table" for data with many fields the user might want to compare
   - "list" for quick overviews or search results
   - "cards" for notes/knowledge pages with body content
3. Keep text responses concise. Let the rendered view do the heavy lifting.
4. For follow-up queries like "just the P0s" or "filter to open only", refine the previous search and render again.
5. If the user asks something you don't have a tool for, answer from your knowledge but be clear about what you can and cannot access.

## Important
- Items from Anvil have fields: noteId, type, title, status, priority, tags, modified, body
- Items from Vault have fields: id, path, title, description, type, mode, scope, tags, relevance_score
- Always pass the noteId or id as the "id" field in renderView items
- When showing mixed results, include a "source" field ("anvil" or "vault") on each item`

export function createChatHandler({ anvilUrl, vaultUrl, forgeUrl }) {
  const tools = createTools({ anvilUrl, vaultUrl, forgeUrl })

  return async (req, res) => {
    const { messages } = req.body

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' })
    }

    const provider = await getProvider()
    if (!provider) {
      return res.status(503).json({
        error: 'no_api_key',
        message: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY env var or configure in Settings.',
      })
    }

    try {
      const result = streamText({
        model: provider(MODEL),
        system: SYSTEM_PROMPT,
        messages,
        tools,
        maxSteps: 10,
      })

      return result.toDataStreamResponse({ headers: res.getHeaders() })
    } catch (err) {
      console.error('[chat] streamText error:', err)
      return res.status(500).json({ error: 'chat_error', message: err.message })
    }
  }
}
