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
export async function updateClaudeMcpServers(
  servers: McpServerEntry[],
  workspacePath: string,
  _hostWorkspacePath?: string,
  claudePermissions?: ClaudePermissions,
): Promise<void> {
  if (servers.length === 0) return;

  const claudeDir = path.join(workspacePath, '.claude');
  await fs.mkdir(claudeDir, { recursive: true });

  const configAllow = claudePermissions?.allow ?? ['mcp__*__*'];
  const configDeny = claudePermissions?.deny ?? [];
  const configDefaultMode = claudePermissions?.defaultMode;

  // --- settings.local.json: MCP server URLs + permissions (machine-specific) ---
  const localSettingsPath = path.join(claudeDir, 'settings.local.json');
  let localSettings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(localSettingsPath, 'utf-8');
    localSettings = JSON.parse(raw);
  } catch {
    // File absent or unparseable — start fresh.
  }

  // Merge: add/overwrite only the servers Forge knows about; leave others intact.
  const mcpServers = (localSettings.mcpServers as Record<string, unknown>) ?? {};
  for (const { name, url } of servers) {
    // Append /mcp to the base URL for the Streamable HTTP endpoint.
    const mcpUrl = url.replace(/\/+$/, '') + '/mcp';
    mcpServers[name] = { type: 'http', url: mcpUrl };
  }
  localSettings.mcpServers = mcpServers;

  const localPermissions = (localSettings.permissions as Record<string, unknown>) ?? {};
  const localAllow = Array.isArray(localPermissions.allow) ? localPermissions.allow as string[] : [];
  for (const entry of configAllow) {
    if (!localAllow.includes(entry)) localAllow.push(entry);
  }
  localPermissions.allow = localAllow;
  if (configDeny.length > 0) {
    const localDeny = Array.isArray(localPermissions.deny) ? localPermissions.deny as string[] : [];
    for (const entry of configDeny) {
      if (!localDeny.includes(entry)) localDeny.push(entry);
    }
    localPermissions.deny = localDeny;
  }
  if (configDefaultMode) {
    localPermissions.defaultMode = configDefaultMode;
  }
  localSettings.permissions = localPermissions;

  await fs.writeFile(localSettingsPath, JSON.stringify(localSettings, null, 2) + '\n', 'utf-8');

  // --- settings.json: permissions only (project-level, shared) ---
  // MCP server URLs and hooks are NOT written here — they are machine-specific.
  const sharedSettingsPath = path.join(claudeDir, 'settings.json');
  let sharedSettings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(sharedSettingsPath, 'utf-8');
    sharedSettings = JSON.parse(raw);
  } catch {
    // File absent or unparseable — start fresh.
  }

  const sharedPermissions = (sharedSettings.permissions as Record<string, unknown>) ?? {};
  const sharedAllow = Array.isArray(sharedPermissions.allow) ? sharedPermissions.allow as string[] : [];
  for (const entry of configAllow) {
    if (!sharedAllow.includes(entry)) sharedAllow.push(entry);
  }
  sharedPermissions.allow = sharedAllow;
  if (configDeny.length > 0) {
    const sharedDeny = Array.isArray(sharedPermissions.deny) ? sharedPermissions.deny as string[] : [];
    for (const entry of configDeny) {
      if (!sharedDeny.includes(entry)) sharedDeny.push(entry);
    }
    sharedPermissions.deny = sharedDeny;
  }
  if (configDefaultMode) {
    sharedPermissions.defaultMode = configDefaultMode;
  }
  sharedSettings.permissions = sharedPermissions;

  await fs.writeFile(sharedSettingsPath, JSON.stringify(sharedSettings, null, 2) + '\n', 'utf-8');
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
# Guard script: blocks Edit/Write/Bash on source repos, forcing forge_develop usage.
# Emitted by Forge during workspace creation. Do not edit manually.
#
# Covers two attack surfaces:
#   1. Edit/Write tools — checks tool_input.file_path
#   2. Bash tool     — detects git write operations (commit, push, add, reset, ...)
#                      and checks the target repo path via -C flag or cd commands.
#
# Allowed repos: anything inside $HORUS_DATA_DIR/workspaces/ (workspace clones)
#                or $HORUS_DATA_DIR/sessions/ (forge_develop worktrees).

input=$(cat)

# Check jq is available
if ! command -v jq &>/dev/null; then
  # Can't parse input without jq — allow to avoid breaking non-jq environments
  exit 0
fi

HORUS_DATA_DIR="\${HORUS_DATA_DIR:-$HOME/.horus/data}"

is_allowed_repo() {
  local repo_root="$1"
  [[ "$repo_root" == "$HORUS_DATA_DIR/workspaces/"* ]] && return 0
  [[ "$repo_root" == "$HORUS_DATA_DIR/sessions/"* ]]   && return 0
  return 1
}

# ── Bash tool: detect git write operations targeting source repos ─────────────
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

if [ -n "$cmd" ]; then
  # Detect git write verbs: commit, push, add, reset, merge, rebase, tag
  if echo "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]].*[[:space:]](commit|push|add|reset|merge|rebase|tag)([[:space:]]|$)'; then
    # Extract explicit -C path (git -C <path> <verb>)
    target_path=$(echo "$cmd" | grep -oP '(?<=git -C )[^\s]+' | head -1)

    # If no -C, look for a leading cd <path>
    if [ -z "$target_path" ]; then
      target_path=$(echo "$cmd" | grep -oP '(?:^|[;&|]\s*)cd\s+\K\S+' | head -1)
    fi

    if [ -n "$target_path" ]; then
      if [[ "$target_path" != /* ]]; then
        target_path="$(pwd)/$target_path"
      fi
      repo_root=$(git -C "$target_path" rev-parse --show-toplevel 2>/dev/null)
      if [ -n "$repo_root" ] && ! is_allowed_repo "$repo_root"; then
        repo_name=$(basename "$repo_root")
        cat >&2 <<MSG
BLOCKED: Cannot run git write operations in source repository '\${repo_name}' directly.

Agents must not commit or push to source repos. Use forge_develop to get an
isolated session (git worktree) and work inside the returned sessionPath.

  forge_develop with repo="\${repo_name}"
MSG
        exit 2
      fi
    fi
    # No resolvable path — can't confirm source repo. Allow but pre-commit hook will catch it.
  fi
  exit 0
fi

# ── Edit/Write tools: check tool_input.file_path ─────────────────────────────
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

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

# Not inside a git repo — allow
if [ -z "$repo_root" ]; then
  exit 0
fi

if is_allowed_repo "$repo_root"; then
  exit 0
fi

# It's a source repo — block the edit
repo_name=$(basename "$repo_root")

cat >&2 <<MSG
BLOCKED: Cannot edit files in source repository '\${repo_name}' directly.

Use forge_develop to create an isolated session:
  forge_develop with repo="\${repo_name}"

Then edit files inside the returned sessionPath instead.
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

  // Avoid duplicate: check if we already have this guard hooked (any matcher variant)
  const existing = preToolUse.find(
    (entry) => Array.isArray(entry.hooks) &&
      (entry.hooks as Array<Record<string, unknown>>).some(
        (h) => h.type === 'command' && typeof h.command === 'string' &&
          (h.command as string).includes('guard-source-repos.sh'),
      ),
  );

  if (!existing) {
    preToolUse.push({
      matcher: 'Edit|Write|Bash',
      hooks: [
        {
          type: 'command',
          command: hookCommand,
        },
      ],
    });
  } else if (existing.matcher !== 'Edit|Write|Bash') {
    // Upgrade legacy matcher that only covered Edit|Write
    existing.matcher = 'Edit|Write|Bash';
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
