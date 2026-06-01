/**
 * vault-local-mcp.js — In-process Vault (knowledge_*) MCP router for horus-ui.
 *
 * Connected mode only. The control plane serves the vault as a REST API
 * (`/api/v1/vault/{get-page,search,list-by-scope,...}`) but exposes NO MCP
 * JSON-RPC endpoint, so forwarding `/vault/mcp` straight to the CP 404s. This
 * router closes that gap the same way Forge does (forge-local-mcp.js): it
 * embeds an MCP server inside the horus-ui process that translates knowledge_*
 * tool calls into authenticated CP REST calls. MCP endpoint: POST /vault/mcp.
 * Health: GET /vault/health.
 *
 * The tool definitions + REST mapping are vendored from packages/vault-mcp
 * (@vault/knowledge-mcp). They are duplicated rather than imported because
 * horus-ui ships embedded in the Forge nested pnpm workspace (see
 * packages/horus-ui/Dockerfile), where the root-workspace @vault/knowledge-mcp
 * package is not resolvable. Keep this list in sync with
 * packages/vault-mcp/src/index.ts if tools change.
 *
 * Mounted by server.js only when HORUS_CONTROL_PLANE_URL is set:
 *   app.use('/vault', vaultMcpRouter)
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getToken } from './token-provider.js';

const CONTROL_PLANE_URL = (process.env.HORUS_CONTROL_PLANE_URL || '').trim().replace(/\/$/, '');
// The vault adapter's tool handlers POST to `${base}/search`, `/get-page`,
// etc. The CP mounts those under /api/v1/vault.
const VAULT_REST_BASE = `${CONTROL_PLANE_URL}/api/v1/vault`;

// ── REST helper ──────────────────────────────────────────────────────────────

async function callKnowledgeAPI(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${VAULT_REST_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }
  return response.json();
}

const VAULT_PARAM = {
  type: 'string',
  description:
    'Optional. Scope to a specific vault. Omit to search all vaults (reads) or use the default vault (writes).',
};

function withVault(body, toolArgs) {
  if (toolArgs.vault) return { ...body, vault: toolArgs.vault };
  return body;
}

// ── Tool definitions (mirror packages/vault-mcp/src/index.ts) ─────────────────

const TOOLS = [
  {
    name: 'knowledge_resolve_context',
    description:
      'Resolve the scope for a repository and return all applicable operational pages. ' +
      'This is the primary entry point for getting context about a codebase — it finds the ' +
      'repo-profile page, resolves which program the repo belongs to, and returns procedures, ' +
      'guides, and conventions that apply at the repo and program level.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: "Repository name (e.g., 'anvil', 'forge', 'vault')" },
        vault: VAULT_PARAM,
        include_full: {
          type: 'boolean',
          description: 'If true, return full page content. If false (default), return summaries only.',
          default: false,
        },
        mode: {
          type: 'string',
          enum: ['search', 'exact'],
          description:
            "Resolution mode. 'search' (default): relevance-ranked Typesense query — use when the exact scope.repo is not known (e.g. sub-service names). 'exact': scope.repo exact match — use only when the canonical repo name is known with certainty.",
          default: 'search',
        },
      },
      required: ['repo'],
    },
  },
  {
    name: 'knowledge_search',
    description:
      'Search the knowledge base using hybrid search (keyword + semantic + reranking). ' +
      'Returns page summaries with relevance scores. Use this for exploratory queries or ' +
      "when you don't know the exact page you're looking for.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (natural language or keywords)' },
        mode: {
          type: 'string',
          enum: ['reference', 'operational', 'keystone'],
          description: 'Filter by page mode',
        },
        type: {
          type: 'string',
          enum: ['repo-profile', 'guide', 'concept', 'procedure', 'keystone', 'learning'],
          description: 'Filter by page type',
        },
        scope: {
          type: 'object',
          properties: {
            program: { type: 'string', description: 'Program identifier' },
            repo: { type: 'string', description: 'Repository name' },
          },
          description: 'Filter by scope (AND logic)',
        },
        limit: { type: 'number', description: 'Maximum results (default: 10)', default: 10 },
        vault: VAULT_PARAM,
      },
      required: ['query'],
    },
  },
  {
    name: 'knowledge_get_page',
    description:
      'Retrieve the full content of a specific knowledge page by its ID (UUID or file path). ' +
      'Use this after finding a relevant page via search or resolve-context.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "Page identifier (UUID or file path, e.g., 'repos/anvil.md')" },
        vault: VAULT_PARAM,
      },
      required: ['id'],
    },
  },
  {
    name: 'knowledge_get_related',
    description:
      "Follow links from a knowledge page to find related pages. Traverses 'related', " +
      "'depends-on', 'consumed-by', and 'applies-to' relationship fields.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Source page identifier (UUID or file path)' },
        vault: VAULT_PARAM,
      },
      required: ['id'],
    },
  },
  {
    name: 'knowledge_list_by_scope',
    description:
      'List and filter knowledge pages by scope and other criteria. ' +
      'Use this to browse pages for a specific program or repo.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'object',
          properties: {
            program: { type: 'string' },
            repo: { type: 'string' },
          },
          description: 'Scope filter (at least one field required)',
        },
        mode: { type: 'string', enum: ['reference', 'operational', 'keystone'] },
        type: {
          type: 'string',
          enum: ['repo-profile', 'guide', 'concept', 'procedure', 'keystone', 'learning'],
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'AND logic' },
        limit: { type: 'number', default: 50 },
        vault: VAULT_PARAM,
      },
      required: ['scope'],
    },
  },
  {
    name: 'knowledge_validate_page',
    description:
      'Validate a knowledge page against the schema and registries. Returns structured ' +
      'errors with fuzzy-match suggestions. Use before committing a page.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Full markdown with YAML frontmatter' },
        vault: VAULT_PARAM,
      },
      required: ['content'],
    },
  },
  {
    name: 'knowledge_suggest_metadata',
    description:
      'Suggest frontmatter metadata for a knowledge page. Analyses content and returns ' +
      'per-field suggestions with confidence levels.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Full markdown — may have partial frontmatter' },
        hints: { type: 'object', description: 'Optional partial knowledge to improve suggestions' },
        vault: VAULT_PARAM,
      },
      required: ['content'],
    },
  },
  {
    name: 'knowledge_check_duplicates',
    description:
      'Check candidate page content against existing KB pages for overlap. ' +
      'Score >= threshold means novel (create). Below threshold means overlap (merge).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Proposed page title' },
        content: { type: 'string', description: 'Page body content' },
        threshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.75)', default: 0.75 },
        vault: VAULT_PARAM,
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'knowledge_get_schema',
    description:
      'Retrieve the full schema definition and all registry contents (tags, repos, programs). ' +
      'Use this to understand available page types and valid values before generating pages.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'knowledge_registry_add',
    description:
      'Add a new entry to a registry (tags, repos, or programs). Use when validation ' +
      'rejects a value that should be added rather than corrected. Set via_pr=true to ' +
      'write the updated registry to a git branch and open a PR instead of editing in-place.',
    inputSchema: {
      type: 'object',
      properties: {
        registry: { type: 'string', enum: ['tags', 'repos', 'programs'] },
        entry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            scope_program: { type: 'string' },
          },
          required: ['id'],
        },
        via_pr: {
          type: 'boolean',
          description:
            'If true, write the updated registry to a git branch and open a GitHub PR. Requires GitHub token and repo to be configured.',
        },
      },
      required: ['registry', 'entry'],
    },
  },
  {
    name: 'knowledge_write_page',
    description:
      'Write a validated knowledge page to the knowledge-base repo, commit it to a new branch, ' +
      'and open a GitHub PR for human review. A UUID is auto-generated if not present in frontmatter. Returns the PR URL.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "Relative page path, e.g. 'repos/anvil.md'" },
        content: {
          type: 'string',
          description: 'Full markdown content with YAML frontmatter (UUID auto-generated if missing)',
        },
        commit_message: { type: 'string', description: 'Git commit message (optional)' },
        pr_title: { type: 'string', description: 'GitHub PR title (optional)' },
        pr_body: { type: 'string', description: 'GitHub PR description body (optional)' },
        vault: VAULT_PARAM,
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'knowledge_create_edge',
    description:
      'Create a directed edge between two knowledge pages in the Neo4j graph. ' +
      'Nodes are created automatically if they do not exist (MERGE semantics). ' +
      'Use this to model relationships such as DEPENDS_ON, PART_OF, SENDS_TO, DOCS, or RELATED.',
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Page ID of the source node (UUID or file path)' },
        target_id: { type: 'string', description: 'Page ID of the target node' },
        edge_type: {
          type: 'string',
          enum: ['PART_OF', 'DEPENDS_ON', 'SENDS_TO', 'DOCS', 'RELATED'],
          description: 'Type of relationship between the two pages',
        },
        properties: {
          type: 'object',
          properties: {
            mechanism: { type: 'string', description: 'Optional: e.g. queue name, npm package' },
            role: { type: 'string', description: 'Optional: e.g. producer, consumer' },
          },
          description: 'Optional edge metadata',
        },
      },
      required: ['source_id', 'target_id', 'edge_type'],
    },
  },
  {
    name: 'knowledge_get_edges',
    description:
      'Get all edges for a knowledge page in the Neo4j graph. ' +
      'Returns edges in both directions (outgoing and incoming). ' +
      'Optionally filter by edge type.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID to retrieve edges for' },
        edge_type: {
          type: 'string',
          enum: ['PART_OF', 'DEPENDS_ON', 'SENDS_TO', 'DOCS', 'RELATED'],
          description: 'Optional: filter results to this edge type only',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'knowledge_delete_edge',
    description:
      'Delete a specific directed edge between two knowledge pages in the Neo4j graph. ' +
      'The source and target page nodes are preserved; only the relationship is removed.',
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Page ID of the source node' },
        target_id: { type: 'string', description: 'Page ID of the target node' },
        edge_type: {
          type: 'string',
          enum: ['PART_OF', 'DEPENDS_ON', 'SENDS_TO', 'DOCS', 'RELATED'],
          description: 'Type of the edge to delete',
        },
      },
      required: ['source_id', 'target_id', 'edge_type'],
    },
  },
  {
    name: 'knowledge_traverse_graph',
    description:
      'Traverse the knowledge graph from a starting page up to a configurable depth. ' +
      'Returns all reachable pages within the depth limit. ' +
      'Optionally filter traversal to specific edge types.',
    inputSchema: {
      type: 'object',
      properties: {
        start_page_id: { type: 'string', description: 'Page ID to start traversal from' },
        edge_types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['PART_OF', 'DEPENDS_ON', 'SENDS_TO', 'DOCS', 'RELATED'],
          },
          description: 'Optional: restrict traversal to these edge types only',
        },
        max_depth: {
          type: 'number',
          description: 'Maximum number of hops to traverse (1–10, default: 3)',
          default: 3,
        },
      },
      required: ['start_page_id'],
    },
  },
  {
    name: 'knowledge_export_graph',
    description:
      'Export the Neo4j knowledge graph (all nodes and edges) to a JSON file in the ' +
      'knowledge-base repo (_graph/edges.json). Enables git-backed cloud sync and ' +
      'bootstrapping of new instances. Returns export stats (node count, edge count, file path). ' +
      'Returns an error if the graph client is unavailable.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'knowledge_import_graph',
    description:
      'Import/seed Neo4j from the graph export file in the knowledge-base repo ' +
      '(_graph/edges.json). Idempotent — uses MERGE so it is safe to call multiple times. ' +
      'Returns import stats. If the export file does not exist, returns skipped: true ' +
      'with zero counts. Returns an error if the graph client is unavailable.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── MCP server factory ────────────────────────────────────────────────────────

function buildServer() {
  const server = new Server(
    { name: '@vault/knowledge-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    if (!toolArgs) throw new Error('Missing arguments');

    try {
      let result;
      switch (name) {
        case 'knowledge_resolve_context':
          result = await callKnowledgeAPI('/resolve-context', withVault({
            repo: toolArgs.repo,
            include_full: toolArgs.include_full ?? false,
            mode: toolArgs.mode ?? 'search',
          }, toolArgs));
          break;
        case 'knowledge_search':
          result = await callKnowledgeAPI('/search', withVault({
            query: toolArgs.query,
            mode: toolArgs.mode,
            type: toolArgs.type,
            scope: toolArgs.scope,
            limit: toolArgs.limit ?? 10,
          }, toolArgs));
          break;
        case 'knowledge_get_page':
          result = await callKnowledgeAPI('/get-page', withVault({ id: toolArgs.id }, toolArgs));
          break;
        case 'knowledge_get_related':
          result = await callKnowledgeAPI('/get-related', withVault({ id: toolArgs.id }, toolArgs));
          break;
        case 'knowledge_list_by_scope':
          result = await callKnowledgeAPI('/list-by-scope', withVault({
            scope: toolArgs.scope,
            mode: toolArgs.mode,
            type: toolArgs.type,
            tags: toolArgs.tags,
            limit: toolArgs.limit ?? 50,
          }, toolArgs));
          break;
        case 'knowledge_validate_page':
          result = await callKnowledgeAPI('/validate-page', withVault({ content: toolArgs.content }, toolArgs));
          break;
        case 'knowledge_suggest_metadata':
          result = await callKnowledgeAPI('/suggest-metadata', withVault({
            content: toolArgs.content,
            hints: toolArgs.hints,
          }, toolArgs));
          break;
        case 'knowledge_check_duplicates':
          result = await callKnowledgeAPI('/check-duplicates', withVault({
            title: toolArgs.title,
            content: toolArgs.content,
            threshold: toolArgs.threshold ?? 0.75,
          }, toolArgs));
          break;
        case 'knowledge_get_schema':
          result = await callKnowledgeAPI('/schema', withVault({}, toolArgs));
          break;
        case 'knowledge_registry_add':
          result = await callKnowledgeAPI('/registry/add', withVault({
            registry: toolArgs.registry,
            entry: toolArgs.entry,
            via_pr: toolArgs.via_pr ?? false,
          }, toolArgs));
          break;
        case 'knowledge_write_page':
          result = await callKnowledgeAPI('/write-page', withVault({
            path: toolArgs.path,
            content: toolArgs.content,
            commit_message: toolArgs.commit_message,
            pr_title: toolArgs.pr_title,
            pr_body: toolArgs.pr_body,
          }, toolArgs));
          break;
        case 'knowledge_create_edge':
          result = await callKnowledgeAPI('/graph/edges', {
            source_id: toolArgs.source_id,
            target_id: toolArgs.target_id,
            edge_type: toolArgs.edge_type,
            properties: toolArgs.properties ?? {},
          });
          break;
        case 'knowledge_get_edges':
          result = await callKnowledgeAPI('/graph/edges/get', {
            page_id: toolArgs.page_id,
            edge_type: toolArgs.edge_type,
          });
          break;
        case 'knowledge_delete_edge':
          result = await callKnowledgeAPI('/graph/edges/delete', {
            source_id: toolArgs.source_id,
            target_id: toolArgs.target_id,
            edge_type: toolArgs.edge_type,
          });
          break;
        case 'knowledge_traverse_graph':
          result = await callKnowledgeAPI('/graph/traverse', {
            start_page_id: toolArgs.start_page_id,
            edge_types: toolArgs.edge_types,
            max_depth: toolArgs.max_depth ?? 3,
          });
          break;
        case 'knowledge_export_graph':
          result = await callKnowledgeAPI('/graph/export', {});
          break;
        case 'knowledge_import_graph':
          result = await callKnowledgeAPI('/graph/import', {});
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${errorMessage}` }], isError: true };
    }
  });

  return server;
}

// ── Express router (mirrors forge-local-mcp.js session handling) ──────────────

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const sessions = new Map();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [sid, e] of sessions) {
    if (now - e.lastSeen > SESSION_TTL_MS) {
      sessions.delete(sid);
      console.log(`[vault-local-mcp] Session evicted (TTL): ${sid}`);
    }
  }
}, 60_000);
sweeper.unref();

export const vaultMcpRouter = Router();

// GET /health — vault bridge liveness (used by system-status)
vaultMcpRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'vault-local',
    embedded: true,
    control_plane: VAULT_REST_BASE,
  });
});

// ALL /mcp — Vault knowledge MCP StreamableHTTP endpoint
vaultMcpRouter.all('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    let transport;

    if (sessionId && !entry) {
      // Session ID provided but unknown (server restarted or session expired).
      // Recover transparently with a stateless transport.
      const server = buildServer();
      transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      transport.onclose = () => {
        sessions.delete(sessionId);
      };
      await server.connect(transport);
      entry = { transport, lastSeen: Date.now() };
      sessions.set(sessionId, entry);
    } else if (!entry) {
      // No session ID = new session request (initialize handshake).
      const server = buildServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, lastSeen: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };
      await server.connect(transport);
    } else {
      entry.lastSeen = Date.now();
      transport = entry.transport;
    }

    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[vault-local-mcp] Request handling failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  }
});
