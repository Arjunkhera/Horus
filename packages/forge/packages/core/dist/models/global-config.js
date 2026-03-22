"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalConfigSchema = exports.ClaudePermissionsSchema = exports.GlobalPluginEntrySchema = exports.ReposConfigSchema = exports.HostEndpointsSchema = exports.McpEndpointsSchema = exports.McpEndpointSchema = exports.WorkspaceSettingsSchema = void 0;
const zod_1 = require("zod");
const forge_config_js_1 = require("./forge-config.js");
/**
 * Workspace settings section.
 */
exports.WorkspaceSettingsSchema = zod_1.z.object({
    mount_path: zod_1.z.string().default('~/forge-workspaces'),
    default_config: zod_1.z.string().default('sdlc-default'),
    retention_days: zod_1.z.number().default(30),
    /**
     * Host-side absolute path for the workspaces directory.
     * Only needed when Forge runs inside Docker and the workspaces volume is
     * bind-mounted from the host (e.g., ${HORUS_DATA_PATH}/workspaces).
     * Used to emit correct absolute paths into .claude/settings.local.json
     * so Claude Code on the host can resolve the wrapper script and URLs.
     */
    /**
     * Path to the workspace metadata store file (workspaces.json).
     * Defaults to ~/Horus/data/config/workspaces.json (suitable for standalone/host use).
     * Override to a volume-mounted path when running in Docker so metadata
     * survives container restarts (e.g., /data/config/workspaces.json).
     */
    store_path: zod_1.z.string().default('~/Horus/data/config/workspaces.json'),
    /**
     * Path to the code session store file (sessions.json).
     * Tracks active forge_develop sessions (one per work-item+agent).
     */
    sessions_path: zod_1.z.string().default('~/Horus/data/config/sessions.json'),
    /**
     * Root directory for managed repo pool (tier-2 in 3-tier resolution).
     * When a repo is not found in scan_paths, Forge clones it here as a
     * bare/reference clone before creating a worktree.
     * Defaults to ~/Horus/data/repos/.
     */
    managed_repos_path: zod_1.z.string().default('~/Horus/data/repos'),
    /**
     * Root directory for code sessions (git worktrees).
     * Each forge_develop call creates a worktree under this path.
     * Defaults to ~/Horus/data/sessions/.
     */
    sessions_root: zod_1.z.string().default('~/Horus/data/sessions'),
    /**
     * Maximum number of active sessions before forge_develop emits a warning.
     * Does NOT block session creation — only warns and suggests cleanup.
     * Defaults to 20.
     */
    max_sessions: zod_1.z.number().int().min(1).default(20),
    host_workspaces_path: zod_1.z.string().optional(),
});
/**
 * MCP endpoint entry.
 */
exports.McpEndpointSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    transport: zod_1.z.enum(['http', 'stdio']).default('http'),
});
/**
 * MCP endpoints section (maps endpoint names to their configurations).
 */
exports.McpEndpointsSchema = zod_1.z.object({
    anvil: exports.McpEndpointSchema.optional(),
    vault: exports.McpEndpointSchema.optional(),
    forge: exports.McpEndpointSchema.optional(),
});
/**
 * Host-facing MCP endpoints — the URLs Claude Code on the host machine uses
 * to reach MCP servers. Separate from mcp_endpoints (which holds container-
 * internal URLs when Forge runs in Docker).
 *
 * Set via FORGE_HOST_*_URL environment variables in docker-compose.
 */
exports.HostEndpointsSchema = zod_1.z.object({
    anvil: zod_1.z.string().url().optional(),
    vault: zod_1.z.string().url().optional(),
    forge: zod_1.z.string().url().optional(),
});
/**
 * Repository configuration section.
 */
exports.ReposConfigSchema = zod_1.z.object({
    scan_paths: zod_1.z.array(zod_1.z.string()).default([]),
    index_path: zod_1.z.string().default('~/Horus/data/config/repos.json'),
    /**
     * Host-side absolute path corresponding to the first scan_path.
     * Only needed when Forge runs inside Docker and the repos directory is
     * bind-mounted from the host (e.g., ${HOST_REPOS_PATH}:/data/repos).
     * When set, localPath in repo results is translated from the container
     * path to the equivalent host path so callers can access repos directly.
     */
    host_repos_path: zod_1.z.string().optional(),
});
/**
 * Schema for the global Forge configuration (~/Horus/data/config/forge.yaml).
 *
 * Global registries act as fallbacks — workspace-local registries
 * take priority, and global registries are appended as lower-priority
 * sources.
 *
 * @example
 * # ~/Horus/data/config/forge.yaml
 * registries:
 *   - type: git
 *     name: team-registry
 *     url: https://github.com/myorg/forge-registry.git
 *     branch: main
 *     path: registry
 *
 * workspace:
 *   mount_path: ~/Horus/data/workspaces
 *   default_config: sdlc-default
 *   retention_days: 30
 *   store_path: ~/Horus/data/config/workspaces.json
 *   host_workspaces_path: /Users/me/Horus/data/workspaces  # host-side path (Docker only)
 *
 * mcp_endpoints:
 *   anvil:
 *     url: http://anvil:8100   # container-internal
 *     transport: http
 *
 * host_endpoints:              # host-facing ports (Docker only)
 *   anvil: http://localhost:8100
 *   vault: http://localhost:8300
 *   forge: http://localhost:8200
 *
 * repos:
 *   scan_paths:
 *     - ~/Repositories
 *   index_path: ~/Horus/data/config/repos.json
 */
/**
 * Tracks a globally installed plugin.
 */
exports.GlobalPluginEntrySchema = zod_1.z.object({
    version: zod_1.z.string(),
    installed_at: zod_1.z.string(),
    files: zod_1.z.array(zod_1.z.string()).default([]),
});
/**
 * Claude Code permissions to write into workspace settings.local.json.
 * Prevents the local file from shadowing the user's global ~/.claude/settings.json
 * permissions (Claude Code treats local settings as authoritative when present).
 */
exports.ClaudePermissionsSchema = zod_1.z.object({
    allow: zod_1.z.array(zod_1.z.string()).default(['mcp__*__*']),
    deny: zod_1.z.array(zod_1.z.string()).default([]),
    defaultMode: zod_1.z.enum(['default', 'allowedTools', 'autoEdit', 'bypassPermissions', 'plan']).optional(),
});
exports.GlobalConfigSchema = zod_1.z.object({
    registries: zod_1.z.array(forge_config_js_1.RegistryConfigSchema).default([]),
    workspace: exports.WorkspaceSettingsSchema.default({}),
    mcp_endpoints: exports.McpEndpointsSchema.default({}),
    host_endpoints: exports.HostEndpointsSchema.optional(),
    repos: exports.ReposConfigSchema.default({}),
    global_plugins: zod_1.z.record(zod_1.z.string(), exports.GlobalPluginEntrySchema).default({}),
    claude_permissions: exports.ClaudePermissionsSchema.default({}),
});
//# sourceMappingURL=global-config.js.map