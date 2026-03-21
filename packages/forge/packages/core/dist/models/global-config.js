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
     * Defaults to ~/.forge/workspaces.json (suitable for standalone/host use).
     * Override to a volume-mounted path when running in Docker so metadata
     * survives container restarts (e.g., /data/workspaces/workspaces.json).
     */
    store_path: zod_1.z.string().default('~/.forge/workspaces.json'),
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
    index_path: zod_1.z.string().default('~/.forge/repos.json'),
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
 * Schema for the global Forge configuration (~/.forge/config.yaml).
 *
 * Global registries act as fallbacks — workspace-local registries
 * take priority, and global registries are appended as lower-priority
 * sources.
 *
 * @example
 * # ~/.forge/config.yaml
 * registries:
 *   - type: git
 *     name: team-registry
 *     url: https://github.com/myorg/forge-registry.git
 *     branch: main
 *     path: registry
 *
 * workspace:
 *   mount_path: ~/workspaces
 *   default_config: sdlc-default
 *   retention_days: 30
 *   host_workspaces_path: /Users/me/horus-data/workspaces  # host-side path (Docker only)
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
 *   index_path: ~/.forge/repos.json
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
    allow: zod_1.z.array(zod_1.z.string()).default(['mcp__*']),
    deny: zod_1.z.array(zod_1.z.string()).default([]),
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