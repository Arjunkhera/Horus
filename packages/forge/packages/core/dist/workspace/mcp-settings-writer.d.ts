import type { ClaudePermissions } from '../models/global-config.js';
/**
 * Describes an MCP server to register in .claude/settings.local.json.
 */
export interface McpServerEntry {
    name: string;
    url: string;
}
/**
 * Merge the given MCP server entries and permissions into Claude Code settings
 * for the workspace. Preserves all existing settings.
 *
 * Writes to two files:
 * - settings.local.json — MCP server URLs, hooks, and permissions (machine-specific,
 *   gitignored). Contains localhost URLs that differ per machine.
 * - settings.json — permissions only (project-level, committed to git). Required
 *   because Claude Code only reliably suppresses approval prompts when the permission
 *   rule exists in settings.json; settings.local.json alone is insufficient.
 *
 * Each mcpServers entry in settings.local.json looks like:
 *   "anvil": { "type": "http", "url": "http://localhost:8100/mcp" }
 */
export declare function updateClaudeMcpServers(servers: McpServerEntry[], workspacePath: string, _hostWorkspacePath?: string, claudePermissions?: ClaudePermissions): Promise<void>;
/**
 * Emit the guard-source-repos.sh script and register a PreToolUse hook in
 * .claude/settings.local.json that blocks Edit/Write operations targeting
 * source repo paths. Forces Claude to use forge_repo_clone for isolation.
 *
 * Uses a git-based heuristic instead of hardcoded paths: any file inside a
 * git repo is blocked UNLESS that repo root is inside a Horus workspace
 * ($HORUS_DATA_DIR/workspaces/). This covers user repos, Horus-internal
 * repos (knowledge-base, notes, registry), and any future repos automatically.
 *
 * @param workspacePath   Container-side workspace root (where files are written)
 * @param hostWorkspacePath  Host-side workspace root (used in hook command path)
 */
export declare function emitPreToolUseHook(workspacePath: string, hostWorkspacePath: string): Promise<void>;
/**
 * Write Cursor MCP server configuration to {workspacePath}/.cursor/mcp.json.
 *
 * Cursor uses a simpler format than Claude Code — just a url field per server
 * for streamable HTTP transport:
 *   "anvil": { "url": "http://localhost:8100/mcp" }
 *
 * Preserves existing entries in the file (only overwrites Forge-managed servers).
 */
export declare function updateCursorMcpServers(servers: McpServerEntry[], workspacePath: string): Promise<void>;
/**
 * @deprecated No longer needed — native HTTP transport eliminates mcp-remote.
 * Retained to avoid breaking any code that imports this function.
 */
export declare function emitMcpRemoteWrapper(workspacePath: string): Promise<string>;
/**
 * @deprecated Use updateClaudeMcpServers with explicit workspacePath and hostWorkspacePath.
 * Retained as a no-op shim to avoid breaking any code that imports WRAPPER_PATH.
 */
export declare const WRAPPER_PATH = "";
//# sourceMappingURL=mcp-settings-writer.d.ts.map