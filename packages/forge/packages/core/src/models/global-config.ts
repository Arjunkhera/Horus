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
   * Defaults to ~/Horus/data/config/workspaces.json (suitable for standalone/host use).
   * Override to a volume-mounted path when running in Docker so metadata
   * survives container restarts (e.g., /data/config/workspaces.json).
   */
  store_path: z.string().default('~/Horus/data/config/workspaces.json'),
  /**
   * Path to the code session store file (sessions.json).
   * Tracks active forge_develop sessions (one per work-item+agent).
   */
  sessions_path: z.string().default('~/Horus/data/config/sessions.json'),
  /**
   * Root directory for managed repo pool (tier-2 in 3-tier resolution).
   * When a repo is not found in scan_paths, Forge clones it here as a
   * bare/reference clone before creating a worktree.
   * Defaults to ~/Horus/data/repos/.
   */
  managed_repos_path: z.string().default('~/Horus/data/repos'),
  /**
   * Root directory for code sessions (git worktrees).
   * Each forge_develop call creates a worktree under this path.
   * Defaults to ~/Horus/data/sessions/.
   */
  sessions_root: z.string().default('~/Horus/data/sessions'),
  /**
   * Maximum number of active sessions before forge_develop emits a warning.
   * Does NOT block session creation — only warns and suggests cleanup.
   * Defaults to 20.
   */
  max_sessions: z.number().int().min(1).default(20),
  host_workspaces_path: z.string().optional(),
  /**
   * Host-side absolute path for the managed repos pool directory.
   * Only needed when Forge runs inside Docker and the managed repos volume
   * is bind-mounted with a different name than on the host
   * (e.g., host: ${HORUS_DATA_PATH}/repos → container: /data/horus-repos).
   * Used to rewrite .git worktree pointers so git works from the host.
   */
  host_managed_repos_path: z.string().optional(),
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
  index_path: z.string().default('~/Horus/data/config/repos.json'),
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

/**
 * Input variant of GlobalConfig — fields with `.default()` are optional.
 * Use this when accepting user/test input that will be parsed by Zod.
 */
export type GlobalConfigInput = z.input<typeof GlobalConfigSchema>;
