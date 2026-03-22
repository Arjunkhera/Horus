import { z } from 'zod';
import { RegistryConfigSchema } from './forge-config.js';

/**
 * Workspace settings section.
 */
export const WorkspaceSettingsSchema = z.object({
  mount_path: z.string().default('~/forge-workspaces'),
  default_config: z.string().default('sdlc-default'),
  retention_days: z.number().default(30),
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
  store_path: z.string().default('~/.forge/workspaces.json'),
  host_workspaces_path: z.string().optional(),
});

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

/**
 * MCP endpoint entry.
 */
export const McpEndpointSchema = z.object({
  url: z.string().url(),
  transport: z.enum(['http', 'stdio']).default('http'),
});

export type McpEndpoint = z.infer<typeof McpEndpointSchema>;

/**
 * MCP endpoints section (maps endpoint names to their configurations).
 */
export const McpEndpointsSchema = z.object({
  anvil: McpEndpointSchema.optional(),
  vault: McpEndpointSchema.optional(),
  forge: McpEndpointSchema.optional(),
});

export type McpEndpoints = z.infer<typeof McpEndpointsSchema>;

/**
 * Host-facing MCP endpoints — the URLs Claude Code on the host machine uses
 * to reach MCP servers. Separate from mcp_endpoints (which holds container-
 * internal URLs when Forge runs in Docker).
 *
 * Set via FORGE_HOST_*_URL environment variables in docker-compose.
 */
export const HostEndpointsSchema = z.object({
  anvil: z.string().url().optional(),
  vault: z.string().url().optional(),
  forge: z.string().url().optional(),
});

export type HostEndpoints = z.infer<typeof HostEndpointsSchema>;

/**
 * Repository configuration section.
 */
export const ReposConfigSchema = z.object({
  scan_paths: z.array(z.string()).default([]),
  index_path: z.string().default('~/.forge/repos.json'),
  /**
   * Host-side absolute path corresponding to the first scan_path.
   * Only needed when Forge runs inside Docker and the repos directory is
   * bind-mounted from the host (e.g., ${HOST_REPOS_PATH}:/data/repos).
   * When set, localPath in repo results is translated from the container
   * path to the equivalent host path so callers can access repos directly.
   */
  host_repos_path: z.string().optional(),
});

export type ReposConfig = z.infer<typeof ReposConfigSchema>;

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
 *   index_path: ~/.forge/repos.json
 */
/**
 * Tracks a globally installed plugin.
 */
export const GlobalPluginEntrySchema = z.object({
  version: z.string(),
  installed_at: z.string(),
  files: z.array(z.string()).default([]),
});

export type GlobalPluginEntry = z.infer<typeof GlobalPluginEntrySchema>;

/**
 * Claude Code permissions to write into workspace settings.local.json.
 * Prevents the local file from shadowing the user's global ~/.claude/settings.json
 * permissions (Claude Code treats local settings as authoritative when present).
 */
export const ClaudePermissionsSchema = z.object({
  allow: z.array(z.string()).default(['mcp__*__*']),
  deny: z.array(z.string()).default([]),
  defaultMode: z.enum(['default', 'allowedTools', 'autoEdit', 'bypassPermissions', 'plan']).optional(),
});

export type ClaudePermissions = z.infer<typeof ClaudePermissionsSchema>;

export const GlobalConfigSchema = z.object({
  registries: z.array(RegistryConfigSchema).default([]),
  workspace: WorkspaceSettingsSchema.default({}),
  mcp_endpoints: McpEndpointsSchema.default({}),
  host_endpoints: HostEndpointsSchema.optional(),
  repos: ReposConfigSchema.default({}),
  global_plugins: z.record(z.string(), GlobalPluginEntrySchema).default({}),
  claude_permissions: ClaudePermissionsSchema.default({}),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
