#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Horus Update Script
#
# Pulls latest changes from all Horus repos and selectively rebuilds only
# the Docker services whose source actually changed.
#
# Usage:
#   bash update.sh              # pull + selective rebuild
#   bash update.sh --force      # pull + rebuild everything
#   bash update.sh --dry-run    # show what would be rebuilt, don't do it
#   bash update.sh --skip-pull  # skip git pull, just rebuild changed (useful
#                               #   if you pulled manually or made local changes)
# ---------------------------------------------------------------------------
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FORGE_CONTAINER="horus-forge-1"
CLAUDE_DIR="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_DIR}/skills"
CLAUDE_MD="${CLAUDE_DIR}/CLAUDE.md"
STATE_FILE="${SCRIPT_DIR}/.horus-build-state"

# -- Flags -------------------------------------------------------------------
FORCE=false
DRY_RUN=false
SKIP_PULL=false

for arg in "$@"; do
  case "$arg" in
    --force)     FORCE=true ;;
    --dry-run)   DRY_RUN=true ;;
    --skip-pull) SKIP_PULL=true ;;
    --help|-h)
      sed -n '2,/^# ---/p' "$0" | sed '$d' | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# -- Helpers -----------------------------------------------------------------
log()     { echo "  $1"; }
success() { echo "  + $1"; }
warn()    { echo "  ! $1" >&2; }
fail()    { echo "  x $1" >&2; exit 1; }
header()  { echo ""; echo "$1"; }

get_sha() { git -C "$1" rev-parse HEAD 2>/dev/null || echo ""; }

# Read/write last-built SHA from state file. Format: one "REPO=SHA" per line.
get_built_sha() {
  local repo="$1"
  if [ -f "$STATE_FILE" ]; then
    grep "^${repo}=" "$STATE_FILE" 2>/dev/null | cut -d= -f2 || echo ""
  else
    echo ""
  fi
}

save_built_shas() {
  cat > "$STATE_FILE" <<EOF
Horus=$(get_sha "$SCRIPT_DIR")
Anvil=$(get_sha "${REPOS_DIR}/Anvil")
Vault=$(get_sha "${REPOS_DIR}/Vault")
Forge=$(get_sha "${REPOS_DIR}/Forge")
EOF
}

# Pull a repo. Sets PULL_RESULT to "changed" or "unchanged".
# Sets PULL_MSG to a human-readable message.
pull_repo() {
  local name="$1" path="$2"
  PULL_RESULT="unchanged"

  if [ ! -d "$path/.git" ]; then
    PULL_MSG="not a git repo, skipping"
    return
  fi

  local current_sha
  current_sha=$(get_sha "$path")
  local built_sha
  built_sha=$(get_built_sha "$name")

  if $SKIP_PULL; then
    # Compare current HEAD against last-built SHA
    if [ -n "$built_sha" ] && [ "$built_sha" != "$current_sha" ]; then
      local count
      count=$(git -C "$path" rev-list --count "${built_sha}..${current_sha}" 2>/dev/null || echo "?")
      PULL_MSG="${count} new commit(s) since last build"
      PULL_RESULT="changed"
    else
      PULL_MSG="unchanged since last build"
    fi
    return
  fi

  local output
  if ! output=$(git -C "$path" pull --ff-only 2>&1); then
    warn "${name}: pull failed - ${output}"
    PULL_MSG="pull failed"
    return
  fi

  local new_sha
  new_sha=$(get_sha "$path")

  # Compare against last-built SHA if available, otherwise against pre-pull SHA
  local compare_sha="${built_sha:-$current_sha}"

  if [ "$compare_sha" = "$new_sha" ]; then
    PULL_MSG="already up to date"
    return
  fi

  local count
  count=$(git -C "$path" rev-list --count "${compare_sha}..${new_sha}" 2>/dev/null || echo "?")
  PULL_MSG="${count} new commit(s)"
  PULL_RESULT="changed"
}

# Check if a subdirectory changed between two SHAs in a repo.
subdir_changed() {
  local repo_path="$1" subdir="$2" old_sha="$3" new_sha="$4"
  [ -z "$old_sha" ] || [ -z "$new_sha" ] && return 0
  [ "$old_sha" = "$new_sha" ] && return 1
  git -C "$repo_path" diff --quiet "${old_sha}..${new_sha}" -- "$subdir" 2>/dev/null && return 1
  return 0
}

# Wait for a container to become healthy.
wait_healthy() {
  local container="$1" label="$2" timeout="${3:-120}"
  local elapsed=0
  until docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null | grep -q "healthy"; do
    if [ $elapsed -ge $timeout ]; then
      warn "${label} did not become healthy within ${timeout}s. Check: docker compose logs ${label}"
      return 1
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  success "${label} healthy"
}

# Rebuild a set of services and wait for each to be healthy.
rebuild_and_wait() {
  [ $# -eq 0 ] && return
  log "Building: $*"
  docker compose up --build -d "$@"
  for svc in "$@"; do
    wait_healthy "horus-${svc}-1" "$svc" 600
  done
}

# Check if a value is in a space-separated list.
list_contains() {
  local list="$1" item="$2"
  case " $list " in
    *" $item "*) return 0 ;;
    *) return 1 ;;
  esac
}

# -- Phase 1: Pull ----------------------------------------------------------
header "Horus Update"
echo "--------------------------------------"
header "Pulling repos..."

# Use last-built SHAs if available, otherwise current HEAD (first run)
HORUS_BUILT=$(get_built_sha "Horus")
ANVIL_BUILT=$(get_built_sha "Anvil")
VAULT_BUILT=$(get_built_sha "Vault")
FORGE_BUILT=$(get_built_sha "Forge")

HORUS_OLD_SHA="${HORUS_BUILT:-$(get_sha "$SCRIPT_DIR")}"
ANVIL_OLD_SHA="${ANVIL_BUILT:-$(get_sha "${REPOS_DIR}/Anvil")}"
VAULT_OLD_SHA="${VAULT_BUILT:-$(get_sha "${REPOS_DIR}/Vault")}"
FORGE_OLD_SHA="${FORGE_BUILT:-$(get_sha "${REPOS_DIR}/Forge")}"

HORUS_CHANGED=false
ANVIL_CHANGED=false
VAULT_CHANGED=false
FORGE_CHANGED=false

pull_repo "Horus" "$SCRIPT_DIR"
[ "$PULL_RESULT" = "changed" ] && HORUS_CHANGED=true
[ "$PULL_RESULT" = "changed" ] && success "Horus: ${PULL_MSG}" || log "Horus: ${PULL_MSG}"

pull_repo "Anvil" "${REPOS_DIR}/Anvil"
[ "$PULL_RESULT" = "changed" ] && ANVIL_CHANGED=true
[ "$PULL_RESULT" = "changed" ] && success "Anvil: ${PULL_MSG}" || log "Anvil: ${PULL_MSG}"

pull_repo "Vault" "${REPOS_DIR}/Vault"
[ "$PULL_RESULT" = "changed" ] && VAULT_CHANGED=true
[ "$PULL_RESULT" = "changed" ] && success "Vault: ${PULL_MSG}" || log "Vault: ${PULL_MSG}"

pull_repo "Forge" "${REPOS_DIR}/Forge"
[ "$PULL_RESULT" = "changed" ] && FORGE_CHANGED=true
[ "$PULL_RESULT" = "changed" ] && success "Forge: ${PULL_MSG}" || log "Forge: ${PULL_MSG}"

# -- Phase 2: Map changes to services ---------------------------------------
REBUILD=""

if $FORCE; then
  REBUILD="anvil vault vault-mcp forge"
  header "Force mode: rebuilding all services"
else
  # Horus repo changes
  if $HORUS_CHANGED; then
    horus_new=$(get_sha "$SCRIPT_DIR")

    if subdir_changed "$SCRIPT_DIR" "docker-compose.yml" "$HORUS_OLD_SHA" "$horus_new"; then
      # Compose file changed — rebuild everything
      REBUILD="anvil vault vault-mcp forge"
    else
      # Check individual package subdirs
      if subdir_changed "$SCRIPT_DIR" "packages/anvil" "$HORUS_OLD_SHA" "$horus_new"; then
        list_contains "$REBUILD" "anvil" || REBUILD="${REBUILD:+$REBUILD }anvil"
      fi
      if subdir_changed "$SCRIPT_DIR" "packages/forge" "$HORUS_OLD_SHA" "$horus_new" ||
         subdir_changed "$SCRIPT_DIR" "packages/cli"   "$HORUS_OLD_SHA" "$horus_new"; then
        list_contains "$REBUILD" "forge" || REBUILD="${REBUILD:+$REBUILD }forge"
      fi
      if subdir_changed "$SCRIPT_DIR" "services/vault" "$HORUS_OLD_SHA" "$horus_new"; then
        list_contains "$REBUILD" "vault" || REBUILD="${REBUILD:+$REBUILD }vault"
      fi
      if subdir_changed "$SCRIPT_DIR" "packages/vault-mcp" "$HORUS_OLD_SHA" "$horus_new"; then
        list_contains "$REBUILD" "vault-mcp" || REBUILD="${REBUILD:+$REBUILD }vault-mcp"
      fi
    fi
  fi

  # Anvil → anvil service
  if $ANVIL_CHANGED; then
    list_contains "$REBUILD" "anvil" || REBUILD="${REBUILD:+$REBUILD }anvil"
  fi

  # Vault — check subdirectories
  if $VAULT_CHANGED; then
    vault_new=$(get_sha "${REPOS_DIR}/Vault")
    ks_changed=false
    mcp_changed=false

    if subdir_changed "${REPOS_DIR}/Vault" "knowledge-service" "$VAULT_OLD_SHA" "$vault_new"; then
      list_contains "$REBUILD" "vault" || REBUILD="${REBUILD:+$REBUILD }vault"
      ks_changed=true
    fi

    if subdir_changed "${REPOS_DIR}/Vault" "knowledge-mcp" "$VAULT_OLD_SHA" "$vault_new"; then
      list_contains "$REBUILD" "vault-mcp" || REBUILD="${REBUILD:+$REBUILD }vault-mcp"
      mcp_changed=true
    fi

    # Changes outside both subdirs (root config, shared types, etc.) → rebuild both
    if ! $ks_changed && ! $mcp_changed; then
      list_contains "$REBUILD" "vault" || REBUILD="${REBUILD:+$REBUILD }vault"
      list_contains "$REBUILD" "vault-mcp" || REBUILD="${REBUILD:+$REBUILD }vault-mcp"
    fi
  fi

  # Forge → forge service
  if $FORGE_CHANGED; then
    list_contains "$REBUILD" "forge" || REBUILD="${REBUILD:+$REBUILD }forge"
  fi
fi

# -- Phase 3: Rebuild -------------------------------------------------------
if [ -z "$REBUILD" ]; then
  header "Everything is up to date. No services to rebuild."
  echo ""
  exit 0
fi

header "Services to rebuild: ${REBUILD}"

if $DRY_RUN; then
  log "(dry run - not rebuilding)"
  echo ""
  exit 0
fi

cd "$SCRIPT_DIR"

# Rebuild in dependency order:
#   Layer 1: anvil, vault       (no upstream dependencies)
#   Layer 2: vault-mcp          (depends on vault)
#   Layer 3: forge              (depends on anvil + vault)

LAYER1="" LAYER2="" LAYER3=""
for svc in $REBUILD; do
  case "$svc" in
    anvil|vault) LAYER1="${LAYER1:+$LAYER1 }$svc" ;;
    vault-mcp)  LAYER2="${LAYER2:+$LAYER2 }$svc" ;;
    forge)      LAYER3="${LAYER3:+$LAYER3 }$svc" ;;
  esac
done

# shellcheck disable=SC2086
[ -n "$LAYER1" ] && rebuild_and_wait $LAYER1
# shellcheck disable=SC2086
[ -n "$LAYER2" ] && rebuild_and_wait $LAYER2
# shellcheck disable=SC2086
[ -n "$LAYER3" ] && rebuild_and_wait $LAYER3

# -- Phase 4: Post-rebuild hooks --------------------------------------------

if list_contains "$REBUILD" "forge"; then
  header "Forge updated - syncing skills to host..."

  mkdir -p "${SKILLS_DIR}/horus-anvil" "${SKILLS_DIR}/horus-vault" "${SKILLS_DIR}/horus-forge"
  docker cp "${FORGE_CONTAINER}:/home/forge/.claude/skills/horus-anvil/SKILL.md" \
    "${SKILLS_DIR}/horus-anvil/SKILL.md"
  docker cp "${FORGE_CONTAINER}:/home/forge/.claude/skills/horus-vault/SKILL.md" \
    "${SKILLS_DIR}/horus-vault/SKILL.md"
  docker cp "${FORGE_CONTAINER}:/home/forge/.claude/skills/horus-forge/SKILL.md" \
    "${SKILLS_DIR}/horus-forge/SKILL.md"
  success "Skills synced"

  TMPFILE=$(mktemp /tmp/horus-claude-md.XXXXXX)
  if docker cp "${FORGE_CONTAINER}:/home/forge/.claude/CLAUDE.md" "$TMPFILE" 2>/dev/null; then
    python3 - "$TMPFILE" "$CLAUDE_MD" <<'PYEOF'
import sys, os

container_md = open(sys.argv[1]).read()
host_md_path = sys.argv[2]
plugin_id    = "horus-core"
start_fence  = f"<!-- forge:global:{plugin_id}:start -->"
end_fence    = f"<!-- forge:global:{plugin_id}:end -->"

s = container_md.find(start_fence)
e = container_md.find(end_fence)
if s == -1 or e == -1:
    sys.exit(0)
section = container_md[s:e + len(end_fence)]

existing = ""
if os.path.exists(host_md_path):
    with open(host_md_path) as f:
        existing = f.read()

hs = existing.find(start_fence)
he = existing.find(end_fence)
if hs != -1 and he != -1:
    updated = existing[:hs] + section + existing[he + len(end_fence):]
else:
    sep = "\n\n" if existing and not existing.endswith("\n\n") else ("\n" if existing else "")
    updated = existing + sep + section + "\n"

os.makedirs(os.path.dirname(host_md_path) or ".", exist_ok=True)
with open(host_md_path, "w") as f:
    f.write(updated)
PYEOF
    success "CLAUDE.md updated"
  fi
  rm -f "$TMPFILE"
fi

# -- Phase 5: Save build state -----------------------------------------------
save_built_shas

# -- Done --------------------------------------------------------------------
header "--------------------------------------"
success "Update complete. Rebuilt: ${REBUILD}"
echo ""
