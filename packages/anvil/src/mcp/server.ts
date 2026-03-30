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
        'Create a new note in the vault with automatic ID, timestamps, and type validation',
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
      description: 'Update a note (PATCH semantics for fields, append or replace for body)',
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
        },
        required: ['noteId'],
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
