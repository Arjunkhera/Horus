// MCP Server factory - creates and configures the Model Context Protocol server
// This extracts the server setup logic from the main entry point

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { handleCreateNote, type ToolContext } from '../tools/create-note.js';
import { handleGetNote } from '../tools/get-note.js';
import { handleUpdateNote } from '../tools/update-note.js';
import { handleSearch } from '../tools/search.js';
import { handleQueryView } from '../tools/query-view.js';
import { handleListTypes } from '../tools/list-types.js';
import { handleGetRelated } from '../tools/get-related.js';
import { handleSyncPull } from '../tools/sync-pull.js';
import { handleSyncPush } from '../tools/sync-push.js';
import { handleHorusSearch } from '../tools/horus-search.js';
import { handleDeleteNote } from '../tools/delete-note.js';
// V2 tool handlers
import { handleCreateEntity, type CreateEntityParams } from '../tools/create-entity.js';
import { handleUpdateEntity, type UpdateEntityInput } from '../tools/update-entity.js';
import { handleDeleteEntity, type DeleteEntityInput } from '../tools/delete-entity.js';
import { handleCreateEdge, type CreateEdgeParams } from '../tools/create-edge.js';
import { handleDeleteEdge, type DeleteEdgeParams } from '../tools/delete-edge.js';
import { handleGetEdges, type GetEdgesParams } from '../tools/get-edges.js';
import { handleCreateType, type CreateTypeInput } from '../tools/create-type.js';
import { handleUpdateType, type UpdateTypeInput } from '../tools/update-type.js';
import { handleExecuteView, type ExecuteViewInput } from '../tools/execute-view.js';
import { handleRecurrenceSweep } from '../tools/recurrence-sweep.js';
import {
  CreateNoteInputSchema,
  GetNoteInputSchema,
  UpdateNoteInputSchema,
  SearchInputSchema,
  QueryViewInputSchema,
  SyncPullInputSchema,
  SyncPushInputSchema,
  HorusSearchInputSchema,
  CreateNoteOutputSchema,
  UpdateNoteOutputSchema,
} from '../types/tools.js';
import { isAnvilError, makeError } from '../types/error.js';

/**
 * Create and configure the MCP server with all tool handlers
 */
export function createMcpServer(ctx: ToolContext): Server {
  // Create MCP server
  const server = new Server(
    {
      name: 'anvil',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define tool schemas
  const tools: Tool[] = [
    {
      name: 'anvil_create_note',
      description:
        'Create a new note in the vault with automatic ID, timestamps, and type validation. Accepts both "content" and "body" for the body text — "body" is an alias for "content".',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Note type ID (e.g., task, note, journal, story)',
          },
          title: {
            type: 'string',
            description: 'Note title (1-300 characters)',
          },
          content: {
            type: 'string',
            description: 'Optional markdown body content',
          },
          body: {
            type: 'string',
            description: 'Alias for content (matches the field name returned by anvil_get_note). If both body and content are provided, content wins.',
          },
          fields: {
            type: 'object',
            description: 'Type-specific frontmatter fields',
          },
          use_template: {
            type: 'boolean',
            description: 'Apply type template (default: true)',
            default: true,
          },
        },
        required: ['type', 'title'],
        additionalProperties: false,
      },
    },
    {
      name: 'anvil_get_note',
      description: 'Retrieve a note by ID with full metadata and body content',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'UUID of the note to retrieve',
          },
        },
        required: ['noteId'],
      },
    },
    {
      name: 'anvil_update_note',
      description: 'Update a note (PATCH semantics for fields, append or replace for body). Accepts both "content" and "body" for the body text — "body" is an alias for "content" (since anvil_get_note returns the field as "body").',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'UUID of the note to update',
          },
          fields: {
            type: 'object',
            description: 'Fields to update (omitted fields are preserved)',
          },
          content: {
            type: 'string',
            description: 'New body content (appends for journals, replaces otherwise)',
          },
          body: {
            type: 'string',
            description: 'Alias for content (anvil_get_note returns "body", so this is accepted for convenience). If both body and content are provided, content wins.',
          },
        },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
    {
      name: 'anvil_search',
      description:
        'Search notes by free-text query and/or structured filters. Supports text search, type filtering, tags (AND semantics), date ranges, and semantic (vector) search when HORUS_EMBEDDING_API_KEY is configured.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text search query. Omit entirely for unfiltered search — do not pass "*".',
          },
          semantic: {
            type: 'string',
            description: 'Natural language query for semantic (vector) search. Requires HORUS_EMBEDDING_API_KEY. Combine with query for hybrid FTS+vector search.',
          },
          type: {
            type: 'string',
            description: 'Filter by note type',
          },
          status: {
            type: 'string',
            description: 'Filter by status. Call anvil_list_types first — valid values vary by type.',
          },
          priority: {
            type: 'string',
            description: 'Filter by priority',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags (notes must have ALL specified tags)',
          },
          due: {
            type: 'object',
            properties: {
              gte: {
                type: 'string',
                description: 'Due date >= this ISO date',
              },
              lte: {
                type: 'string',
                description: 'Due date <= this ISO date',
              },
            },
            description: 'Due date range filter (ISO date strings)',
          },
          assignee: {
            type: 'string',
            description: 'Filter by assignee note ID',
          },
          project: {
            type: 'string',
            description: 'Filter by project note ID',
          },
          scope: {
            type: 'object',
            properties: {
              context: { type: 'string', enum: ['personal', 'work'] },
              team: { type: 'string' },
              service: { type: 'string' },
            },
            description: 'Filter by scope context',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max: 100)',
          },
          offset: {
            type: 'number',
            description: 'Result offset for pagination (default: 0)',
          },
        },
      },
    },
    {
      name: 'anvil_query_view',
      description: 'Query notes with filtering, sorting, and rendering options',
      inputSchema: {
        type: 'object',
        properties: {
          view: {
            type: 'string',
            enum: ['list', 'table', 'board'],
            description: 'View type to render (required)',
          },
          filters: {
            type: 'object',
            description: 'Query filter criteria',
            properties: {
              query: { type: 'string', description: 'Text search query' },
              type: { type: 'string', description: 'Filter by note type' },
              status: { type: 'string', description: 'Filter by status' },
              priority: { type: 'string', description: 'Filter by priority' },
              tags: { type: 'array', items: { type: 'string' }, description: 'AND-matched tags' },
              assignee: { type: 'string', description: 'Filter by assignee note ID' },
              project: { type: 'string', description: 'Filter by project note ID' },
            },
          },
          orderBy: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                description: 'Field to sort by (e.g., "modified", "title")',
              },
              direction: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Sort direction',
              },
            },
            description: 'Sort options (default: modified desc)',
          },
          columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Columns for table view',
          },
          groupBy: {
            type: 'string',
            description: 'Field to group by — required for board view',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 50, max: 100)',
          },
          offset: {
            type: 'number',
            description: 'Result offset for pagination (default: 0)',
          },
        },
        required: ['view'],
      },
    },
    {
      name: 'anvil_list_types',
      description: 'List all available note types in the vault',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'anvil_get_related',
      description:
        'Get forward and reverse relationships for a note (links and backlinks)',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'UUID of the note',
          },
        },
        required: ['noteId'],
      },
    },
    {
      name: 'anvil_sync_pull',
      description: 'Pull latest changes from the remote Git repository and re-index changed files',
      inputSchema: {
        type: 'object',
        properties: {
          remote: {
            type: 'string',
            description: 'Remote name (default: "origin")',
          },
          branch: {
            type: 'string',
            description: 'Branch to pull (default: current branch)',
          },
        },
      },
    },
    {
      name: 'anvil_sync_push',
      description: 'Stage vault changes, commit, and push to the remote Git repository',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Commit message',
          },
        },
        required: ['message'],
      },
    },
    {
      name: 'horus_search',
      description:
        'Search across all Horus systems (Anvil + Vault + Forge) via the shared Typesense index. Use this as the preferred tool for cross-system queries. Optionally scope to a single source.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text search query',
          },
          source: {
            type: 'string',
            enum: ['anvil', 'vault', 'forge'],
            description: 'Scope results to a single source system (omit for cross-system)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max: 100)',
          },
          offset: {
            type: 'number',
            description: 'Result offset for pagination (default: 0)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'anvil_delete_note',
      description:
        'Delete a note by ID. Removes the backing file and index entry. Use force=true to remove orphaned index entries whose backing file is already missing.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'UUID of the note to delete',
          },
          force: {
            type: 'boolean',
            description:
              'If true, removes the index entry even when the backing file is missing (default: false)',
          },
        },
        required: ['noteId'],
      },
    },
    // ── V2 Tools ──────────────────────────────────────────────────────────
    {
      name: 'anvil_create_entity',
      description:
        'Create a new entity through the V2 ingestion pipeline with automatic validation, persistence, graph sync, and indexing.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Entity type ID (e.g., task, note, story)',
          },
          title: {
            type: 'string',
            description: 'Entity title',
          },
          fields: {
            type: 'object',
            description: 'Type-specific frontmatter fields',
          },
          body: {
            type: 'string',
            description: 'Optional markdown body content',
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                targetId: { type: 'string', description: 'Target entity UUID' },
                intent: { type: 'string', description: 'Edge intent (relationship type)' },
                description: { type: 'string', description: 'Optional edge description' },
              },
              required: ['targetId', 'intent'],
            },
            description: 'Optional edges to create alongside the entity',
          },
          sourcePath: {
            type: 'string',
            description: 'Optional source file path for file-type entities',
          },
        },
        required: ['type', 'title'],
      },
    },
    {
      name: 'anvil_update_entity',
      description:
        'Update an entity with PATCH semantics through the V2 pipeline. Only provided fields are updated; edges are NOT modified via this tool.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'Entity UUID to update',
          },
          fields: {
            type: 'object',
            description: 'Fields to merge (omitted fields are preserved)',
          },
          content: {
            type: 'string',
            description: 'New body content (omit to keep existing)',
          },
        },
        required: ['noteId'],
      },
    },
    {
      name: 'anvil_delete_entity',
      description:
        'Delete an entity with cascade through the V2 pipeline. Removes index entry, Neo4j node + edges, storage record, and backing file.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'Entity UUID to delete',
          },
          force: {
            type: 'boolean',
            description:
              'If true, continues deletion even if the entity is not found (default: false)',
          },
        },
        required: ['noteId'],
      },
    },
    {
      name: 'anvil_create_edge',
      description:
        'Create a directed edge between two entities in the Neo4j graph. Validates the intent against the IntentRegistry.',
      inputSchema: {
        type: 'object',
        properties: {
          sourceId: {
            type: 'string',
            description: 'Source entity UUID',
          },
          targetId: {
            type: 'string',
            description: 'Target entity UUID',
          },
          intent: {
            type: 'string',
            description: 'Edge intent / relationship type (e.g., blocks, depends_on, parent_of)',
          },
          description: {
            type: 'string',
            description: 'Optional human-readable edge description',
          },
        },
        required: ['sourceId', 'targetId', 'intent'],
      },
    },
    {
      name: 'anvil_delete_edge',
      description:
        'Delete one or more edges between two entities. When intent is provided, only the matching edge is removed; when omitted, all edges between the pair are deleted.',
      inputSchema: {
        type: 'object',
        properties: {
          sourceId: {
            type: 'string',
            description: 'Source entity UUID',
          },
          targetId: {
            type: 'string',
            description: 'Target entity UUID',
          },
          intent: {
            type: 'string',
            description: 'Optional intent filter — omit to delete all edges between the pair',
          },
        },
        required: ['sourceId', 'targetId'],
      },
    },
    {
      name: 'anvil_get_edges',
      description:
        'Get all edges for an entity (both directions), optionally filtered by intent. Returns resolved edges with direction context and display labels.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: {
            type: 'string',
            description: 'Entity UUID to get edges for',
          },
          intent: {
            type: 'string',
            description: 'Optional intent filter',
          },
        },
        required: ['noteId'],
      },
    },
    {
      name: 'anvil_create_type',
      description:
        'Create a new custom entity type definition. Writes YAML to the vault\'s custom-types/ directory and reloads the type registry.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Type ID (lowercase letters, digits, hyphens, underscores; must start with a letter)',
          },
          name: {
            type: 'string',
            description: 'Human-readable type name',
          },
          description: {
            type: 'string',
            description: 'Optional type description',
          },
          icon: {
            type: 'string',
            description: 'Optional icon identifier',
          },
          extends: {
            type: 'string',
            description: 'Optional parent type ID to inherit fields from',
          },
          fields: {
            type: 'object',
            description: 'Field definitions for the type (keys are field names, values are field configs)',
          },
        },
        required: ['id', 'name', 'fields'],
      },
    },
    {
      name: 'anvil_update_type',
      description:
        'Add new fields to an existing custom type definition. Add-only: cannot modify existing fields or update built-in types.',
      inputSchema: {
        type: 'object',
        properties: {
          typeId: {
            type: 'string',
            description: 'Type ID to update',
          },
          fields: {
            type: 'object',
            description: 'New field definitions to add (keys are field names, values are field configs)',
          },
        },
        required: ['typeId', 'fields'],
      },
    },
    {
      name: 'anvil_execute_view',
      description:
        'Execute a saved view by reading its query definition and returning formatted results. Pass the view node ID to run its saved query.',
      inputSchema: {
        type: 'object',
        properties: {
          viewId: {
            type: 'string',
            description: 'UUID of the view node to execute',
          },
        },
        required: ['viewId'],
      },
    },
    {
      name: 'anvil_recurrence_sweep',
      description:
        'Run the recurrence sweep to generate next instances of completed recurring tasks. Pass a taskId to sweep a single task, or omit for a full catchup sweep.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Optional: UUID of a specific completed recurring task to sweep. If omitted, sweeps all eligible tasks.',
          },
        },
      },
    },
    {
      name: 'anvil_get_children',
      description:
        'Get direct children of an entity via the parent_of edge intent. Returns child nodes with metadata. Supports optional type and status filters.',
      inputSchema: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: 'UUID of the parent entity',
          },
          intent: {
            type: 'string',
            description: 'Edge intent to traverse (default: parent_of)',
          },
          type: {
            type: 'string',
            description: 'Filter children by type (e.g., "task")',
          },
          status: {
            type: 'string',
            description: 'Filter children by status (e.g., "open")',
          },
        },
        required: ['entityId'],
      },
    },
    {
      name: 'anvil_get_subtree',
      description:
        'Get the full subtree (recursive descendants) under an entity via the parent_of edge intent. Returns all descendants with depth information.',
      inputSchema: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: 'UUID of the root entity',
          },
          intent: {
            type: 'string',
            description: 'Edge intent to traverse (default: parent_of)',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum traversal depth (default: 10)',
          },
          type: {
            type: 'string',
            description: 'Filter descendants by type',
          },
        },
        required: ['entityId'],
      },
    },
  ];

  // Register ListTools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Register CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'anvil_create_note': {
          const input = CreateNoteInputSchema.parse(args);

          // V2 delegation: route through IngestPipeline when available
          if (ctx.storageBackend && ctx.edgeStore && ctx.intentRegistry) {
            const v2Result = await handleCreateEntity(
              {
                storageBackend: ctx.storageBackend,
                edgeStore: ctx.edgeStore,
                intentRegistry: ctx.intentRegistry,
                typeRegistry: ctx.registry,
                fileStore: ctx.fileStore,
              },
              {
                type: input.type,
                title: input.title,
                fields: { type: input.type, ...input.fields },
                body: input.content ?? '',
              },
            );
            if (isAnvilError(v2Result)) {
              return {
                content: [{ type: 'text', text: JSON.stringify(v2Result) }],
                isError: true,
              };
            }
            // Map V2 result to V1 shape: { noteId, filePath, title, type }
            const v1Compat = {
              noteId: v2Result.entityId,
              filePath: v2Result.filePath,
              title: v2Result.title,
              type: v2Result.type,
            };
            return {
              content: [{ type: 'text', text: JSON.stringify(v1Compat) }],
            };
          }

          // Fallback: V1 path
          const result = await handleCreateNote(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_get_note': {
          const input = GetNoteInputSchema.parse(args);
          const result = await handleGetNote(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_update_note': {
          const input = UpdateNoteInputSchema.parse(args);

          // V2 delegation: route through StorageBackend when available
          if (ctx.storageBackend) {
            const v2Result = await handleUpdateEntity(
              {
                noteId: input.noteId,
                fields: input.fields,
                content: input.content,
              },
              {
                storageBackend: ctx.storageBackend,
                edgeStore: ctx.edgeStore,
              },
            );
            if (isAnvilError(v2Result)) {
              return {
                content: [{ type: 'text', text: JSON.stringify(v2Result) }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(v2Result) }],
            };
          }

          // Fallback: V1 path
          const result = await handleUpdateNote(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_search': {
          const input = SearchInputSchema.parse(args);
          const result = await handleSearch(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_query_view': {
          const input = QueryViewInputSchema.parse(args);
          const result = await handleQueryView(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_list_types': {
          const result = handleListTypes(ctx);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_get_related': {
          const input = args as { noteId: string };

          // V2 delegation: use Neo4j edge store when available
          if (ctx.edgeStore && ctx.intentRegistry) {
            const v2Result = await handleGetEdges(
              { edgeStore: ctx.edgeStore, intentRegistry: ctx.intentRegistry },
              { noteId: input.noteId },
            );
            if (isAnvilError(v2Result)) {
              return {
                content: [{ type: 'text', text: JSON.stringify(v2Result) }],
                isError: true,
              };
            }
            // Map to V1-compatible shape with forward/reverse grouping
            const forward: Record<string, any[]> = {};
            const reverse: Record<string, any[]> = {};
            for (const edge of (v2Result as any).edges) {
              const bucket = edge.direction === 'outgoing' ? forward : reverse;
              const key = edge.displayLabel || edge.intent;
              if (!bucket[key]) bucket[key] = [];
              bucket[key].push({
                noteId: edge.direction === 'outgoing' ? edge.targetId : edge.sourceId,
                title: edge.targetTitle || '',
                type: edge.targetType,
                resolved: true,
              });
            }
            // Get the source note info for the response
            let title = '';
            let type = 'note';
            try {
              if (ctx.storageBackend) {
                const entity = await ctx.storageBackend.getEntity(input.noteId);
                title = entity.title;
                type = entity.type;
              }
            } catch {
              // Best effort — note may not exist in storage yet
            }
            const v1Compat = {
              noteId: input.noteId,
              title,
              type,
              forward,
              reverse,
            };
            return {
              content: [{ type: 'text', text: JSON.stringify(v1Compat) }],
            };
          }

          // Fallback: V1 path (frontmatter-based relationships)
          const result = handleGetRelated(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          };
        }

        case 'anvil_sync_pull': {
          const input = SyncPullInputSchema.parse(args);
          const result = await handleSyncPull(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_sync_push': {
          const input = SyncPushInputSchema.parse(args);
          const result = await handleSyncPush(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_delete_note': {
          const input = args as { noteId: string; force?: boolean };

          // V2 delegation: route through StorageBackend + cascade when available
          if (ctx.storageBackend) {
            const v2Result = await handleDeleteEntity(
              { noteId: input.noteId, force: input.force },
              {
                storageBackend: ctx.storageBackend,
                edgeStore: ctx.edgeStore,
                fileStore: ctx.fileStore,
              },
            );
            if (isAnvilError(v2Result)) {
              return {
                content: [{ type: 'text', text: JSON.stringify(v2Result) }],
                isError: true,
              };
            }
            // Map to V1 shape: { noteId, deleted }
            const v1Compat = {
              noteId: v2Result.noteId,
              deleted: v2Result.deleted,
            };
            return { content: [{ type: 'text', text: JSON.stringify(v1Compat) }] };
          }

          // Fallback: V1 path
          const result = await handleDeleteNote(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'horus_search': {
          const input = HorusSearchInputSchema.parse(args);
          const result = await handleHorusSearch(input, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        // ── V2 Tool Handlers ────────────────────────────────────────────

        case 'anvil_create_entity': {
          if (!ctx.storageBackend || !ctx.edgeStore || !ctx.intentRegistry) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 subsystem not initialized. Run with V2 bootstrap to use this tool.')) }],
              isError: true,
            };
          }
          const params = args as unknown as CreateEntityParams;
          const result = await handleCreateEntity(
            {
              storageBackend: ctx.storageBackend,
              edgeStore: ctx.edgeStore,
              intentRegistry: ctx.intentRegistry,
              typeRegistry: ctx.registry,
              fileStore: ctx.fileStore,
            },
            params,
          );
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_update_entity': {
          if (!ctx.storageBackend) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 subsystem not initialized. Run with V2 bootstrap to use this tool.')) }],
              isError: true,
            };
          }
          const input = args as unknown as UpdateEntityInput;
          const result = await handleUpdateEntity(input, {
            storageBackend: ctx.storageBackend,
            edgeStore: ctx.edgeStore,
          });
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_delete_entity': {
          if (!ctx.storageBackend) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 subsystem not initialized. Run with V2 bootstrap to use this tool.')) }],
              isError: true,
            };
          }
          const input = args as unknown as DeleteEntityInput;
          const result = await handleDeleteEntity(input, {
            storageBackend: ctx.storageBackend,
            edgeStore: ctx.edgeStore,
            fileStore: ctx.fileStore,
          });
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_create_edge': {
          if (!ctx.edgeStore || !ctx.intentRegistry) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 subsystem not initialized. Run with V2 bootstrap to use this tool.')) }],
              isError: true,
            };
          }
          const params = args as unknown as CreateEdgeParams;
          const result = await handleCreateEdge(
            { edgeStore: ctx.edgeStore, intentRegistry: ctx.intentRegistry },
            params,
          );
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_delete_edge': {
          if (!ctx.edgeStore || !ctx.intentRegistry) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 subsystem not initialized. Run with V2 bootstrap to use this tool.')) }],
              isError: true,
            };
          }
          const params = args as unknown as DeleteEdgeParams;
          const result = await handleDeleteEdge(
            { edgeStore: ctx.edgeStore, intentRegistry: ctx.intentRegistry },
            params,
          );
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_get_edges': {
          if (!ctx.edgeStore || !ctx.intentRegistry) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 subsystem not initialized. Run with V2 bootstrap to use this tool.')) }],
              isError: true,
            };
          }
          const params = args as unknown as GetEdgesParams;
          const result = await handleGetEdges(
            { edgeStore: ctx.edgeStore, intentRegistry: ctx.intentRegistry },
            params,
          );
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_create_type': {
          const params = args as CreateTypeInput;
          const result = await handleCreateType(params, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_update_type': {
          const params = args as UpdateTypeInput;
          const result = await handleUpdateType(params, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_execute_view': {
          const params = args as unknown as ExecuteViewInput;
          const result = await handleExecuteView(params, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_recurrence_sweep': {
          const params = args as { taskId?: string };
          const result = await handleRecurrenceSweep(params, ctx);
          if (isAnvilError(result)) {
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'anvil_get_children': {
          if (!ctx.edgeStore) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 graph subsystem not available — Neo4j required')) }],
              isError: true,
            };
          }
          const params = args as { entityId: string; intent?: string; type?: string; status?: string };
          const children = await ctx.edgeStore.getChildren(params.entityId, {
            intent: params.intent,
            type: params.type,
            status: params.status,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ entityId: params.entityId, children, total: children.length }) }] };
        }

        case 'anvil_get_subtree': {
          if (!ctx.edgeStore) {
            return {
              content: [{ type: 'text', text: JSON.stringify(makeError('SERVER_ERROR', 'V2 graph subsystem not available — Neo4j required')) }],
              isError: true,
            };
          }
          const params = args as { entityId: string; intent?: string; maxDepth?: number; type?: string };
          const descendants = await ctx.edgeStore.getSubtree(params.entityId, {
            intent: params.intent,
            maxDepth: params.maxDepth,
            type: params.type,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ entityId: params.entityId, descendants, total: descendants.length }) }] };
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  makeError('SERVER_ERROR', `Unknown tool: ${name}`)
                ),
              },
            ],
            isError: true,
          };
      }
    } catch (err) {
      const error =
        err instanceof Error ? err.message : `${typeof err}: ${String(err)}`;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              makeError('SERVER_ERROR', `Tool call failed: ${error}`)
            ),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
