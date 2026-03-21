import { promises as fs } from 'fs';
import path from 'path';
import type { ClaudePermissions } from '../models/global-config.js';

/**
 * Describes an MCP server to register in .claude/settings.local.json.
 */
export interface McpServerEntry {
  name: string;
  url: string;
}

/**
 * Merge the given MCP server entries and permissions into
 * {workspacePath}/.claude/settings.local.json using Claude Code's native
 * HTTP transport. Preserves all existing settings.
 *
 * Writes to settings.local.json (machine-specific, gitignored) because it
 * contains localhost URLs that differ per machine.
 *
 * Each entry produces a mcpServers record like:
 *   "anvil": { "type": "http", "url": "http://localhost:8100/mcp" }
 *
 * Permissions from `claude_permissions` in ~/.forge/config.yaml are merged
 * into the file so that the local settings don't shadow the user's global
 * ~/.claude/settings.json permissions (Claude Code treats a local
 * settings.local.json as authoritative when it exists).
 */
export async function updateClaudeMcpServers(
  servers: McpServerEntry[],
  workspacePath: string,
  _hostWorkspacePath?: string,
  claudePermissions?: ClaudePermissions,
): Promise<void> {
  if (servers.length === 0) return;

  const settingsPath = path.join(workspacePath, '.claude', 'settings.local.json');

  // Read existing settings, defaulting to empty object on missing/invalid file.
  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // File absent or unparseable — start fresh.
  }

  // Merge: add/overwrite only the servers Forge knows about; leave others intact.
  const mcpServers = (settings.mcpServers as Record<string, unknown>) ?? {};
  for (const { name, url } of servers) {
    // Append /mcp to the base URL for the Streamable HTTP endpoint.
    const mcpUrl = url.replace(/\/+$/, '') + '/mcp';
    mcpServers[name] = {
      type: 'http',
      url: mcpUrl,
    };
  }
  settings.mcpServers = mcpServers;

  // Merge permissions from claude_permissions config into the local file.
  // Without this, the mere existence of settings.local.json causes Claude Code to
  // treat the local permissions as authoritative, shadowing the global wildcard.
  const configAllow = claudePermissions?.allow ?? ['mcp__*__*'];
  const configDeny = claudePermissions?.deny ?? [];

  const permissions = (settings.permissions as Record<string, unknown>) ?? {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow as string[] : [];
  for (const entry of configAllow) {
    if (!allow.includes(entry)) {
      allow.push(entry);
    }
  }
  permissions.allow = allow;

  if (configDeny.length > 0) {
    const deny = Array.isArray(permissions.deny) ? permissions.deny as string[] : [];
    for (const entry of configDeny) {
      if (!deny.includes(entry)) {
        deny.push(entry);
      }
    }
    permissions.deny = deny;
  }
  settings.permissions = permissions;

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );
}

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
export async function emitPreToolUseHook(
  workspacePath: string,
  hostWorkspacePath: string,
): Promise<void> {
  // 1. Write the guard script — fully generic, no user-specific paths
  const scriptsDir = path.join(workspacePath, '.claude', 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  const guardScript = `#!/bin/bash
# Guard script: blocks Edit/Write on source repos, forcing forge_repo_clone usage.
# Emitted by Forge during workspace creation. Do not edit manually.
#
# Heuristic: if the target file is inside a git repo, block the edit UNLESS
# that repo root is inside a Horus workspace directory. This is fully generic —
# no hardcoded user paths, and it automatically covers any git repo on the machine.

input=$(cat)

# Check jq is available
if ! command -v jq &>/dev/null; then
  # Can't parse input without jq — allow to avoid breaking non-jq environments
  exit 0
fi

file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# If no file_path in the tool input, allow (not a file operation we care about)
if [ -z "$file_path" ]; then
  exit 0
fi

# Resolve to absolute path if relative
if [[ "$file_path" != /* ]]; then
  file_path="$(pwd)/$file_path"
fi

# Find the git repo root for this file (if any)
file_dir=$(dirname "$file_path")
repo_root=$(git -C "$file_dir" rev-parse --show-toplevel 2>/dev/null)

# Not inside a git repo — allow (not a source repo)
if [ -z "$repo_root" ]; then
  exit 0
fi

# Check if the repo root is inside a Horus workspace — if so, it's a
# workspace clone created by forge_repo_clone, so allow edits
HORUS_DATA_DIR="\${HORUS_DATA_DIR:-$HOME/.horus/data}"
if [[ "$repo_root" == "$HORUS_DATA_DIR/workspaces/"* ]]; then
  exit 0
fi

# It's a source repo — block the edit
repo_name=$(basename "$repo_root")

cat >&2 <<MSG
BLOCKED: Cannot edit files in source repository '\${repo_name}' directly.

To get an isolated working copy, call:
  forge_repo_clone with repoName="\${repo_name}"

Then edit files in the returned clonePath instead.
MSG
exit 2
`;

  const scriptPath = path.join(scriptsDir, 'guard-source-repos.sh');
  await fs.writeFile(scriptPath, guardScript, { mode: 0o755 });

  // 2. Merge the PreToolUse hook into .claude/settings.local.json
  const settingsPath = path.join(workspacePath, '.claude', 'settings.local.json');
  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // File absent or unparseable — start fresh.
  }

  // Derive HORUS_DATA_DIR from the workspace path ($DATA_DIR/workspaces/$ID)
  // and pass it explicitly so the guard script uses the correct value regardless
  // of the user's environment (avoids the wrong $HOME/.horus/data default).
  const horusDataDir = path.dirname(path.dirname(hostWorkspacePath));
  const hookCommand = `HORUS_DATA_DIR=${JSON.stringify(horusDataDir)} bash ${hostWorkspacePath}/.claude/scripts/guard-source-repos.sh`;

  const hooks = (settings.hooks as Record<string, unknown[]>) ?? {};
  const preToolUse = (hooks.PreToolUse as Array<Record<string, unknown>>) ?? [];

  // Avoid duplicate: check if we already have this matcher
  const existing = preToolUse.find(
    (entry) => entry.matcher === 'Edit|Write' && Array.isArray(entry.hooks) &&
      (entry.hooks as Array<Record<string, unknown>>).some(
        (h) => h.type === 'command' && typeof h.command === 'string' &&
          (h.command as string).includes('guard-source-repos.sh'),
      ),
  );

  if (!existing) {
    preToolUse.push({
      matcher: 'Edit|Write',
      hooks: [
        {
          type: 'command',
          command: hookCommand,
        },
      ],
    });
  }

  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;

  await fs.writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Write Cursor MCP server configuration to {workspacePath}/.cursor/mcp.json.
 *
 * Cursor uses a simpler format than Claude Code — just a url field per server
 * for streamable HTTP transport:
 *   "anvil": { "url": "http://localhost:8100/mcp" }
 *
 * Preserves existing entries in the file (only overwrites Forge-managed servers).
 */
export async function updateCursorMcpServers(
  servers: McpServerEntry[],
  workspacePath: string,
): Promise<void> {
  if (servers.length === 0) return;

  const settingsPath = path.join(workspacePath, '.cursor', 'mcp.json');

  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // File absent or unparseable — start fresh.
  }

  const mcpServers = (settings.mcpServers as Record<string, unknown>) ?? {};
  for (const { name, url } of servers) {
    const mcpUrl = url.replace(/\/+$/, '') + '/mcp';
    mcpServers[name] = { url: mcpUrl };
  }
  settings.mcpServers = mcpServers;

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * @deprecated No longer needed — native HTTP transport eliminates mcp-remote.
 * Retained to avoid breaking any code that imports this function.
 */
export async function emitMcpRemoteWrapper(workspacePath: string): Promise<string> {
  return path.join(workspacePath, '.claude', 'bin', 'mcp-remote-wrapper');
}

/**
 * @deprecated Use updateClaudeMcpServers with explicit workspacePath and hostWorkspacePath.
 * Retained as a no-op shim to avoid breaking any code that imports WRAPPER_PATH.
 */
export const WRAPPER_PATH = '';
