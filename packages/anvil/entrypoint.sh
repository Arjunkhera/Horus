#!/bin/bash
set -e

# ── Privilege handling ────────────────────────────────────────────────────────
# Under Docker: chown bind-mounted dirs to anvil, then drop to anvil via gosu.
# Under Podman rootless: root inside the container is already the unprivileged
# host user (user-namespace remapping), and chown on virtiofs bind mounts fails
# with EPERM. Skip chown+gosu entirely and keep running as root.
if [ "$(id -u)" = "0" ] && [ "${HORUS_RUNTIME:-docker}" != "podman" ]; then
  chown -R anvil:anvil "${ANVIL_NOTES_PATH:-/data/notes}" /home/anvil 2>/dev/null || true
  exec gosu anvil "$0" "$@"
fi

NOTES_PATH="${ANVIL_NOTES_PATH:-/data/notes}"
REPO_URL="${ANVIL_REPO_URL:-}"
SYNC_INTERVAL="${ANVIL_SYNC_INTERVAL:-300}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
HORUS_RUNTIME="${HORUS_RUNTIME:-docker}"

# Clear stale safe.directory entries left over from a previous container restart.
# Without this, --add accumulates duplicates and a subsequent plain SET fails
# with "cannot overwrite multiple values" (git exit code 5), crash-looping the
# container under restart: unless-stopped.
git config --global --unset-all safe.directory 2>/dev/null || true

# ── Podman runtime fixups ────────────────────────────────────────────────────
# Under Podman with user-namespace remapping, bind-mounted directories may be
# owned by a remapped UID. Fix ownership so the anvil user can write.
# Under Docker Desktop (macOS gRPC-FUSE), chown on bind mounts fails on
# read-only git objects — skip it entirely.
if [ "$HORUS_RUNTIME" = "podman" ]; then
  chown -R anvil:anvil /data/notes 2>/dev/null || true
  git config --global safe.directory '*'
fi

# Mark bind-mounted path as safe for git (CVE-2022-24765: ownership differs in container)
git config --global --add safe.directory "$NOTES_PATH"

# PID of the background git sync daemon (set in Step 4 if started)
SYNC_PID=""
# PID of the Anvil MCP server process
NODE_PID=""

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
# Args: ok (true|false), failures (int), last_error (JSON string or null), ahead, behind
write_sync_status() {
  local ok="$1" failures="$2" last_error="${3:-null}" ahead="${4:-0}" behind="${5:-0}"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ok":%s,"service":"anvil","consecutive_failures":%s,"last_attempt":"%s","last_error":%s,"ahead":%s,"behind":%s}\n' \
    "$ok" "$failures" "$timestamp" "$last_error" "$ahead" "$behind" \
    > /tmp/sync-status.json
}

# ── Helper function for bidirectional sync ─────────────────────────────────────
push_cycle() {
  git -C "$NOTES_PATH" add -A
  if ! git -C "$NOTES_PATH" diff --cached --quiet; then
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    git -C "$NOTES_PATH" commit -m "auto: sync $TIMESTAMP" || true
    PUSH_ERR=$(git -C "$NOTES_PATH" push 2>&1) || {
      log_err "Final push failed: ${PUSH_ERR}"
      return
    }
    log "Final push cycle complete"
  else
    log "Final push cycle: no changes to commit"
  fi
}

# ── Graceful shutdown ──────────────────────────────────────────────────────────
# Trap SIGTERM and SIGINT. Kill the background sync daemon (if running), run a
# final push cycle, and clean up the node process before the shell exits.
shutdown() {
  log "Shutdown signal received — cleaning up..."
  # Stop the sync daemon
  if [ -n "$SYNC_PID" ] && kill -0 "$SYNC_PID" 2>/dev/null; then
    log "Stopping git sync daemon (PID: $SYNC_PID)..."
    kill "$SYNC_PID"
    wait "$SYNC_PID" 2>/dev/null || true
    log "Git sync daemon stopped"
  fi
  # Final push flush before exit
  if [ -d "$NOTES_PATH/.git" ] && [ -n "$GITHUB_TOKEN" ]; then
    log "Running final push cycle before shutdown..."
    push_cycle
  fi
  # Kill the node process if running
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID"
    wait "$NODE_PID" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown SIGTERM SIGINT

# Step 1: Clone repo if ANVIL_REPO_URL is set and .git directory doesn't exist
if [ -n "$REPO_URL" ] && [ ! -d "$NOTES_PATH/.git" ]; then
  log "Cloning notes repository from $REPO_URL..."

  # Inject GitHub token into URL if provided
  if [ -n "$GITHUB_TOKEN" ]; then
    CLONE_URL=$(echo "$REPO_URL" | sed "s|https://|https://${GITHUB_TOKEN}@|")
  else
    CLONE_URL="$REPO_URL"
  fi

  git clone "$CLONE_URL" "$NOTES_PATH" || {
    log_err "Failed to clone repository"
    exit 1
  }
  log "Repository cloned successfully"
fi

# Fail-fast guard: if REPO_URL is unset and .git doesn't exist, error and exit
if [ -z "$REPO_URL" ] && [ ! -d "$NOTES_PATH/.git" ]; then
  log_err "ANVIL_REPO_URL is not set and $NOTES_PATH has no .git directory. Cannot start."
  exit 1
fi

# Step 2: Configure git for token-based auth if GITHUB_TOKEN is set
if [ -n "$GITHUB_TOKEN" ] && [ -d "$NOTES_PATH/.git" ]; then
  git -C "$NOTES_PATH" config credential.helper "store"
  echo "https://oauth2:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
fi

# Step 2.5: Set git identity for auto-commits
git -C "$NOTES_PATH" config user.email "horus@local" 2>/dev/null || true
git -C "$NOTES_PATH" config user.name "Horus Anvil Sync" 2>/dev/null || true

# Step 2.7: Bootstrap .anvil/types from defaults if _core.yaml is missing
if [ ! -f "$NOTES_PATH/.anvil/types/_core.yaml" ]; then
  log "Bootstrapping .anvil/types from defaults..."
  mkdir -p "$NOTES_PATH/.anvil/types"
  cp /app/defaults/*.yaml "$NOTES_PATH/.anvil/types/"
  log "Default types installed"
  if [ -d "$NOTES_PATH/.git" ]; then
    git -C "$NOTES_PATH" add ".anvil/types/" 2>/dev/null || true
    git -C "$NOTES_PATH" commit -m "bootstrap: add default .anvil/types" 2>/dev/null || true
    git -C "$NOTES_PATH" push 2>/dev/null || log_err "Bootstrap push failed (non-fatal)"
    log "Bootstrap committed and pushed"
  fi
fi

# Step 4: Start background git sync daemon with bidirectional sync (pull + commit + push)
# Only runs when a git repository exists (indicated by .git directory presence).
if [ -d "$NOTES_PATH/.git" ]; then
  log "Starting git sync daemon (interval: ${SYNC_INTERVAL}s)..."
  write_sync_status "true" "0" "null" "0" "0"

  (
    SYNC_FAIL_COUNT=0
    SYNC_FAIL_THRESHOLD=3

    while true; do
      sleep "$SYNC_INTERVAL"

      # ── Pull remote changes ──────────────────────────────────────────────────
      log "Running git pull..."
      # Try fast-forward first; fall back to rebase on divergence.
      PULL_ERR=$(git -C "$NOTES_PATH" pull --ff-only 2>&1)
      PULL_EXIT=$?
      if [ $PULL_EXIT -ne 0 ]; then
        log_err "git pull --ff-only failed: ${PULL_ERR}"
        log "Retrying with --rebase..."
        PULL_ERR=$(git -C "$NOTES_PATH" pull --rebase 2>&1)
        PULL_EXIT=$?
        if [ $PULL_EXIT -ne 0 ]; then
          SYNC_FAIL_COUNT=$((SYNC_FAIL_COUNT + 1))
          AHEAD=$(git -C "$NOTES_PATH" rev-list --count "@{u}..HEAD" 2>/dev/null || echo "?")
          BEHIND=$(git -C "$NOTES_PATH" rev-list --count "HEAD..@{u}" 2>/dev/null || echo "?")
          SAFE_ERR=$(echo "$PULL_ERR" | head -1 | sed 's/"/\\\"/g')
          log_err "git pull --rebase also failed: ${PULL_ERR}"
          write_sync_status "false" "$SYNC_FAIL_COUNT" "\"${SAFE_ERR}\"" "$AHEAD" "$BEHIND"
          if [ "$SYNC_FAIL_COUNT" -ge "$SYNC_FAIL_THRESHOLD" ]; then
            log_warn "SYNC STUCK: ${SYNC_FAIL_COUNT} consecutive failures — local is ${AHEAD} ahead, ${BEHIND} behind. Manual intervention may be required. Last error: ${PULL_ERR}"
          fi
          continue
        fi
      fi

      # ── Commit and push local changes ────────────────────────────────────────
      git -C "$NOTES_PATH" add -A
      if ! git -C "$NOTES_PATH" diff --cached --quiet; then
        TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        COMMIT_ERR=$(git -C "$NOTES_PATH" commit -m "auto: sync $TIMESTAMP" 2>&1) || {
          log_err "Git commit failed: ${COMMIT_ERR}"
          SYNC_FAIL_COUNT=$((SYNC_FAIL_COUNT + 1))
          SAFE_ERR=$(echo "$COMMIT_ERR" | head -1 | sed 's/"/\\\"/g')
          write_sync_status "false" "$SYNC_FAIL_COUNT" "\"${SAFE_ERR}\"" "?" "?"
          continue
        }
        PUSH_ERR=$(git -C "$NOTES_PATH" push 2>&1)
        PUSH_EXIT=$?
        if [ $PUSH_EXIT -ne 0 ]; then
          SYNC_FAIL_COUNT=$((SYNC_FAIL_COUNT + 1))
          SAFE_ERR=$(echo "$PUSH_ERR" | head -1 | sed 's/"/\\\"/g')
          log_err "Git push failed: ${PUSH_ERR}"
          write_sync_status "false" "$SYNC_FAIL_COUNT" "\"${SAFE_ERR}\"" "?" "?"
          if [ "$SYNC_FAIL_COUNT" -ge "$SYNC_FAIL_THRESHOLD" ]; then
            log_warn "SYNC STUCK: ${SYNC_FAIL_COUNT} consecutive push failures. Last error: ${PUSH_ERR}"
          fi
          continue
        fi
        log "Sync complete: committed and pushed local changes"
      else
        log "Sync complete: no local changes to commit"
      fi

      # ── Reset failure counter on a clean cycle ───────────────────────────────
      SYNC_FAIL_COUNT=0
      write_sync_status "true" "0" "null" "0" "0"

    done
  ) &

  SYNC_PID=$!
  log "Sync daemon started (PID: $SYNC_PID)"
fi

# Step 5: Start Anvil MCP server in HTTP mode.
# Run node as a background process and wait for it, allowing SIGTERM to be handled
# via the trap above.
log "Starting Anvil MCP server in HTTP mode on port ${ANVIL_PORT:-8100}..."

node /app/dist/index.js \
  --vault "$NOTES_PATH" \
  --http \
  --port "${ANVIL_PORT:-8100}" &

NODE_PID=$!
log "Anvil MCP server started (PID: $NODE_PID)"

# Wait for node process — this keeps the shell alive to handle SIGTERM
wait "$NODE_PID"
