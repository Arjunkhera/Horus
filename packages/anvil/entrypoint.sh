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

# ── Graceful shutdown ──────────────────────────────────────────────────────────
# Forward SIGTERM to the Node process which handles its own sync engine shutdown.
shutdown() {
  log "Shutdown signal received — forwarding to Node..."
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID"
    wait "$NODE_PID" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown SIGTERM SIGINT

# Returns 0 if $NOTES_PATH holds a healthy git repo with at least one commit
# (a real HEAD), non-zero otherwise. A bare `.git` directory left behind by a
# clone that failed mid-transfer (502 / GnuTLS / "HTTP/2 stream not closed
# cleanly") has no HEAD — treating it as "already cloned" is what permanently
# stranded sync. This lets us distinguish "no repo" from "corrupt/partial repo".
repo_has_commit() {
  [ -d "$NOTES_PATH/.git" ] && \
    git -C "$NOTES_PATH" rev-parse --verify -q HEAD >/dev/null 2>&1
}

# Step 1: Clone repo if ANVIL_REPO_URL is set and we don't already have a
# healthy repo (real HEAD). Retries with bounded backoff so a transient network
# blip (502 / DNS flap / GnuTLS recv error) doesn't permanently strand sync.
if [ -n "$REPO_URL" ] && ! repo_has_commit; then
  # A partial/incomplete .git from a previously-failed clone would make
  # `git clone` refuse ("destination path already exists and is not empty").
  # Clear only a HEAD-less .git so the retry can start clean; never touch a
  # repo that already has commits.
  if [ -d "$NOTES_PATH/.git" ]; then
    log_warn "Found a .git directory with no commits at $NOTES_PATH — removing partial clone before retrying."
    rm -rf "$NOTES_PATH/.git"
  fi

  log "Cloning notes repository from $REPO_URL..."

  # Inject GitHub token into URL if provided
  if [ -n "$GITHUB_TOKEN" ]; then
    CLONE_URL=$(echo "$REPO_URL" | sed "s|https://|https://${GITHUB_TOKEN}@|")
  else
    CLONE_URL="$REPO_URL"
  fi

  CLONE_MAX_ATTEMPTS="${ANVIL_CLONE_MAX_ATTEMPTS:-5}"
  clone_ok=""
  attempt=1
  backoff=5
  while [ "$attempt" -le "$CLONE_MAX_ATTEMPTS" ]; do
    if git clone "$CLONE_URL" "$NOTES_PATH"; then
      clone_ok="yes"
      break
    fi
    # Clean up whatever the failed attempt left behind so the next attempt
    # (and the local-first fallback below) start from a clean slate.
    rm -rf "$NOTES_PATH/.git"
    if [ "$attempt" -lt "$CLONE_MAX_ATTEMPTS" ]; then
      log_warn "Clone attempt $attempt/$CLONE_MAX_ATTEMPTS failed — retrying in ${backoff}s..."
      sleep "$backoff"
      backoff=$((backoff * 2))
      [ "$backoff" -gt 60 ] && backoff=60
    fi
    attempt=$((attempt + 1))
  done

  if [ -n "$clone_ok" ]; then
    log "Repository cloned successfully"
  else
    # Do NOT exit 1 and crash-loop the container. Fall through to the
    # local-first init below so Anvil still starts; the in-process sync engine
    # will (re)establish the remote once the network recovers.
    log_err "Failed to clone repository after $CLONE_MAX_ATTEMPTS attempts — starting local-first; sync will retry once the remote is reachable."
  fi
fi

# Local-first fallback: if we still don't have a healthy repo, initialize a
# local-only notes repo so the client works out-of-the-box.
# This covers both the no-remote-configured case AND a configured remote whose
# clone could not complete (network down). An initial commit is created so the
# repo has a real HEAD — a HEAD-less repo makes the push engine unable to push
# and leaves sync silently stuck (the reported bug).
if ! repo_has_commit; then
  if [ -z "$REPO_URL" ]; then
    log "No ANVIL_REPO_URL and no existing repo at $NOTES_PATH — initializing a local-only notes repo."
  fi
  mkdir -p "$NOTES_PATH"
  git config --global --add safe.directory "$NOTES_PATH" 2>/dev/null || true
  if [ ! -d "$NOTES_PATH/.git" ]; then
    git -C "$NOTES_PATH" init -q || {
      log_err "Failed to initialize local notes repository at $NOTES_PATH"
      exit 1
    }
  fi
  # Set identity before the initial commit so it doesn't fail with
  # "Please tell me who you are".
  git -C "$NOTES_PATH" config user.email "horus@local" 2>/dev/null || true
  git -C "$NOTES_PATH" config user.name "Horus Anvil Sync" 2>/dev/null || true
  # Create an initial commit so the repo has a HEAD. Without this the branch is
  # unborn, the push engine has nothing to push against, and sync stays stuck.
  if ! git -C "$NOTES_PATH" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    touch "$NOTES_PATH/.gitkeep"
    git -C "$NOTES_PATH" add .gitkeep 2>/dev/null || true
    git -C "$NOTES_PATH" commit -q -m "bootstrap: initialize notes repository" 2>/dev/null \
      || log_warn "Initial bootstrap commit failed (non-fatal) — sync engine will retry."
  fi
  # If a remote was configured but the clone failed, wire it up so the sync
  # engine can push/pull to it once the network recovers.
  if [ -n "$REPO_URL" ] && ! git -C "$NOTES_PATH" remote get-url origin >/dev/null 2>&1; then
    git -C "$NOTES_PATH" remote add origin "$REPO_URL" 2>/dev/null \
      || log_warn "Could not add origin remote (non-fatal)."
  fi
fi

# Step 2: Configure git for token-based auth if GITHUB_TOKEN is set
if [ -n "$GITHUB_TOKEN" ] && [ -d "$NOTES_PATH/.git" ]; then
  git -C "$NOTES_PATH" config credential.helper "store"
  # Derive the host from $REPO_URL so ongoing fetch/push works for any host
  # (e.g. GitHub Enterprise like github.example.com), not just github.com.
  # Hardcoding github.com here meant the initial clone succeeded but every
  # subsequent pull failed for non-github.com hosts ("could not read Username").
  REPO_HOST=$(echo "$REPO_URL" | sed -E 's#https?://([^/]+)/.*#\1#')
  : > ~/.git-credentials
  if [ -n "$REPO_HOST" ]; then
    echo "https://oauth2:${GITHUB_TOKEN}@${REPO_HOST}" >> ~/.git-credentials
  fi
  # Keep github.com for back-compat (no-op when REPO_HOST already is github.com).
  if [ "$REPO_HOST" != "github.com" ]; then
    echo "https://oauth2:${GITHUB_TOKEN}@github.com" >> ~/.git-credentials
  fi
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

# Step 2.8: Sync default types on every startup.
# The bootstrap above is first-run only. On subsequent deploys, updated type
# schemas in /app/defaults/ must propagate to .anvil/types/. This is safe:
# - .anvil/types/ holds image defaults (built-in types are read-only at runtime)
# - custom types live in custom-types/ (untouched)
# - plugin types live in .anvil/plugins/*/types/ (untouched)
if [ -f "$NOTES_PATH/.anvil/types/_core.yaml" ] && [ -d /app/defaults ]; then
  cp /app/defaults/*.yaml "$NOTES_PATH/.anvil/types/"
  if [ -d "$NOTES_PATH/.git" ]; then
    git -C "$NOTES_PATH" add ".anvil/types/" 2>/dev/null || true
    if ! git -C "$NOTES_PATH" diff --cached --quiet 2>/dev/null; then
      log "Default types updated — committing changes..."
      git -C "$NOTES_PATH" commit -m "chore: sync default types from image" 2>/dev/null || true
      git -C "$NOTES_PATH" push 2>/dev/null || log_err "Type sync push failed (non-fatal)"
      log "Type sync committed and pushed"
    fi
  fi
fi

# Step 3: Ensure .gitignore excludes .anvil/.local/ (local-only derived data).
# This covers repos cloned before the gitignore was set up, or repos where
# index.db was accidentally committed — prevents the sync engine from seeing
# perpetual pendingFiles and reporting health as critical.
GITIGNORE_PATH="$NOTES_PATH/.gitignore"
if [ -d "$NOTES_PATH/.git" ]; then
  # Add .anvil/.local/ to .gitignore if not already present
  if ! grep -qF '.anvil/.local/' "$GITIGNORE_PATH" 2>/dev/null; then
    echo '.anvil/.local/' >> "$GITIGNORE_PATH"
    git -C "$NOTES_PATH" add .gitignore 2>/dev/null || true
    git -C "$NOTES_PATH" commit -m "chore: ensure .anvil/.local/ is gitignored" 2>/dev/null || true
    git -C "$NOTES_PATH" push 2>/dev/null || log_warn "Gitignore push failed (non-fatal)"
    log "Added .anvil/.local/ to .gitignore"
  fi

  # Untrack .anvil/.local/ files if they were previously committed
  if git -C "$NOTES_PATH" ls-files --error-unmatch .anvil/.local/ >/dev/null 2>&1; then
    git -C "$NOTES_PATH" rm -r --cached .anvil/.local/ 2>/dev/null || true
    git -C "$NOTES_PATH" commit -m "fix: untrack .anvil/.local/ (should be gitignored)" 2>/dev/null || true
    git -C "$NOTES_PATH" push 2>/dev/null || log_warn "Untrack push failed (non-fatal)"
    log "Untracked .anvil/.local/ from git"
  fi
fi

# Step 4: Start Anvil MCP server in HTTP mode.
# Git sync is now handled in-process by GitSyncEngine (packages/anvil/src/core/sync/engine.ts).
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
