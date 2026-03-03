#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Horus Setup Script
#
# Starts the Horus stack and installs horus-core to the host's ~/.claude/.
# Run this once after cloning, or again after updating any service.
#
# Usage:
#   bash setup.sh            # start + install
#   bash setup.sh --skip-build  # skip docker build (faster if images are current)
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_CONTAINER="horus-forge-1"
CLAUDE_DIR="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_DIR}/skills"
CLAUDE_MD="${CLAUDE_DIR}/CLAUDE.md"
BUILD_FLAG="--build"

for arg in "$@"; do
  [[ "$arg" == "--skip-build" ]] && BUILD_FLAG=""
done

log()     { echo "  $1"; }
success() { echo "✓ $1"; }
fail()    { echo "✗ $1" >&2; exit 1; }

echo ""
echo "Horus Setup"
echo "──────────────────────────────────────"

# ── Step 1: Start the stack ──────────────────────────────────────────────────
echo ""
echo "Starting Horus stack..."
cd "$SCRIPT_DIR"
docker compose up $BUILD_FLAG -d
success "Stack started"

# ── Step 2: Wait for Forge to be healthy ─────────────────────────────────────
echo ""
echo "Waiting for Forge to be healthy..."
TIMEOUT=120
ELAPSED=0
until docker inspect --format='{{.State.Health.Status}}' "$FORGE_CONTAINER" 2>/dev/null | grep -q "healthy"; do
  if [[ $ELAPSED -ge $TIMEOUT ]]; then
    fail "Forge did not become healthy within ${TIMEOUT}s. Check: docker compose logs forge"
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  log "Still waiting... (${ELAPSED}s)"
done
success "Forge is healthy"

# ── Step 3: Install horus-core skills to ~/.claude/skills/ ───────────────────
echo ""
echo "Installing horus-core skills to ${SKILLS_DIR}..."
mkdir -p "${SKILLS_DIR}/horus-anvil" "${SKILLS_DIR}/horus-vault" "${SKILLS_DIR}/horus-forge"

docker cp "${FORGE_CONTAINER}:/home/forge/.claude/skills/horus-anvil/SKILL.md" \
  "${SKILLS_DIR}/horus-anvil/SKILL.md"
docker cp "${FORGE_CONTAINER}:/home/forge/.claude/skills/horus-vault/SKILL.md" \
  "${SKILLS_DIR}/horus-vault/SKILL.md"
docker cp "${FORGE_CONTAINER}:/home/forge/.claude/skills/horus-forge/SKILL.md" \
  "${SKILLS_DIR}/horus-forge/SKILL.md"
success "Skills installed"

# ── Step 4: Upsert managed section into ~/.claude/CLAUDE.md ──────────────────
echo ""
echo "Updating ${CLAUDE_MD}..."

# Copy the container's CLAUDE.md to a temp file on the host, then merge
TMPFILE=$(mktemp /tmp/horus-claude-md.XXXXXX)
docker cp "${FORGE_CONTAINER}:/home/forge/.claude/CLAUDE.md" "$TMPFILE" \
  || fail "Could not copy CLAUDE.md from container"

# Use host Python to extract the managed section and upsert into host CLAUDE.md
python3 - "$TMPFILE" "$CLAUDE_MD" <<'PYEOF'
import sys, os

container_md = open(sys.argv[1]).read()
host_md_path = sys.argv[2]
plugin_id    = "horus-core"
start_fence  = f"<!-- forge:global:{plugin_id}:start -->"
end_fence    = f"<!-- forge:global:{plugin_id}:end -->"

# Extract the managed section from container CLAUDE.md
s = container_md.find(start_fence)
e = container_md.find(end_fence)
if s == -1 or e == -1:
    print("No managed section found in container CLAUDE.md", file=sys.stderr)
    sys.exit(1)
section = container_md[s:e + len(end_fence)]

# Upsert into host CLAUDE.md
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

rm -f "$TMPFILE"
success "CLAUDE.md updated"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────"
success "Horus setup complete"
echo ""
echo "  Skills:   ${SKILLS_DIR}/horus-{anvil,vault,forge}/SKILL.md"
echo "  Rules:    ${CLAUDE_MD}"
echo ""
echo "  If Claude Code is already running, restart it to pick up the new rules."
echo ""
