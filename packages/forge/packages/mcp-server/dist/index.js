"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRepoCloneArgs = validateRepoCloneArgs;
exports.startMcpServer = startMcpServer;
exports.startMcpServerHttp = startMcpServerHttp;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const node_crypto_1 = require("node:crypto");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const core_1 = require("@forge/core");
const http = __importStar(require("node:http"));
const startTime = Date.now();
// ─── JSON logging ──────────────────────────────────────────────────────────
function log(level, message, extra) {
    const entry = { level, message, timestamp: new Date().toISOString(), ...extra };
    process.stderr.write(JSON.stringify(entry) + '\n');
}
// ─── Tool definitions ──────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'forge_search',
        description: 'Search the Forge registry for skills, agents, or plugins. Use this to discover what artifacts are available before installing them.',
        inputSchema: {
            type: 'object',
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
        description: 'Add one or more artifact refs to forge.yaml. Use after searching to add an artifact to the workspace configuration.',
        inputSchema: {
            type: 'object',
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
        description: 'Run the full install pipeline: resolve all artifacts from forge.yaml and emit them to the workspace. Call this after forge_add.',
        inputSchema: {
            type: 'object',
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
        description: 'Resolve a single artifact reference and return its metadata and dependencies. Useful for inspecting an artifact before installing.',
        inputSchema: {
            type: 'object',
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
        description: 'List artifacts. Use scope="installed" to see what\'s currently installed, or scope="available" to see what\'s in the registry.',
        inputSchema: {
            type: 'object',
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
        description: 'List repositories from the local index. Filter by query (name, path, or URL) and/or language. Automatically scans if no index exists.',
        inputSchema: {
            type: 'object',
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
        description: 'Find a specific repository by name or remote URL. Automatically scans if no index exists.',
        inputSchema: {
            type: 'object',
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
        description: 'Resolve the git workflow configuration for a repository. Checks Vault repo profile first (team-wide conventions), then auto-detects from local git remotes, then falls back to defaults. Returns strategy (owner|fork|direct), default branch, PR target, and hosting info.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Repository name to resolve workflow for',
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'forge_repo_clone',
        description: 'Create an isolated working copy (reference clone) of a repository. The clone gets its own feature branch, independent of the original. Use this to get a safe working directory before making code changes to any repo.',
        inputSchema: {
            type: 'object',
            properties: {
                repoName: {
                    type: 'string',
                    description: 'Repository name from the local index (use forge_repo_list to discover)',
                },
                branchName: {
                    type: 'string',
                    description: 'Feature branch to create in the clone (optional). If omitted, stays on the default branch.',
                },
                destPath: {
                    type: 'string',
                    description: 'Override destination path for the clone (optional). Defaults to <mountPath>/<repoName>-clone-<id>.',
                },
                workspacePath: {
                    type: 'string',
                    description: 'Workspace directory to clone into. Pass $FORGE_WORKSPACE_PATH from workspace.env (e.g. /data/workspaces/your-workspace-id). Required unless destPath is explicitly provided — omitting both causes the clone to land at the global mount root instead of inside your workspace.',
                },
            },
            required: ['repoName'],
        },
    },
    {
        name: 'forge_develop',
        description: 'Start or resume a code session for a work item on a repository. Creates a git worktree at ~/Horus/data/sessions/<workItem>-<slug>/. ' +
            'Implements 3-tier repo resolution: (1) local repo index, (2) managed pool, (3) error with guidance. ' +
            'Returns "needs_workflow_confirmation" when the repo has no saved workflow configuration — call again with the workflow parameter to confirm. ' +
            'If a session already exists for this workItem+repo it is resumed. A second concurrent agent gets a separate slot ("-2" suffix).',
        inputSchema: {
            type: 'object',
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
        description: 'Create a new workspace from a workspace config. Installs plugins, creates git worktrees, and emits MCP configs and environment variables.',
        inputSchema: {
            type: 'object',
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
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['active', 'paused', 'completed', 'archived'], description: 'Filter by workspace status' },
                storyId: { type: 'string', description: 'Filter by linked story ID' },
            },
        },
    },
    {
        name: 'forge_workspace_delete',
        description: 'Delete a workspace by ID. Removes git worktrees and workspace folder from disk.',
        inputSchema: {
            type: 'object',
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
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Workspace ID' },
            },
            required: ['id'],
        },
    },
    {
        name: 'forge_session_list',
        description: 'List active code sessions (git worktrees created by forge_develop). ' +
            'Returns all sessions with metadata including sessionPath, repo, workItem, branch, and timestamps. ' +
            'Optionally filter by repo name or workItem ID.',
        inputSchema: {
            type: 'object',
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
        description: 'Clean up stale code sessions (git worktrees). ' +
            'Runs git worktree remove + prune, removes the session directory, and removes the session record. ' +
            'Specify at least one of: workItem (clean a specific session), olderThan (clean sessions older than threshold), ' +
            'or auto (query Anvil for work item status and clean eligible sessions).',
        inputSchema: {
            type: 'object',
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
                    description: 'Auto-cleanup mode: query Anvil for work item status of each session. ' +
                        'Cleans: done (7+ days ago) and cancelled. Skips: in_progress, in_review, not found.',
                },
            },
        },
    },
];
// ─── Validation helpers ────────────────────────────────────────────────────
/**
 * Validate forge_repo_clone arguments.
 *
 * Returns an error object if the call is invalid, null if valid.
 * Exported so tests can assert on the guard directly without invoking the full
 * MCP transport — this ensures a future refactor cannot accidentally drop the
 * validation without breaking the test suite.
 *
 * The recurring regression: callers omit workspacePath, causing clones to land
 * at the global mount root (/workspaces/<repo>) instead of the workspace
 * folder (/workspaces/<workspace-id>/<repo>). Without this guard the failure
 * is silent — the clone succeeds at the wrong path.
 */
function validateRepoCloneArgs(args) {
    if (!args.repoName) {
        return {
            error: true,
            code: 'REPO_NAME_REQUIRED',
            message: 'repoName is required.',
            suggestion: 'Provide the repoName parameter.',
        };
    }
    if (!args.workspacePath && !args.destPath) {
        return {
            error: true,
            code: 'WORKSPACE_PATH_REQUIRED',
            message: 'workspacePath is required when calling forge_repo_clone from a workspace session.',
            suggestion: 'Pass workspacePath: $FORGE_WORKSPACE_PATH from workspace.env (e.g. /data/workspaces/your-workspace-id). Alternatively, provide an explicit destPath.',
        };
    }
    return null;
}
// ─── Tool handler ──────────────────────────────────────────────────────────
function buildServer(workspaceRoot) {
    const forge = new core_1.ForgeCore(workspaceRoot);
    const server = new index_js_1.Server({ name: 'forge-mcp-server', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async (_req) => ({
        tools: TOOLS,
    }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            switch (name) {
                case 'forge_search': {
                    const { query, type } = args;
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
                    const { refs } = args;
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
                    const { target, dryRun } = (args ?? {});
                    const report = await forge.install({ target: target, dryRun });
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
                    const { ref } = args;
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
                    const { scope } = (args ?? {});
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
                    const { query, language } = (args ?? {});
                    let repos = await forge.repoList(query);
                    if (language) {
                        repos = repos.filter((r) => r.language?.toLowerCase() === language.toLowerCase());
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
                    const { name, remoteUrl } = (args ?? {});
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
                    const { name } = (args ?? {});
                    if (!name) {
                        return {
                            content: [{ type: 'text', text: JSON.stringify({ error: true, message: 'name is required' }) }],
                            isError: true,
                        };
                    }
                    const workflow = await forge.repoWorkflow(name);
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(workflow, null, 2),
                            }],
                    };
                }
                case 'forge_repo_clone': {
                    const { repoName, branchName, destPath, workspacePath } = (args ?? {});
                    const validationError = validateRepoCloneArgs({ repoName, workspacePath, destPath });
                    if (validationError) {
                        return {
                            content: [{ type: 'text', text: JSON.stringify(validationError) }],
                            isError: true,
                        };
                    }
                    const cloneResult = await forge.repoClone({ repoName, branchName, destPath, workspacePath });
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    repoName: cloneResult.repoName,
                                    clonePath: cloneResult.clonePath,
                                    hostClonePath: cloneResult.hostClonePath,
                                    branch: cloneResult.branch,
                                    origin: cloneResult.origin,
                                    message: `Clone created at ${cloneResult.hostClonePath} on branch '${cloneResult.branch}'. Origin remote: ${cloneResult.origin}. Work in this directory — it is isolated from the original repo.`,
                                }, null, 2),
                            }],
                    };
                }
                case 'forge_develop': {
                    const { repo, workItem, branch, workflow } = (args ?? {});
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
                    const { config, configVersion, storyId, storyTitle, repos } = args;
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
                    const { status, storyId } = (args ?? {});
                    if (storyId) {
                        const record = await forge.workspaceFindByStory(storyId);
                        return { content: [{ type: 'text', text: JSON.stringify(record ? [record] : [], null, 2) }] };
                    }
                    const records = await forge.workspaceList(status ? { status } : undefined);
                    return { content: [{ type: 'text', text: JSON.stringify(records, null, 2) }] };
                }
                case 'forge_workspace_delete': {
                    const { id, force } = args;
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
                    const { id } = args;
                    const record = await forge.workspaceStatus(id);
                    if (!record) {
                        return {
                            content: [{ type: 'text', text: JSON.stringify({ error: true, code: 'WORKSPACE_NOT_FOUND', message: `Workspace '${id}' not found` }, null, 2) }],
                        };
                    }
                    return { content: [{ type: 'text', text: JSON.stringify(record, null, 2) }] };
                }
                case 'forge_session_list': {
                    const { repo, workItem } = (args ?? {});
                    const result = await forge.sessionList({ repo, workItem });
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(result, null, 2),
                            }],
                    };
                }
                case 'forge_session_cleanup': {
                    const { workItem, olderThan, auto } = (args ?? {});
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
        }
        catch (err) {
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
async function startMcpServer(workspaceRoot = process.env.FORGE_WORKSPACE_PATH ?? process.cwd()) {
    const server = buildServer(workspaceRoot);
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error('[Forge MCP] Server started on stdio');
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
async function startMcpServerHttp(opts) {
    const { port, host, workspaceRoot = process.env.FORGE_WORKSPACE_PATH ?? process.cwd() } = opts;
    // Session registry: maps sessionId -> { transport, lastSeen }
    const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const sessions = new Map();
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
            const sessionId = req.headers['mcp-session-id'];
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
            let transport;
            if (!entry) {
                // No session ID = new session request (initialize handshake).
                const server = buildServer(workspaceRoot);
                transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                    sessionIdGenerator: () => (0, node_crypto_1.randomUUID)(),
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
            }
            else {
                // Known session — refresh last-seen timestamp.
                entry.lastSeen = Date.now();
                transport = entry.transport;
            }
            await transport.handleRequest(req, res);
        }
        catch (error) {
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
    const shutdown = (signal) => {
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
    return new Promise((resolve, reject) => {
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
//# sourceMappingURL=index.js.map