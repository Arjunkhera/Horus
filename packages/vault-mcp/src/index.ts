#!/usr/bin/env node

/**
 * Vault Knowledge Service MCP Thin Client
 *
 * A Model Context Protocol (MCP) server that provides a thin client interface
 * to the Vault Knowledge Service REST API. Translates MCP tool calls into HTTP requests.
 *
 * Supports two transports:
 *   stdio (default) — for local use / Claude Desktop / Cursor IDE
 *   http            — for Docker deployment (--http --port 8300)
 */

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let endpoint = "http://localhost:8000";
let useHttp = false;
let httpPort = 8300;
let httpHost = "0.0.0.0";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--endpoint" && args[i + 1]) {
    endpoint = args[i + 1];
    i++;
  } else if (args[i] === "--http") {
    useHttp = true;
  } else if (args[i] === "--port" && args[i + 1]) {
    httpPort = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--host" && args[i + 1]) {
    httpHost = args[i + 1];
    i++;
  }
}

// Environment variable overrides (Docker-friendly: env > CLI for endpoint)
endpoint = process.env.KNOWLEDGE_SERVICE_URL ?? endpoint;
if (process.env.VAULT_MCP_HTTP === "true") useHttp = true;
if (process.env.VAULT_MCP_PORT) httpPort = parseInt(process.env.VAULT_MCP_PORT, 10);
if (process.env.VAULT_MCP_HOST) httpHost = process.env.VAULT_MCP_HOST;

// Remove trailing slash
endpoint = endpoint.replace(/\/$/, "");

// ── REST helpers ──────────────────────────────────────────────────────────────

function log(level: string, message: string, extra?: Record<string, unknown>) {
  const entry = { level, message, timestamp: new Date().toISOString(), ...extra };
  process.stderr.write(JSON.stringify(entry) + "\n");
}

async function callKnowledgeAPI(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }
  return response.json();
}

async function callKnowledgeAPIGet(path: string): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }
  return response.json();
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "knowledge_resolve_context",
    description:
      "Resolve the scope for a repository and return all applicable operational pages. " +
      "This is the primary entry point for getting context about a codebase — it finds the " +
      "repo-profile page, resolves which program the repo belongs to, and returns procedures, " +
      "guides, and conventions that apply at the repo and program level.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name (e.g., 'anvil', 'forge', 'vault')" },
        include_full: {
          type: "boolean",
          description: "If true, return full page content. If false (default), return summaries only.",
          default: false,
        },
        mode: {
          type: "string",
          enum: ["search", "exact"],
          description:
            "Resolution mode. 'search' (default): relevance-ranked Typesense query — use when the exact scope.repo is not known (e.g. sub-service names). 'exact': scope.repo exact match — use only when the canonical repo name is known with certainty.",
          default: "search",
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "knowledge_search",
    description:
      "Search the knowledge base using hybrid search (keyword + semantic + reranking). " +
      "Returns page summaries with relevance scores. Use this for exploratory queries or " +
      "when you don't know the exact page you're looking for.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (natural language or keywords)" },
        mode: {
          type: "string",
          enum: ["reference", "operational", "keystone"],
          description: "Filter by page mode",
        },
        type: {
          type: "string",
          enum: ["repo-profile", "guide", "concept", "procedure", "keystone", "learning"],
          description: "Filter by page type",
        },
        scope: {
          type: "object",
          properties: {
            program: { type: "string", description: "Program identifier" },
            repo: { type: "string", description: "Repository name" },
          },
          description: "Filter by scope (AND logic)",
        },
        limit: { type: "number", description: "Maximum results (default: 10)", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "knowledge_get_page",
    description:
      "Retrieve the full content of a specific knowledge page by its ID (file path). " +
      "Use this after finding a relevant page via search or resolve-context.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Page identifier (e.g., 'repos/anvil.md')" },
      },
      required: ["id"],
    },
  },
  {
    name: "knowledge_get_related",
    description:
      "Follow links from a knowledge page to find related pages. Traverses 'related', " +
      "'depends-on', 'consumed-by', and 'applies-to' relationship fields.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Source page identifier" },
      },
      required: ["id"],
    },
  },
  {
    name: "knowledge_list_by_scope",
    description:
      "List and filter knowledge pages by scope and other criteria. " +
      "Use this to browse pages for a specific program or repo.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "object",
          properties: {
            program: { type: "string" },
            repo: { type: "string" },
          },
          description: "Scope filter (at least one field required)",
        },
        mode: { type: "string", enum: ["reference", "operational", "keystone"] },
        type: {
          type: "string",
          enum: ["repo-profile", "guide", "concept", "procedure", "keystone", "learning"],
        },
        tags: { type: "array", items: { type: "string" }, description: "AND logic" },
        limit: { type: "number", default: 50 },
      },
      required: ["scope"],
    },
  },
  {
    name: "knowledge_validate_page",
    description:
      "Validate a knowledge page against the schema and registries. Returns structured " +
      "errors with fuzzy-match suggestions. Use before committing a page.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Full markdown with YAML frontmatter" },
      },
      required: ["content"],
    },
  },
  {
    name: "knowledge_suggest_metadata",
    description:
      "Suggest frontmatter metadata for a knowledge page. Analyses content and returns " +
      "per-field suggestions with confidence levels.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Full markdown — may have partial frontmatter" },
        hints: { type: "object", description: "Optional partial knowledge to improve suggestions" },
      },
      required: ["content"],
    },
  },
  {
    name: "knowledge_check_duplicates",
    description:
      "Check candidate page content against existing KB pages for overlap. " +
      "Score >= threshold means novel (create). Below threshold means overlap (merge).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Proposed page title" },
        content: { type: "string", description: "Page body content" },
        threshold: { type: "number", description: "Similarity threshold 0-1 (default: 0.75)", default: 0.75 },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "knowledge_get_schema",
    description:
      "Retrieve the full schema definition and all registry contents (tags, repos, programs). " +
      "Use this to understand available page types and valid values before generating pages.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "knowledge_registry_add",
    description:
      "Add a new entry to a registry (tags, repos, or programs). Use when validation " +
      "rejects a value that should be added rather than corrected. Set via_pr=true to " +
      "write the updated registry to a git branch and open a PR instead of editing in-place.",
    inputSchema: {
      type: "object",
      properties: {
        registry: { type: "string", enum: ["tags", "repos", "programs"] },
        entry: {
          type: "object",
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
            scope_program: { type: "string" },
          },
          required: ["id"],
        },
        via_pr: {
          type: "boolean",
          description: "If true, write the updated registry to a git branch and open a GitHub PR. Requires GitHub token and repo to be configured.",
        },
      },
      required: ["registry", "entry"],
    },
  },
  {
    name: "knowledge_write_page",
    description:
      "Write a validated knowledge page to the knowledge-base repo, commit it to a new branch, " +
      "and open a GitHub PR for human review. Returns the PR URL.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative page path, e.g. 'repos/anvil.md'" },
        content: { type: "string", description: "Full markdown content with YAML frontmatter" },
        commit_message: { type: "string", description: "Git commit message (optional)" },
        pr_title: { type: "string", description: "GitHub PR title (optional)" },
        pr_body: { type: "string", description: "GitHub PR description body (optional)" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "knowledge_create_edge",
    description:
      "Create a directed edge between two knowledge pages in the Neo4j graph. " +
      "Nodes are created automatically if they do not exist (MERGE semantics). " +
      "Use this to model relationships such as DEPENDS_ON, PART_OF, SENDS_TO, DOCS, or RELATED.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Page ID of the source node (e.g. file path)" },
        target_id: { type: "string", description: "Page ID of the target node" },
        edge_type: {
          type: "string",
          enum: ["PART_OF", "DEPENDS_ON", "SENDS_TO", "DOCS", "RELATED"],
          description: "Type of relationship between the two pages",
        },
        properties: {
          type: "object",
          properties: {
            mechanism: { type: "string", description: "Optional: e.g. queue name, npm package" },
            role: { type: "string", description: "Optional: e.g. producer, consumer" },
          },
          description: "Optional edge metadata",
        },
      },
      required: ["source_id", "target_id", "edge_type"],
    },
  },
  {
    name: "knowledge_get_edges",
    description:
      "Get all edges for a knowledge page in the Neo4j graph. " +
      "Returns edges in both directions (outgoing and incoming). " +
      "Optionally filter by edge type.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Page ID to retrieve edges for" },
        edge_type: {
          type: "string",
          enum: ["PART_OF", "DEPENDS_ON", "SENDS_TO", "DOCS", "RELATED"],
          description: "Optional: filter results to this edge type only",
        },
      },
      required: ["page_id"],
    },
  },
  {
    name: "knowledge_delete_edge",
    description:
      "Delete a specific directed edge between two knowledge pages in the Neo4j graph. " +
      "The source and target page nodes are preserved; only the relationship is removed.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Page ID of the source node" },
        target_id: { type: "string", description: "Page ID of the target node" },
        edge_type: {
          type: "string",
          enum: ["PART_OF", "DEPENDS_ON", "SENDS_TO", "DOCS", "RELATED"],
          description: "Type of the edge to delete",
        },
      },
      required: ["source_id", "target_id", "edge_type"],
    },
  },
  {
    name: "knowledge_traverse_graph",
    description:
      "Traverse the knowledge graph from a starting page up to a configurable depth. " +
      "Returns all reachable pages within the depth limit. " +
      "Optionally filter traversal to specific edge types.",
    inputSchema: {
      type: "object",
      properties: {
        start_page_id: { type: "string", description: "Page ID to start traversal from" },
        edge_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["PART_OF", "DEPENDS_ON", "SENDS_TO", "DOCS", "RELATED"],
          },
          description: "Optional: restrict traversal to these edge types only",
        },
        max_depth: {
          type: "number",
          description: "Maximum number of hops to traverse (1–10, default: 3)",
          default: 3,
        },
      },
      required: ["start_page_id"],
    },
  },
  {
    name: "knowledge_export_graph",
    description:
      "Export the Neo4j knowledge graph (all nodes and edges) to a JSON file in the " +
      "knowledge-base repo (_graph/edges.json). Enables git-backed cloud sync and " +
      "bootstrapping of new instances. Returns export stats (node count, edge count, file path). " +
      "Returns an error if the graph client is unavailable.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "knowledge_import_graph",
    description:
      "Import/seed Neo4j from the graph export file in the knowledge-base repo " +
      "(_graph/edges.json). Idempotent — uses MERGE so it is safe to call multiple times. " +
      "Returns import stats. If the export file does not exist, returns skipped: true " +
      "with zero counts. Returns an error if the graph client is unavailable.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Server factory ────────────────────────────────────────────────────────────

/**
 * Build and configure an MCP Server instance with all tool handlers.
 * Called once for stdio, or once per MCP session in HTTP mode.
 */
function buildServer(): Server {
  const server = new Server(
    { name: "@vault/knowledge-mcp", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    if (!toolArgs) throw new Error("Missing arguments");

    try {
      let result: unknown;

      switch (name) {
        case "knowledge_resolve_context":
          result = await callKnowledgeAPI("/resolve-context", {
            repo: toolArgs.repo,
            include_full: toolArgs.include_full ?? false,
            mode: toolArgs.mode ?? "search",
          });
          break;
        case "knowledge_search":
          result = await callKnowledgeAPI("/search", {
            query: toolArgs.query,
            mode: toolArgs.mode,
            type: toolArgs.type,
            scope: toolArgs.scope,
            limit: toolArgs.limit ?? 10,
          });
          break;
        case "knowledge_get_page":
          result = await callKnowledgeAPI("/get-page", { id: toolArgs.id });
          break;
        case "knowledge_get_related":
          result = await callKnowledgeAPI("/get-related", { id: toolArgs.id });
          break;
        case "knowledge_list_by_scope":
          result = await callKnowledgeAPI("/list-by-scope", {
            scope: toolArgs.scope,
            mode: toolArgs.mode,
            type: toolArgs.type,
            tags: toolArgs.tags,
            limit: toolArgs.limit ?? 50,
          });
          break;
        case "knowledge_validate_page":
          result = await callKnowledgeAPI("/validate-page", { content: toolArgs.content });
          break;
        case "knowledge_suggest_metadata":
          result = await callKnowledgeAPI("/suggest-metadata", {
            content: toolArgs.content,
            hints: toolArgs.hints,
          });
          break;
        case "knowledge_check_duplicates":
          result = await callKnowledgeAPI("/check-duplicates", {
            title: toolArgs.title,
            content: toolArgs.content,
            threshold: toolArgs.threshold ?? 0.75,
          });
          break;
        case "knowledge_get_schema":
          result = await callKnowledgeAPI("/schema", {});
          break;
        case "knowledge_registry_add":
          result = await callKnowledgeAPI("/registry/add", {
            registry: toolArgs.registry,
            entry: toolArgs.entry,
            via_pr: toolArgs.via_pr ?? false,
          });
          break;
        case "knowledge_write_page":
          result = await callKnowledgeAPI("/write-page", {
            path: toolArgs.path,
            content: toolArgs.content,
            commit_message: toolArgs.commit_message,
            pr_title: toolArgs.pr_title,
            pr_body: toolArgs.pr_body,
          });
          break;
        case "knowledge_create_edge":
          result = await callKnowledgeAPI("/graph/edges", {
            source_id: toolArgs.source_id,
            target_id: toolArgs.target_id,
            edge_type: toolArgs.edge_type,
            properties: toolArgs.properties ?? {},
          });
          break;
        case "knowledge_get_edges":
          result = await callKnowledgeAPI("/graph/edges/get", {
            page_id: toolArgs.page_id,
            edge_type: toolArgs.edge_type,
          });
          break;
        case "knowledge_delete_edge":
          result = await callKnowledgeAPI("/graph/edges/delete", {
            source_id: toolArgs.source_id,
            target_id: toolArgs.target_id,
            edge_type: toolArgs.edge_type,
          });
          break;
        case "knowledge_traverse_graph":
          result = await callKnowledgeAPI("/graph/traverse", {
            start_page_id: toolArgs.start_page_id,
            edge_types: toolArgs.edge_types,
            max_depth: toolArgs.max_depth ?? 3,
          });
          break;
        case "knowledge_export_graph":
          result = await callKnowledgeAPI("/graph/export", {});
          break;
        case "knowledge_import_graph":
          result = await callKnowledgeAPI("/graph/import", {});
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ── Transports ────────────────────────────────────────────────────────────────

async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP wire protocol in stdio mode
  process.stderr.write(JSON.stringify({
    level: "info",
    message: "Vault Knowledge MCP server started (stdio)",
    endpoint,
    timestamp: new Date().toISOString(),
  }) + "\n");
}

async function startHttp(port: number, host: string): Promise<void> {
  const startTime = Date.now();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "vault-mcp",
        version: "0.2.0",
        uptime_seconds: uptime,
        knowledge_service_url: endpoint,
      }));
      return;
    }

    // MCP protocol — per-session routing
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport && sessionId) {
        // Session ID provided but not in map — server restarted or session expired.
        // Recover transparently: create a stateless transport (no sessionIdGenerator)
        // which bypasses the SDK's session validation and init enforcement.
        const server = buildServer();
        transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
        transport.onclose = () => {
          sessions.delete(sessionId);
          log("info", "MCP session closed (recovered)", { sessionId });
        };
        await server.connect(transport);
        sessions.set(sessionId, transport);
        log("info", "MCP session recovered (transparent reinit)", { sessionId });
      } else if (!transport) {
        // No session ID = new session request (initialize handshake).
        const server = buildServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport!);
            log("info", "MCP session initialized", { sessionId: sid });
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) {
            sessions.delete(transport!.sessionId);
            log("info", "MCP session closed", { sessionId: transport!.sessionId });
          }
        };
        await server.connect(transport);
      }

      await transport.handleRequest(req, res);
    } catch (error) {
      log("error", "HTTP request handling failed", {
        path: req.url,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log("info", `Received ${signal}, shutting down gracefully...`);
    httpServer.close(() => {
      log("info", "HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      log("warn", "Forcing shutdown after timeout");
      process.exit(1);
    }, 5000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      log("info", "Vault Knowledge MCP HTTP server started", {
        host,
        port,
        url: `http://${host}:${port}`,
        knowledge_service_url: endpoint,
      });
      resolve();
    });
    httpServer.on("error", (error) => {
      log("error", "HTTP server error", {
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error);
    });
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (useHttp) {
  startHttp(httpPort, httpHost).catch((error) => {
    log("error", "Fatal error starting HTTP server", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
} else {
  startStdio().catch((error) => {
    process.stderr.write(`Fatal error: ${error}\n`);
    process.exit(1);
  });
}
