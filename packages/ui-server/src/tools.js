/**
 * MCP tool definitions for Vercel AI SDK.
 * Read-only tools with execute functions that call backend services.
 * renderView is client-side only (no execute).
 */
import { tool } from 'ai'
import { z } from 'zod'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callMcp(baseUrl, toolName, args) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message ?? 'MCP call failed')
  // MCP tool results come as content array — extract text
  const content = json.result?.content ?? []
  const text = content.find(c => c.type === 'text')
  return text ? JSON.parse(text.text) : json.result
}

// ─── Tool Factory ─────────────────────────────────────────────────────────────

export function createTools({ anvilUrl, vaultUrl, forgeUrl }) {
  return {
    // ── Anvil (read-only) ───────────────────────────────────────────────────

    anvil_search: tool({
      description: 'Search Anvil notes by free-text query and/or structured filters. Returns matching notes with snippets.',
      parameters: z.object({
        query: z.string().optional().describe('Free-text search query'),
        type: z.string().optional().describe('Filter by note type (story, task, journal, note, project, etc.)'),
        status: z.string().optional().describe('Filter by status (open, in-progress, done, blocked, etc.)'),
        priority: z.string().optional().describe('Filter by priority (P0-critical, P1-high, P2-medium, P3-low)'),
        tags: z.array(z.string()).optional().describe('Filter by tags (AND semantics)'),
        project: z.string().optional().describe('Filter by project note ID'),
        limit: z.number().optional().describe('Max results (default 20)'),
      }),
      execute: async (args) => callMcp(anvilUrl, 'anvil_search', args),
    }),

    anvil_get_note: tool({
      description: 'Retrieve a specific Anvil note by its UUID. Returns full metadata and body content.',
      parameters: z.object({
        noteId: z.string().describe('UUID of the note to retrieve'),
      }),
      execute: async (args) => callMcp(anvilUrl, 'anvil_get_note', args),
    }),

    anvil_query_view: tool({
      description: 'Query Anvil notes with filtering, sorting, and grouping. Use view "board" with groupBy for kanban views, "table" for tabular data, "list" for simple lists.',
      parameters: z.object({
        view: z.enum(['list', 'table', 'board']).describe('View type'),
        filters: z.object({
          type: z.string().optional(),
          status: z.string().optional(),
          priority: z.string().optional(),
          tags: z.array(z.string()).optional(),
          project: z.string().optional(),
          query: z.string().optional(),
        }).optional().describe('Filter criteria'),
        groupBy: z.string().optional().describe('Field to group by (required for board view)'),
        orderBy: z.object({
          field: z.string(),
          direction: z.enum(['asc', 'desc']),
        }).optional().describe('Sort options'),
        columns: z.array(z.string()).optional().describe('Columns for table view'),
        limit: z.number().optional().describe('Max results (default 50)'),
      }),
      execute: async (args) => callMcp(anvilUrl, 'anvil_query_view', args),
    }),

    // ── Vault (read-only) ───────────────────────────────────────────────────

    knowledge_search: tool({
      description: 'Search the Vault knowledge base using hybrid search. Returns page summaries with relevance scores. Good for finding guides, concepts, learnings, and repo profiles.',
      parameters: z.object({
        query: z.string().describe('Search query (natural language or keywords)'),
        type: z.enum(['repo-profile', 'guide', 'concept', 'procedure', 'keystone', 'learning']).optional().describe('Filter by page type'),
        scope: z.object({
          repo: z.string().optional(),
          program: z.string().optional(),
        }).optional().describe('Filter by scope'),
        limit: z.number().optional().describe('Max results (default 10)'),
      }),
      execute: async (args) => callMcp(vaultUrl, 'knowledge_search', args),
    }),

    knowledge_resolve_context: tool({
      description: 'Load all applicable knowledge pages for a repository — repo profile, guides, procedures, conventions. The primary entry point for understanding a codebase.',
      parameters: z.object({
        repo: z.string().describe('Repository name (e.g. "anvil", "forge", "vault")'),
        include_full: z.boolean().optional().describe('If true, return full page content'),
      }),
      execute: async (args) => callMcp(vaultUrl, 'knowledge_resolve_context', args),
    }),

    knowledge_get_page: tool({
      description: 'Retrieve the full content of a specific Vault knowledge page by UUID.',
      parameters: z.object({
        id: z.string().describe('UUID of the knowledge page'),
      }),
      execute: async (args) => callMcp(vaultUrl, 'knowledge_get_page', args),
    }),

    // ── Forge (read-only) ───────────────────────────────────────────────────

    forge_repo_list: tool({
      description: 'List all repositories in the local Forge index.',
      parameters: z.object({}),
      execute: async () => callMcp(forgeUrl, 'forge_repo_list', {}),
    }),

    forge_workspace_list: tool({
      description: 'List all Forge workspaces with their status.',
      parameters: z.object({}),
      execute: async () => callMcp(forgeUrl, 'forge_workspace_list', {}),
    }),

    // ── Render (client-side only — no execute) ──────────────────────────────

    renderView: {
      description: `Render data as an interactive visual primitive in the chat. Use this after fetching data to display it to the user.
- "board": Kanban-style columns grouped by a field (best for stories/tasks grouped by status)
- "table": Sortable columns (best for structured data with many fields)
- "list": Simple sorted list with status and priority badges (best for quick overviews)
- "cards": Rich cards with tags and body preview (best for notes, knowledge pages)

Always call this tool after retrieving data to present it visually.`,
      parameters: z.object({
        primitive: z.enum(['board', 'table', 'list', 'cards']).describe('Which visual primitive to use'),
        title: z.string().describe('Display title for the rendered view'),
        items: z.array(z.record(z.any())).describe('Array of data items to render'),
        groupBy: z.string().optional().describe('Field to group by (for board view)'),
        columns: z.array(z.string()).optional().describe('Column fields to show (for table view)'),
        sortBy: z.string().optional().describe('Field to sort by'),
        sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
      }),
      // No execute — this tool is intercepted by the frontend
    },
  }
}
