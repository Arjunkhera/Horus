/**
 * MCP tool definitions for Vercel AI SDK.
 * Read-only tools with execute functions that call backend services.
 * renderView is client-side only (no execute).
 *
 * Uses jsonSchema() with inputSchema (not parameters) for AI SDK v6 compatibility.
 * AI SDK v6 renamed tool.parameters to tool.inputSchema; the old key is silently ignored.
 */
import { tool, jsonSchema } from 'ai'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MCP_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }

// Track MCP sessions per backend (session ID required after initialize)
const sessions = new Map()

async function ensureInitialized(baseUrl) {
  if (sessions.has(baseUrl)) return
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'horus-ui', version: '0.1.0' },
      },
    }),
  })
  const sessionId = res.headers.get('mcp-session-id')
  const json = await res.json()
  if (json.error) throw new Error(`MCP init failed for ${baseUrl}: ${json.error.message}`)
  sessions.set(baseUrl, sessionId)
}

async function callMcp(baseUrl, toolName, args) {
  await ensureInitialized(baseUrl)
  const sessionId = sessions.get(baseUrl)
  const headers = { ...MCP_HEADERS }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })
  const json = await res.json()
  if (json.error) {
    // Clear the stale session so the next call re-initializes
    sessions.delete(baseUrl)
    throw new Error(json.error.message ?? 'MCP call failed')
  }
  // MCP tool results come as content array — extract text
  const content = json.result?.content ?? []
  const text = content.find(c => c.type === 'text')
  return text ? JSON.parse(text.text) : json.result
}

// ─── Tool Factory ─────────────────────────────────────────────────────────────

export function createTools({ anvilUrl, vaultUrl, forgeUrl }) {
  return {
    // ── Cross-system (preferred for queries spanning Anvil + Vault + Forge) ─

    horus_search: tool({
      description: 'Search across ALL Horus systems (Anvil + Vault + Forge) via the unified Typesense index. Prefer this over system-specific search tools for cross-system queries. Optionally scope to a single source.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search query' },
          source: { type: 'string', enum: ['anvil', 'vault', 'forge'], description: 'Scope to a single source system (omit for cross-system)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
          offset: { type: 'number', description: 'Result offset for pagination (default 0)' },
        },
        required: ['query'],
      }),
      execute: async (args) => callMcp(anvilUrl, 'horus_search', args),
    }),

    // ── Anvil (read-only — use for Anvil-specific structured queries) ───────

    anvil_search: tool({
      description: 'Search Anvil notes by free-text query and/or structured filters. Returns matching notes with snippets.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search query' },
          type: { type: 'string', description: 'Filter by note type (story, task, journal, note, project, etc.)' },
          status: { type: 'string', description: 'Filter by status (open, in-progress, done, blocked, etc.)' },
          priority: { type: 'string', description: 'Filter by priority (P0-critical, P1-high, P2-medium, P3-low)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (AND semantics)' },
          project: { type: 'string', description: 'Filter by project note ID' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      }),
      execute: async (args) => callMcp(anvilUrl, 'anvil_search', args),
    }),

    anvil_get_note: tool({
      description: 'Retrieve a specific Anvil note by its UUID. Returns full metadata and body content.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          noteId: { type: 'string', description: 'UUID of the note to retrieve' },
        },
        required: ['noteId'],
      }),
      execute: async (args) => callMcp(anvilUrl, 'anvil_get_note', args),
    }),

    anvil_query_view: tool({
      description: 'Query Anvil notes with filtering, sorting, and grouping. Use view "board" with groupBy for kanban views, "table" for tabular data, "list" for simple lists.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['list', 'table', 'board'], description: 'View type' },
          filters: {
            type: 'object',
            description: 'Filter criteria',
            properties: {
              type: { type: 'string' },
              status: { type: 'string' },
              priority: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              project: { type: 'string' },
              query: { type: 'string' },
            },
          },
          groupBy: { type: 'string', description: 'Field to group by (required for board view)' },
          orderBy: {
            type: 'object',
            description: 'Sort options',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['field', 'direction'],
          },
          columns: { type: 'array', items: { type: 'string' }, description: 'Columns for table view' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
        required: ['view'],
      }),
      execute: async (args) => callMcp(anvilUrl, 'anvil_query_view', args),
    }),

    // ── Vault (read-only) ───────────────────────────────────────────────────

    knowledge_search: tool({
      description: 'Search the Vault knowledge base using hybrid search. Returns page summaries with relevance scores. Good for finding guides, concepts, learnings, and repo profiles.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (natural language or keywords)' },
          type: { type: 'string', enum: ['repo-profile', 'guide', 'concept', 'procedure', 'keystone', 'learning'], description: 'Filter by page type' },
          scope: {
            type: 'object',
            description: 'Filter by scope',
            properties: {
              repo: { type: 'string' },
              program: { type: 'string' },
            },
          },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      }),
      execute: async (args) => callMcp(vaultUrl, 'knowledge_search', args),
    }),

    knowledge_resolve_context: tool({
      description: 'Load all applicable knowledge pages for a repository — repo profile, guides, procedures, conventions. The primary entry point for understanding a codebase.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name (e.g. "anvil", "forge", "vault")' },
          include_full: { type: 'boolean', description: 'If true, return full page content' },
        },
        required: ['repo'],
      }),
      execute: async (args) => callMcp(vaultUrl, 'knowledge_resolve_context', args),
    }),

    knowledge_get_page: tool({
      description: 'Retrieve the full content of a specific Vault knowledge page by UUID.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          id: { type: 'string', description: 'UUID of the knowledge page' },
        },
        required: ['id'],
      }),
      execute: async (args) => callMcp(vaultUrl, 'knowledge_get_page', args),
    }),

    // ── Forge (read-only) ───────────────────────────────────────────────────

    forge_repo_list: tool({
      description: 'List all repositories in the local Forge index.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => callMcp(forgeUrl, 'forge_repo_list', {}),
    }),

    forge_workspace_list: tool({
      description: 'List all Forge workspaces with their status.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => callMcp(forgeUrl, 'forge_workspace_list', {}),
    }),

    // ── Render (client-side only — no execute) ──────────────────────────────

    renderView: tool({
      description: `Render data as an interactive visual primitive in the chat. Use this after fetching data to display it to the user.
- "board": Kanban-style columns grouped by a field (best for stories/tasks grouped by status)
- "table": Sortable columns (best for structured data with many fields)
- "list": Simple sorted list with status and priority badges (best for quick overviews)
- "cards": Rich cards with tags and body preview (best for notes, knowledge pages)

Always call this tool after retrieving data to present it visually.`,
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          primitive: { type: 'string', enum: ['board', 'table', 'list', 'cards'], description: 'Which visual primitive to use' },
          title: { type: 'string', description: 'Display title for the rendered view' },
          items: { type: 'array', items: { type: 'object' }, description: 'Array of data items to render' },
          groupBy: { type: 'string', description: 'Field to group by (for board view)' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Column fields to show (for table view)' },
          sortBy: { type: 'string', description: 'Field to sort by' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        },
        required: ['primitive', 'title', 'items'],
      }),
      // Intercepted by the frontend via onToolCall; no-op execute satisfies AI SDK
      // requirement that all tools with inputSchema have an execute function.
      execute: async () => ({ rendered: true }),
    }),
  }
}
