#!/bin/bash
set -e

FORGE_PORT="${FORGE_PORT:-8200}"
FORGE_HOST="${FORGE_HOST:-0.0.0.0}"
REGISTRY_PATH="${FORGE_REGISTRY_PATH:-/data/registry}"
WORKSPACES_PATH="${FORGE_WORKSPACES_PATH:-/data/workspaces}"
ANVIL_URL="${FORGE_ANVIL_URL:-http://anvil:8100}"
VAULT_URL="${FORGE_VAULT_URL:-http://vault:8000}"
CONFIG_DIR="${FORGE_CONFIG_PATH:-/data/config}"
export FORGE_CONFIG_PATH="${CONFIG_DIR}"
FORGE_REGISTRY_REPO_URL="${FORGE_REGISTRY_REPO_URL:-}"
FORGE_SYNC_INTERVAL="${FORGE_SYNC_INTERVAL:-300}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
PULL_PID=""
NODE_PID=""

# Host-facing values — set these when Forge runs in Docker so workspace creator
# can emit correct absolute paths into .claude/settings.local.json for Claude Code on the host.
FORGE_HOST_WORKSPACES_PATH="${FORGE_HOST_WORKSPACES_PATH:-}"
FORGE_HOST_ANVIL_URL="${FORGE_HOST_ANVIL_URL:-}"
FORGE_HOST_VAULT_URL="${FORGE_HOST_VAULT_URL:-}"
FORGE_HOST_FORGE_URL="${FORGE_HOST_FORGE_URL:-}"

# Colon-separated list of paths to scan for git repos, e.g. /data/repos:/data/extra
FORGE_SCAN_PATHS="${FORGE_SCAN_PATHS:-}"
# Host-side path that corresponds to the first scan path (Docker only).
# When set, localPath in repo results is translated from the container path
# to the host path so Claude Code on the host can access repos directly.
FORGE_HOST_REPOS_PATH="${FORGE_HOST_REPOS_PATH:-}"
# Host-side path for the managed repos pool (Docker only).
# Used to rewrite .git worktree pointers so git works from the host.
FORGE_HOST_MANAGED_REPOS_PATH="${FORGE_HOST_MANAGED_REPOS_PATH:-}"

# Sessions and managed-repo-pool paths — derived from WORKSPACES_PATH unless overridden.
# WORKSPACES_PATH is e.g. /data/workspaces, so _DATA_ROOT is /data.
_DATA_ROOT="$(dirname "${WORKSPACES_PATH}")"
SESSIONS_ROOT="${FORGE_SESSIONS_ROOT:-${_DATA_ROOT}/sessions}"
MANAGED_REPOS_PATH="${FORGE_MANAGED_REPOS_PATH:-${_DATA_ROOT}/repos}"
SESSIONS_STORE_PATH="${CONFIG_DIR}/sessions.json"

log() {
  echo "{\"level\":\"info\",\"message\":\"$1\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >&2
}

log_err() {
  echo "{\"level\":\"error\",\"message\":\"$1\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >&2
}

log_warn() {
  echo "{\"level\":\"warn\",\"message\":\"$1\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >&2
}

# Write sync status to /tmp/sync-status.json — polled by the /health endpoint.
write_sync_status() {
  local ok="$1" failures="$2" last_error="${3:-null}" ahead="${4:-0}" behind="${5:-0}"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ok":%s,"service":"forge","consecutive_failures":%s,"last_attempt":"%s","last_error":%s,"ahead":%s,"behind":%s}\n' \
    "$ok" "$failures" "$timestamp" "$last_error" "$ahead" "$behind" \
    > /tmp/sync-status.json
}

# SIGTERM handler right after the log functions
shutdown() {
  log "Shutdown signal received — cleaning up..."
  if [ -n "$PULL_PID" ] && kill -0 "$PULL_PID" 2>/dev/null; then
    kill "$PULL_PID"
    wait "$PULL_PID" 2>/dev/null || true
    log "Pull daemon stopped"
  fi
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID"
    wait "$NODE_PID" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown SIGTERM SIGINT

# Step 1: Ensure config directory and new data directories exist
mkdir -p "${CONFIG_DIR}"
mkdir -p "${WORKSPACES_PATH}"
# Create new managed data directories (repos pool, sessions, test environments)
mkdir -p "${MANAGED_REPOS_PATH}"
mkdir -p "$(dirname "${WORKSPACES_PATH}")/sessions"
mkdir -p "$(dirname "${WORKSPACES_PATH}")/test-env"

# Step 1b: Mark all directories as git-safe.
# Bind-mounted volumes in containers (Podman/Docker) are owned by the host UID,
# which differs from the container UID. Git 2.35.2+ rejects such repos unless
# safe.directory is configured. The wildcard '*' covers all paths including
# nested subdirectories (e.g. /data/repos/ArjunKhera/Horus) that path-specific
# globs would miss.
git config --global --add safe.directory '*'

# Step 2: One-time auto-migration from legacy ~/.forge/ if new config doesn't exist yet.
# Copies repos.json and workspaces.json from the old location to the new config dir.
LEGACY_FORGE_DIR="${HOME}/.forge"
if [ -d "${LEGACY_FORGE_DIR}" ] && [ ! -f "${CONFIG_DIR}/forge.yaml" ]; then
  log "Migrating legacy Forge config from ${LEGACY_FORGE_DIR} to ${CONFIG_DIR}..."
  [ -f "${LEGACY_FORGE_DIR}/repos.json" ] && cp "${LEGACY_FORGE_DIR}/repos.json" "${CONFIG_DIR}/repos.json" && log "  Migrated repos.json"
  [ -f "${LEGACY_FORGE_DIR}/workspaces.json" ] && cp "${LEGACY_FORGE_DIR}/workspaces.json" "${CONFIG_DIR}/workspaces.json" && log "  Migrated workspaces.json"
  log "Migration complete. Old ~/.forge/ directory preserved for safety."
fi

# Step 3: Write ~/Horus/data/config/forge.yaml from environment variables.
# This runs every startup so env var overrides always win (CLI > env > config > defaults).
log "Writing Forge global config to ${CONFIG_DIR}/forge.yaml..."

# Build optional host_endpoints block only when env vars are provided
HOST_ENDPOINTS_BLOCK=""
if [ -n "$FORGE_HOST_ANVIL_URL" ] || [ -n "$FORGE_HOST_VAULT_URL" ] || [ -n "$FORGE_HOST_FORGE_URL" ]; then
  HOST_ENDPOINTS_BLOCK="
host_endpoints:"
  [ -n "$FORGE_HOST_ANVIL_URL" ]  && HOST_ENDPOINTS_BLOCK="${HOST_ENDPOINTS_BLOCK}
  anvil: ${FORGE_HOST_ANVIL_URL}"
  [ -n "$FORGE_HOST_VAULT_URL" ]  && HOST_ENDPOINTS_BLOCK="${HOST_ENDPOINTS_BLOCK}
  vault: ${FORGE_HOST_VAULT_URL}"
  [ -n "$FORGE_HOST_FORGE_URL" ]  && HOST_ENDPOINTS_BLOCK="${HOST_ENDPOINTS_BLOCK}
  forge: ${FORGE_HOST_FORGE_URL}"
fi

# Build optional host_workspaces_path line
HOST_WORKSPACES_LINE=""
[ -n "$FORGE_HOST_WORKSPACES_PATH" ] && HOST_WORKSPACES_LINE="
  host_workspaces_path: ${FORGE_HOST_WORKSPACES_PATH}"

# Build scan_paths YAML value — inline list if paths provided, else empty array
SCAN_PATHS_YAML="[]"
if [ -n "$FORGE_SCAN_PATHS" ]; then
  SCAN_PATHS_YAML=""
  IFS=':' read -ra _scan_paths <<< "$FORGE_SCAN_PATHS"
  for _p in "${_scan_paths[@]}"; do
    SCAN_PATHS_YAML="${SCAN_PATHS_YAML}
    - ${_p}"
  done
fi

# Build optional host_repos_path line
HOST_REPOS_PATH_LINE=""
[ -n "$FORGE_HOST_REPOS_PATH" ] && HOST_REPOS_PATH_LINE="
  host_repos_path: ${FORGE_HOST_REPOS_PATH}"

# Build optional host_managed_repos_path line
HOST_MANAGED_REPOS_PATH_LINE=""
[ -n "$FORGE_HOST_MANAGED_REPOS_PATH" ] && HOST_MANAGED_REPOS_PATH_LINE="
  host_managed_repos_path: ${FORGE_HOST_MANAGED_REPOS_PATH}"

cat > "${CONFIG_DIR}/forge.yaml" << EOF
registries:
  - type: filesystem
    name: default
    path: ${REGISTRY_PATH}

workspace:
  mount_path: ${WORKSPACES_PATH}
  default_config: sdlc-default
  retention_days: 30
  store_path: ${CONFIG_DIR}/workspaces.json
  sessions_path: ${SESSIONS_STORE_PATH}
  sessions_root: ${SESSIONS_ROOT}
  managed_repos_path: ${MANAGED_REPOS_PATH}${HOST_WORKSPACES_LINE}${HOST_MANAGED_REPOS_PATH_LINE}

mcp_endpoints:
  anvil:
    url: ${ANVIL_URL}
    transport: http
  vault:
    url: ${VAULT_URL}
    transport: http
${HOST_ENDPOINTS_BLOCK}
repos:
  scan_paths: ${SCAN_PATHS_YAML}
  index_path: ${CONFIG_DIR}/repos.json${HOST_REPOS_PATH_LINE}
EOF

log "Config written to ${CONFIG_DIR}/forge.yaml. Registry: ${REGISTRY_PATH}, Anvil: ${ANVIL_URL}, Vault: ${VAULT_URL}"

# Step 4: Clone registry repo if not already present
if [ -z "$FORGE_REGISTRY_REPO_URL" ] && [ ! -d "${REGISTRY_PATH}/.git" ]; then
  log_err "FORGE_REGISTRY_REPO_URL is not set and ${REGISTRY_PATH} has no .git directory. Cannot start."
  exit 1
fi

if [ -n "$FORGE_REGISTRY_REPO_URL" ] && [ ! -d "${REGISTRY_PATH}/.git" ]; then
  log "Cloning Forge registry from $FORGE_REGISTRY_REPO_URL..."
  if [ -n "$GITHUB_TOKEN" ]; then
    CLONE_URL=$(echo "$FORGE_REGISTRY_REPO_URL" | sed "s|https://|https://${GITHUB_TOKEN}@|")
  else
    CLONE_URL="$FORGE_REGISTRY_REPO_URL"
  fi
  git clone "$CLONE_URL" "${REGISTRY_PATH}" || {
    log_err "Failed to clone registry"
    exit 1
  }
  log "Registry cloned successfully"
fi

# Step 5: Verify the registry path exists (volume should be mounted)
if [ ! -d "${REGISTRY_PATH}" ]; then
  log_err "Registry path '${REGISTRY_PATH}' does not exist. Ensure the volume is mounted."
  exit 1
fi

# Step 6: Start background pull daemon for registry
# (workspaces dir already created in Step 1)
if [ -d "${REGISTRY_PATH}/.git" ]; then
  log "Starting registry pull daemon (interval: ${FORGE_SYNC_INTERVAL}s)..."
  write_sync_status "true" "0" "null" "0" "0"

  (
    SYNC_FAIL_COUNT=0
    SYNC_FAIL_THRESHOLD=3

    while true; do
      sleep "$FORGE_SYNC_INTERVAL"
      log "Running registry git pull..."

      # Try fast-forward first; fall back to rebase on divergence.
      PULL_ERR=$(git -C "${REGISTRY_PATH}" pull --ff-only 2>&1)
      PULL_EXIT=$?
      if [ $PULL_EXIT -ne 0 ]; then
        log_err "Registry git pull --ff-only failed: ${PULL_ERR}"
        log "Retrying with --rebase..."
        PULL_ERR=$(git -C "${REGISTRY_PATH}" pull --rebase 2>&1)
        PULL_EXIT=$?
        if [ $PULL_EXIT -ne 0 ]; then
          SYNC_FAIL_COUNT=$((SYNC_FAIL_COUNT + 1))
          AHEAD=$(git -C "${REGISTRY_PATH}" rev-list --count "@{u}..HEAD" 2>/dev/null || echo "?")
          BEHIND=$(git -C "${REGISTRY_PATH}" rev-list --count "HEAD..@{u}" 2>/dev/null || echo "?")
          SAFE_ERR=$(echo "$PULL_ERR" | head -1 | sed 's/"/\\\"/g')
          log_err "Registry git pull --rebase also failed: ${PULL_ERR}"
          write_sync_status "false" "$SYNC_FAIL_COUNT" "\"${SAFE_ERR}\"" "$AHEAD" "$BEHIND"
          if [ "$SYNC_FAIL_COUNT" -ge "$SYNC_FAIL_THRESHOLD" ]; then
            log_warn "REGISTRY SYNC STUCK: ${SYNC_FAIL_COUNT} consecutive failures — local is ${AHEAD} ahead, ${BEHIND} behind. Manual intervention may be required. Last error: ${PULL_ERR}"
          fi
          continue
        fi
      fi

      SYNC_FAIL_COUNT=0
      write_sync_status "true" "0" "null" "0" "0"
      log "Registry sync complete"
    done
  ) &
  PULL_PID=$!
  log "Registry pull daemon started (PID: $PULL_PID)"
fi

# Step 7: Install horus-core plugin globally
log "Installing horus-core plugin globally..."
node /app/packages/cli/dist/index.js global install plugin:horus-core 2>&1 || {
  log_err "horus-core global install failed (non-fatal, continuing)"
}
log "horus-core plugin installed"

# Step 8: Start the Forge MCP server in HTTP mode
log "Starting Forge MCP server in HTTP mode on ${FORGE_HOST}:${FORGE_PORT}..."

export FORGE_WORKSPACE_PATH=/data/workspaces

node /app/packages/cli/dist/index.js serve \
  --transport http \
  --port "${FORGE_PORT}" \
  --host "${FORGE_HOST}" &

NODE_PID=$!
log "Forge MCP server started (PID: $NODE_PID)"

wait "$NODE_PID"
