"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRAPPER_PATH = void 0;
exports.updateClaudeMcpServers = updateClaudeMcpServers;
exports.emitPreToolUseHook = emitPreToolUseHook;
exports.updateCursorMcpServers = updateCursorMcpServers;
exports.emitMcpRemoteWrapper = emitMcpRemoteWrapper;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
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
async function updateClaudeMcpServers(servers, workspacePath, _hostWorkspacePath, claudePermissions) {
    if (servers.length === 0)
        return;
    const claudeDir = path_1.default.join(workspacePath, '.claude');
    await fs_1.promises.mkdir(claudeDir, { recursive: true });
    const configAllow = claudePermissions?.allow ?? ['mcp__*__*'];
    const configDeny = claudePermissions?.deny ?? [];
    const configDefaultMode = claudePermissions?.defaultMode;
    // --- settings.local.json: MCP server URLs + permissions (machine-specific) ---
    const localSettingsPath = path_1.default.join(claudeDir, 'settings.local.json');
    let localSettings = {};
    try {
        const raw = await fs_1.promises.readFile(localSettingsPath, 'utf-8');
        localSettings = JSON.parse(raw);
    }
    catch {
        // File absent or unparseable — start fresh.
    }
    // Merge: add/overwrite only the servers Forge knows about; leave others intact.
    const mcpServers = localSettings.mcpServers ?? {};
    for (const { name, url } of servers) {
        // Append /mcp to the base URL for the Streamable HTTP endpoint.
        const mcpUrl = url.replace(/\/+$/, '') + '/mcp';
        mcpServers[name] = { type: 'http', url: mcpUrl };
    }
    localSettings.mcpServers = mcpServers;
    const localPermissions = localSettings.permissions ?? {};
    const localAllow = Array.isArray(localPermissions.allow) ? localPermissions.allow : [];
    for (const entry of configAllow) {
        if (!localAllow.includes(entry))
            localAllow.push(entry);
    }
    localPermissions.allow = localAllow;
    if (configDeny.length > 0) {
        const localDeny = Array.isArray(localPermissions.deny) ? localPermissions.deny : [];
        for (const entry of configDeny) {
            if (!localDeny.includes(entry))
                localDeny.push(entry);
        }
        localPermissions.deny = localDeny;
    }
    if (configDefaultMode) {
        localPermissions.defaultMode = configDefaultMode;
    }
    localSettings.permissions = localPermissions;
    await fs_1.promises.writeFile(localSettingsPath, JSON.stringify(localSettings, null, 2) + '\n', 'utf-8');
    // --- settings.json: permissions only (project-level, shared) ---
    // MCP server URLs and hooks are NOT written here — they are machine-specific.
    const sharedSettingsPath = path_1.default.join(claudeDir, 'settings.json');
    let sharedSettings = {};
    try {
        const raw = await fs_1.promises.readFile(sharedSettingsPath, 'utf-8');
        sharedSettings = JSON.parse(raw);
    }
    catch {
        // File absent or unparseable — start fresh.
    }
    const sharedPermissions = sharedSettings.permissions ?? {};
    const sharedAllow = Array.isArray(sharedPermissions.allow) ? sharedPermissions.allow : [];
    for (const entry of configAllow) {
        if (!sharedAllow.includes(entry))
            sharedAllow.push(entry);
    }
    sharedPermissions.allow = sharedAllow;
    if (configDeny.length > 0) {
        const sharedDeny = Array.isArray(sharedPermissions.deny) ? sharedPermissions.deny : [];
        for (const entry of configDeny) {
            if (!sharedDeny.includes(entry))
                sharedDeny.push(entry);
        }
        sharedPermissions.deny = sharedDeny;
    }
    if (configDefaultMode) {
        sharedPermissions.defaultMode = configDefaultMode;
    }
    sharedSettings.permissions = sharedPermissions;
    await fs_1.promises.writeFile(sharedSettingsPath, JSON.stringify(sharedSettings, null, 2) + '\n', 'utf-8');
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
async function emitPreToolUseHook(workspacePath, hostWorkspacePath) {
    // 1. Write the guard script — fully generic, no user-specific paths
    const scriptsDir = path_1.default.join(workspacePath, '.claude', 'scripts');
    await fs_1.promises.mkdir(scriptsDir, { recursive: true });
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
    const scriptPath = path_1.default.join(scriptsDir, 'guard-source-repos.sh');
    await fs_1.promises.writeFile(scriptPath, guardScript, { mode: 0o755 });
    // 2. Merge the PreToolUse hook into .claude/settings.local.json
    const settingsPath = path_1.default.join(workspacePath, '.claude', 'settings.local.json');
    let settings = {};
    try {
        const raw = await fs_1.promises.readFile(settingsPath, 'utf-8');
        settings = JSON.parse(raw);
    }
    catch {
        // File absent or unparseable — start fresh.
    }
    // Derive HORUS_DATA_DIR from the workspace path ($DATA_DIR/workspaces/$ID)
    // and pass it explicitly so the guard script uses the correct value regardless
    // of the user's environment (avoids the wrong $HOME/.horus/data default).
    const horusDataDir = path_1.default.dirname(path_1.default.dirname(hostWorkspacePath));
    const hookCommand = `HORUS_DATA_DIR=${JSON.stringify(horusDataDir)} bash ${hostWorkspacePath}/.claude/scripts/guard-source-repos.sh`;
    const hooks = settings.hooks ?? {};
    const preToolUse = hooks.PreToolUse ?? [];
    // Avoid duplicate: check if we already have this matcher
    const existing = preToolUse.find((entry) => entry.matcher === 'Edit|Write' && Array.isArray(entry.hooks) &&
        entry.hooks.some((h) => h.type === 'command' && typeof h.command === 'string' &&
            h.command.includes('guard-source-repos.sh')));
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
    await fs_1.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
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
async function updateCursorMcpServers(servers, workspacePath) {
    if (servers.length === 0)
        return;
    const settingsPath = path_1.default.join(workspacePath, '.cursor', 'mcp.json');
    let settings = {};
    try {
        const raw = await fs_1.promises.readFile(settingsPath, 'utf-8');
        settings = JSON.parse(raw);
    }
    catch {
        // File absent or unparseable — start fresh.
    }
    const mcpServers = settings.mcpServers ?? {};
    for (const { name, url } of servers) {
        const mcpUrl = url.replace(/\/+$/, '') + '/mcp';
        mcpServers[name] = { url: mcpUrl };
    }
    settings.mcpServers = mcpServers;
    await fs_1.promises.mkdir(path_1.default.dirname(settingsPath), { recursive: true });
    await fs_1.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
/**
 * @deprecated No longer needed — native HTTP transport eliminates mcp-remote.
 * Retained to avoid breaking any code that imports this function.
 */
async function emitMcpRemoteWrapper(workspacePath) {
    return path_1.default.join(workspacePath, '.claude', 'bin', 'mcp-remote-wrapper');
}
/**
 * @deprecated Use updateClaudeMcpServers with explicit workspacePath and hostWorkspacePath.
 * Retained as a no-op shim to avoid breaking any code that imports WRAPPER_PATH.
 */
exports.WRAPPER_PATH = '';
//# sourceMappingURL=mcp-settings-writer.js.map