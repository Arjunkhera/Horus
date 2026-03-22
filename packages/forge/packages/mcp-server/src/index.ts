import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { ForgeCore, type RepoIndexEntry, type AutoDetectedWorkflow, type SessionListOptions, type SessionCleanupOptions } from '@forge/core';
import * as http from 'node:http';

const startTime = Date.now();

// ─── JSON logging ──────────────────────────────────────────────────────────

function log(level: string, message: string, extra?: Record<string, unknown>) {
  const entry = { level, message, timestamp: new Date().toISOString(), ...extra };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'forge_search',
    description:
      'Search the Forge registry for skills, agents, or plugins. Use this to discover what artifacts are available before installing them.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "developer", "testing")' },
        type: {
          type: 'string',
          enum: ['skill', 'agent', 'plugin'],
          description: 'Filter by artifact type (optional)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'forge_add',
    description:
      'Add one or more artifact refs to forge.yaml. Use after searching to add an artifact to the workspace configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Artifact refs to add, e.g., ["skill:developer@1.0.0", "agent:sdlc-agent"]',
        },
      },
      required: ['refs'],
    },
  },
  {
    name: 'forge_install',
    description:
      'Run the full install pipeline: resolve all artifacts from forge.yaml and emit them to the workspace. Call this after forge_add.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'plugin'],
          description: 'Compile target (default: claude-code)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview changes without writing files',
        },
      },
    },
  },
  {
    name: 'forge_resolve',
    description:
      'Resolve a single artifact reference and return its metadata and dependencies. Useful for inspecting an artifact before installing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ref: {
          type: 'string',
          description: 'Artifact ref, e.g., "skill:developer@1.0.0"',
        },
      },
      required: ['ref'],
    },
  },
  {
    name: 'forge_list',
    description:
      'List artifacts. Use scope="installed" to see what\'s currently installed, or scope="available" to see what\'s in the registry.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: {
          type: 'string',
          enum: ['installed', 'available'],
          description: 'Which artifacts to list',
        },
      },
    },
  },
  {
    name: 'forge_repo_list',
    description:
      'List repositories from the local index. Filter by query (name, path, or URL) and/or language. Automatically scans if no index exists.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query to filter repositories (optional)',
        },
        language: {
          type: 'string',
          description: 'Filter by programming language (optional)',
        },
      },
    },
  },
  {
    name: 'forge_repo_resolve',
    description:
      'Find a specific repository by name or remote URL. Automatically scans if no index exists.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Repository name to search for (optional)',
        },
        remoteUrl: {
          type: 'string',
          description: 'Remote URL (https or git@) to match against (optional)',
        },
      },
    },
  },
  {
    name: 'forge_repo_workflow',
    description:
      'Resolve the git workflow configuration for a repository. Resolution order: (1) confirmed workflow in repo index, (2) Vault repo profile, (3) auto-detect from git remotes. When needsConfirmation=true is returned, present autoDetected values to the user, then call again with the confirmed workflow parameter to save. Returns strategy (owner|fork|contributor), default branch, PR target, and hosting info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Repository name to resolve workflow for',
        },
        workflow: {
          type: 'object',
          description: 'Confirmed workflow to save (only pass when user has confirmed the auto-detected values). Omit on first call.',
          properties: {
            type: {
              type: 'string',
              enum: ['owner', 'fork', 'contributor'],
              description: 'Workflow type: owner=full access, fork=PR from fork, contributor=PR from branch',
            },
            upstream: { type: 'string', description: 'Upstream remote URL (fork workflow only)' },
            fork: { type: 'string', description: 'Fork remote URL (fork workflow only)' },
            pushTo: { type: 'string', description: 'Remote to push to (usually "origin")' },
            prTarget: {
              type: 'object',
              properties: {
                repo: { type: 'string', description: 'Target repo slug, e.g. "Org/Repo"' },
                branch: { type: 'string', description: 'Target branch, e.g. "main"' },
              },
              required: ['repo', 'branch'],
            },
            branchPattern: { type: 'string', description: 'Branch naming convention, e.g. "{type}/{id}-{slug}"' },
            commitFormat: { type: 'string', description: 'Commit message format, e.g. "conventional"' },
            confirmedBy: {
              type: 'string',
              enum: ['user', 'auto'],
              description: '"user" if user explicitly confirmed, "auto" if agent accepted without edits',
            },
            remotesSnapshot: {
              type: 'object',
              description: 'Current remote name→URL map (pass through from autoDetected.remotesSnapshot)',
            },
          },
          required: ['type', 'pushTo', 'prTarget'],
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'forge_develop',
    description:
      'Start or resume a code session for a work item on a repository. Creates a git worktree at ~/Horus/data/sessions/<workItem>-<slug>/. ' +
      'Implements 3-tier repo resolution: (1) local repo index, (2) managed pool, (3) error with guidance. ' +
      'Returns "needs_workflow_confirmation" when the repo has no saved workflow configuration — call again with the workflow parameter to confirm. ' +
      'If a session already exists for this workItem+repo it is resumed. A second concurrent agent gets a separate slot ("-2" suffix).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name (from forge_repo_list)',
        },
        workItem: {
          type: 'string',
          description: 'Work item ID or slug — used to namespace the session path and for resumption',
        },
        branch: {
          type: 'string',
          description: 'Feature branch name (optional — auto-generated from workItem if omitted)',
        },
        workflow: {
          type: 'object',
          description: 'Workflow configuration (required on first call for repos without saved workflow, or to override saved workflow)',
          properties: {
            type: {
              type: 'string',
              enum: ['owner', 'fork', 'contributor'],
              description: 'owner = push directly to repo; fork = PR from fork; contributor = PR from branch',
            },
            upstream: { type: 'string', description: 'Upstream remote URL (fork workflow only)' },
            fork: { type: 'string', description: 'Fork remote URL (fork workflow only)' },
            pushTo: { type: 'string', description: 'Remote to push feature branches to (e.g. "origin")' },
            prTarget: {
              type: 'object',
              description: 'Where to target pull requests',
              properties: {
                repo: { type: 'string', description: 'Target repo slug, e.g. "MyOrg/MyProject"' },
                branch: { type: 'string', description: 'Target branch, e.g. "main"' },
              },
              required: ['repo', 'branch'],
            },
            branchPattern: { type: 'string', description: 'Branch naming pattern, e.g. "{type}/{id}-{slug}"' },
            commitFormat: { type: 'string', description: 'Commit message format, e.g. "conventional"' },
          },
          required: ['type', 'pushTo', 'prTarget'],
        },
      },
      required: ['repo', 'workItem'],
    },
  },
  {
    name: 'forge_workspace_create',
    description: 'Create a new workspace from a workspace config. Installs plugins/skills, emits MCP configs and environment variables. Context-only — does not clone repositories. Use forge_develop to create isolated code sessions for implementation work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        config: { type: 'string', description: 'Workspace config artifact name (e.g., "sdlc-default")' },
        configVersion: { type: 'string', description: 'Version constraint (default: latest)' },
        storyId: { type: 'string', description: 'Anvil work item ID to link to this workspace' },
        storyTitle: { type: 'string', description: 'Cached story title for display' },
        repos: { type: 'array', items: { type: 'string' }, description: 'Specific repo names to include' },
      },
      required: ['config'],
    },
  },
  {
    name: 'forge_workspace_list',
    description: 'List tracked workspaces with optional status or story filter.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'completed', 'archived'], description: 'Filter by workspace status' },
        storyId: { type: 'string', description: 'Filter by linked story ID' },
      },
    },
  },
  {
    name: 'forge_workspace_delete',
    description: 'Delete a workspace by ID. Removes workspace folder from disk.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Workspace ID (e.g., "ws-abc12345")' },
        force: { type: 'boolean', description: 'Force delete even if uncommitted changes exist' },
      },
      required: ['id'],
    },
  },
  {
    name: 'forge_workspace_status',
    description: 'Get full details for a single workspace by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Workspace ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'forge_session_list',
    description:
      'List active code sessions (git worktrees created by forge_develop). ' +
      'Returns all sessions with metadata including sessionPath, repo, workItem, branch, and timestamps. ' +
      'Optionally filter by repo name or workItem ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'Filter to sessions for a specific repository name (optional)',
        },
        workItem: {
          type: 'string',
          description: 'Filter to sessions for a specific work item ID (optional)',
        },
      },
    },
  },
  {
    name: 'forge_session_cleanup',
    description:
      'Clean up stale code sessions (git worktrees). ' +
      'Runs git worktree remove + prune, removes the session directory, and removes the session record. ' +
      'Specify at least one of: workItem (clean a specific session), olderThan (clean sessions older than threshold), ' +
      'or auto (query Anvil for work item status and clean eligible sessions).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workItem: {
          type: 'string',
          description: 'Work item ID — clean all sessions associated with this work item',
        },
        olderThan: {
          type: 'string',
          description: 'Age threshold — clean sessions older than this value. Format: <number><d|h|m>, e.g. "30d", "12h", "60m"',
        },
        auto: {
          type: 'boolean',
          description:
            'Auto-cleanup mode: query Anvil for work item status of each session. ' +
            'Cleans: done (7+ days ago) and cancelled. Skips: in_progress, in_review, not found.',
        },
      },
    },
  },
];

// ─── Tool handler ──────────────────────────────────────────────────────────

function buildServer(workspaceRoot: string): Server {
  const forge = new ForgeCore(workspaceRoot);

  const server = new Server(
    { name: 'forge-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (_req: ListToolsRequest) => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'forge_search': {
          const { query, type } = args as { query: string; type?: 'skill' | 'agent' | 'plugin' };
          const results = await forge.search(query, type);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(results.map(r => ({
                type: r.ref.type,
                id: r.ref.id,
                version: r.ref.version,
                name: r.meta.name,
                description: r.meta.description,
                tags: r.meta.tags,
                score: r.score,
                matchedOn: r.matchedOn,
              })), null, 2),
            }],
          };
        }

        case 'forge_add': {
          const { refs } = args as { refs: string[] };
          const config = await forge.add(refs);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                added: refs,
                config: {
                  skills: Object.keys(config.artifacts.skills),
                  agents: Object.keys(config.artifacts.agents),
                  plugins: Object.keys(config.artifacts.plugins),
                },
              }, null, 2),
            }],
          };
        }

        case 'forge_install': {
          const { target, dryRun } = (args ?? {}) as { target?: string; dryRun?: boolean };
          const report = await forge.install({ target: target as any, dryRun });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                installed: report.installed.map(r => `${r.type}:${r.id}@${r.version}`),
                filesWritten: report.filesWritten,
                conflicts: report.conflicts.length,
                duration: `${report.duration}ms`,
                dryRun: dryRun ?? false,
              }, null, 2),
            }],
          };
        }

        case 'forge_resolve': {
          const { ref } = args as { ref: string };
          const resolved = await forge.resolve(ref);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                type: resolved.ref.type,
                id: resolved.ref.id,
                version: resolved.bundle.meta.version,
                name: resolved.bundle.meta.name,
                description: resolved.bundle.meta.description,
                dependencies: resolved.dependencies.map(d => `${d.ref.type}:${d.ref.id}`),
              }, null, 2),
            }],
          };
        }

        case 'forge_list': {
          const { scope } = (args ?? {}) as { scope?: 'installed' | 'available' };
          const summaries = await forge.list(scope ?? 'available');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(summaries.map(s => ({
                type: s.ref.type,
                id: s.ref.id,
                version: s.ref.version,
                name: s.name,
                description: s.description,
                tags: s.tags,
              })), null, 2),
            }],
          };
        }

        case 'forge_repo_list': {
          const { query, language } = (args ?? {}) as { query?: string; language?: string };
          let repos = await forge.repoList(query);
          if (language) {
            repos = repos.filter((r: RepoIndexEntry) => r.language?.toLowerCase() === language.toLowerCase());
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(repos.map(r => ({
                name: r.name,
                localPath: r.localPath,
                remoteUrl: r.remoteUrl,
                defaultBranch: r.defaultBranch,
                language: r.language,
                framework: r.framework,
                lastCommitDate: r.lastCommitDate,
                lastScannedAt: r.lastScannedAt,
              })), null, 2),
            }],
          };
        }

        case 'forge_repo_resolve': {
          const { name, remoteUrl } = (args ?? {}) as { name?: string; remoteUrl?: string };
          if (!name && !remoteUrl) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'Either name or remoteUrl must be provided' }) }],
              isError: true,
            };
          }
          const entry = await forge.repoResolve({ name, remoteUrl });
          if (!entry) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: true, code: 'REPO_NOT_FOUND', message: 'Repository not found', suggestion: 'Run: forge repo scan' }) }],
              isError: true,
            };
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: entry.name,
                localPath: entry.localPath,
                remoteUrl: entry.remoteUrl,
                defaultBranch: entry.defaultBranch,
                language: entry.language,
                framework: entry.framework,
                lastCommitDate: entry.lastCommitDate,
                lastScannedAt: entry.lastScannedAt,
              }, null, 2),
            }],
          };
        }

        case 'forge_repo_workflow': {
          const { name, workflow: confirmedWorkflow } = (args ?? {}) as {
            name: string;
            workflow?: (Omit<AutoDetectedWorkflow, 'remotesSnapshot'> & {
              confirmedBy?: 'user' | 'auto';
              remotesSnapshot?: Record<string, string>;
            });
          };
          if (!name) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'name is required' }) }],
              isError: true,
            };
          }

          // If a confirmed workflow was passed, save it and return the saved result
          if (confirmedWorkflow) {
            const saved = await forge.repoWorkflowSave(
              name,
              {
                type: confirmedWorkflow.type,
                upstream: confirmedWorkflow.upstream,
                fork: confirmedWorkflow.fork,
                pushTo: confirmedWorkflow.pushTo,
                prTarget: confirmedWorkflow.prTarget,
                branchPattern: confirmedWorkflow.branchPattern,
                commitFormat: confirmedWorkflow.commitFormat,
                remotesSnapshot: confirmedWorkflow.remotesSnapshot,
              },
              confirmedWorkflow.confirmedBy ?? 'user',
            );
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  saved: true,
                  repoName: name,
                  workflow: saved,
                  message: `Workflow confirmed and saved for '${name}'.`,
                }, null, 2),
              }],
            };
          }

          // Otherwise resolve and return (may include needsConfirmation)
          const result = await forge.repoWorkflow(name);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        case 'forge_develop': {
          const { repo, workItem, branch, workflow } = (args ?? {}) as {
            repo: string;
            workItem: string;
            branch?: string;
            workflow?: {
              type: 'owner' | 'fork' | 'contributor';
              upstream?: string;
              fork?: string;
              pushTo: string;
              prTarget: { repo: string; branch: string };
              branchPattern?: string;
              commitFormat?: string;
            };
          };
          if (!repo || !workItem) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                error: true,
                code: 'MISSING_REQUIRED_FIELDS',
                message: 'repo and workItem are required.',
              }) }],
              isError: true,
            };
          }
          const developResult = await forge.repoDevelop({ repo, workItem, branch, workflow });
          if (developResult.status === 'needs_workflow_confirmation') {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(developResult, null, 2),
              }],
            };
          }
          const displayPath = developResult.hostSessionPath ?? developResult.sessionPath;
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: developResult.status,
                sessionId: developResult.sessionId,
                sessionPath: displayPath,
                branch: developResult.branch,
                baseBranch: developResult.baseBranch,
                repo: developResult.repo,
                repoSource: developResult.repoSource,
                workflow: developResult.workflow,
                agentSlot: developResult.agentSlot,
                message: developResult.status === 'resumed'
                  ? `Session resumed at ${displayPath} on branch '${developResult.branch}'. Work in this directory.`
                  : `Session created at ${displayPath} on branch '${developResult.branch}' (from ${developResult.baseBranch}). Work in this directory.`,
              }, null, 2),
            }],
          };
        }

        case 'forge_workspace_create': {
          const { config, configVersion, storyId, storyTitle, repos } = args as {
            config: string;
            configVersion?: string;
            storyId?: string;
            storyTitle?: string;
            repos?: string[];
          };
          const workspace = await forge.workspaceCreate({
            configName: config,
            configVersion,
            storyId,
            storyTitle,
            repos,
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                workspace: {
                  id: workspace.id,
                  name: workspace.name,
                  status: workspace.status,
                  createdAt: workspace.createdAt,
                  storyId: workspace.storyId,
                },
              }, null, 2),
            }],
          };
        }

        case 'forge_workspace_list': {
          const { status, storyId } = (args ?? {}) as { status?: string; storyId?: string };
          if (storyId) {
            const record = await forge.workspaceFindByStory(storyId);
            return { content: [{ type: 'text', text: JSON.stringify(record ? [record] : [], null, 2) }] };
          }
          const records = await forge.workspaceList(status ? { status } : undefined);
          return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
        }

        case 'forge_workspace_delete': {
          const { id, force } = args as { id: string; force?: boolean };
          const record = await forge.workspaceStatus(id);
          if (!record) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: true, code: 'WORKSPACE_NOT_FOUND', message: `Workspace '${id}' not found` }, null, 2) }],
            };
          }
          await forge.workspaceDelete(id, { force });
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Workspace '${id}' deleted` }, null, 2) }] };
        }

        case 'forge_workspace_status': {
          const { id } = args as { id: string };
          const record = await forge.workspaceStatus(id);
          if (!record) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: true, code: 'WORKSPACE_NOT_FOUND', message: `Workspace '${id}' not found` }, null, 2) }],
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(record, null, 2) }] };
        }

        case 'forge_session_list': {
          const { repo, workItem } = (args ?? {}) as SessionListOptions;
          const result = await forge.sessionList({ repo, workItem });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        case 'forge_session_cleanup': {
          const { workItem, olderThan, auto } = (args ?? {}) as SessionCleanupOptions;
          if (!workItem && !olderThan && !auto) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                error: true,
                code: 'MISSING_REQUIRED_FIELDS',
                message: 'At least one of workItem, olderThan, or auto must be specified.',
              }) }],
              isError: true,
            };
          }
          const result = await forge.sessionCleanup({ workItem, olderThan, auto });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                cleaned: result.cleaned,
                skipped: result.skipped,
                errors: result.errors,
                summary: `Cleaned ${result.cleaned.length} session(s), skipped ${result.skipped.length}, ${result.errors.length} warning(s)/error(s).`,
              }, null, 2),
            }],
          };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: err.code ?? 'UNKNOWN_ERROR', message: err.message, suggestion: err.suggestion }),
        }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Stdio transport (original, for local/agent use) ───────────────────────

/**
 * Start the Forge MCP server on stdio transport.
 * Used for local Claude Code integration.
 */
export async function startMcpServer(workspaceRoot: string = process.env.FORGE_WORKSPACE_PATH ?? process.cwd()): Promise<void> {
  const server = buildServer(workspaceRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Forge MCP] Server started on stdio');
}

// ─── HTTP transport (for Docker / network use) ─────────────────────────────

export interface HttpServerOptions {
  port: number;
  host: string;
  workspaceRoot?: string;
}

/**
 * Start the Forge MCP server on HTTP (StreamableHTTP) transport.
 * Features:
 *   - /health endpoint returning service status and uptime
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - JSON logging to stderr
 *
 * Used in Docker via `forge serve --transport http`.
 */
export async function startMcpServerHttp(opts: HttpServerOptions): Promise<void> {
  const { port, host, workspaceRoot = process.env.FORGE_WORKSPACE_PATH ?? process.cwd() } = opts;

  // Session registry: maps sessionId -> { transport, lastSeen }
  const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
  interface SessionEntry { transport: StreamableHTTPServerTransport; lastSeen: number; }
  const sessions = new Map<string, SessionEntry>();

  const httpServer = http.createServer(async (req, res) => {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'forge',
        version: '0.1.0',
        uptime_seconds: uptime,
      }));
      return;
    }

    // All other requests go to the MCP transport
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (sessionId && !entry) {
        // Session ID provided but unknown (e.g. server restarted, session expired).
        // Per MCP spec: return 404 so the client can reinitialize cleanly.
        // Without this guard, we'd create a new uninitialized transport for every
        // stale request, leaking memory and potentially leaving requests unanswered.
        log('warn', 'Unknown session ID — returning 404', { sessionId });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      let transport: StreamableHTTPServerTransport;
      if (!entry) {
        // No session ID = new session request (initialize handshake).
        const server = buildServer(workspaceRoot);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, lastSeen: Date.now() });
            log('info', 'MCP session initialized', { sessionId: sid });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            log('info', 'MCP session closed', { sessionId: transport.sessionId });
          }
        };
        await server.connect(transport);
      } else {
        // Known session — refresh last-seen timestamp.
        entry.lastSeen = Date.now();
        transport = entry.transport;
      }

      await transport.handleRequest(req, res);
    } catch (error) {
      log('error', 'HTTP request handling failed', {
        path: req.url,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  // Close idle TCP connections quickly (30s) so clients don't hang after sleep/wake.
  // Node default is effectively OS-level (~15min). keepAliveTimeout must be < headersTimeout.
  httpServer.keepAliveTimeout = 30_000;
  httpServer.headersTimeout = 35_000;

  // Periodic TTL sweeper: evict sessions idle longer than SESSION_TTL_MS.
  // .unref() ensures the timer doesn't prevent process exit.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [sid, e] of sessions) {
      if (now - e.lastSeen > SESSION_TTL_MS) {
        sessions.delete(sid);
        log('info', 'MCP session evicted (TTL)', { sessionId: sid, idleMs: now - e.lastSeen });
      }
    }
  }, 60_000).unref();

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log('info', `Received ${signal}, shutting down gracefully...`);
    clearInterval(sweeper);
    httpServer.close(() => {
      log('info', 'HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      log('warn', 'Forcing shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      log('info', 'Forge MCP HTTP server started', {
        host,
        port,
        url: `http://${host}:${port}`,
      });
      resolve();
    });
    httpServer.on('error', (error) => {
      log('error', 'HTTP server failed to start', {
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error);
    });
  });
}

// Auto-start if run directly via stdio (legacy behaviour)
const isDirectRun = process.argv[1]?.endsWith('/index.ts') || process.argv[1]?.endsWith('\\index.ts');
if (isDirectRun && typeof require !== 'undefined') {
  startMcpServer(process.env.FORGE_WORKSPACE_PATH ?? process.cwd()).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
