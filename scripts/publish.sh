#!/usr/bin/env bash
# scripts/publish.sh — Build, publish, and tag Horus npm packages
#
# Usage:
#   ./scripts/publish.sh <package>
#   ./scripts/publish.sh all
#
# Packages:
#   cli              @akhera-horus/cli  (packages/cli)
#   testenv          @akhera-horus/testenv  (packages/testenv)
#   testenv-runner   @akhera-horus/testenv-runner  (packages/testenv-runner)
#   all              Publish all three in dependency order
#
# Flow per package:
#   1. pnpm install (frozen)
#   2. pnpm build (filtered to the package)
#   3. npm publish [--access public for @akhera-horus scoped packages]
#   4. Annotated git tag "<package>/v<version>" + push
#   5. GitHub release via gh (if available)
#
# Requirements:
#   pnpm, node, npm logged in (npm whoami must succeed)
#   gh CLI (optional — for GitHub release)
#
# Run from a clean working tree at the commit you want to release
# (typically master after the release bump PR has merged).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Package registry ─────────────────────────────────────────────────────────
# Each entry: "<key>|<pkg-dir>|<npm-access>"
# npm-access: "public" passes --access public; "" omits the flag
declare -a PACKAGES=(
  "cli|packages/cli|"
  "testenv|packages/testenv|public"
  "testenv-runner|packages/testenv-runner|public"
)
# Dependency order for "all" — testenv must precede testenv-runner
PUBLISH_ORDER=("testenv" "testenv-runner" "cli")

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo "[publish] $*"; }
fail() { echo "[publish] FAIL: $*" >&2; exit 1; }

pkg_dir() {
  local key="$1"
  for e in "${PACKAGES[@]}"; do
    IFS='|' read -r k d a <<<"$e"
    [[ "$k" == "$key" ]] && echo "$d" && return
  done
  fail "unknown package key: $key"
}

pkg_access() {
  local key="$1"
  for e in "${PACKAGES[@]}"; do
    IFS='|' read -r k d a <<<"$e"
    [[ "$k" == "$key" ]] && echo "$a" && return
  done
  fail "unknown package key: $key"
}

check_prereqs() {
  command -v pnpm >/dev/null 2>&1 || fail "pnpm not found"
  command -v node >/dev/null 2>&1 || fail "node not found"
  command -v npm  >/dev/null 2>&1 || fail "npm not found"
  npm whoami >/dev/null 2>&1      || fail "not logged in to npm — run: npm login"
}

# ── Core publish function ────────────────────────────────────────────────────

publish_one() {
  local key="$1"
  local dir access full_dir npm_name version tag

  dir="$(pkg_dir "$key")"
  access="$(pkg_access "$key")"
  full_dir="${REPO_ROOT}/${dir}"

  [[ -f "${full_dir}/package.json" ]] || fail "package.json not found at ${full_dir}"

  npm_name="$(node -p "require('${full_dir}/package.json').name")"
  version="$(node -p "require('${full_dir}/package.json').version")"
  tag="${key}/v${version}"

  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "Package : ${npm_name}@${version}"
  log "Dir     : ${dir}"
  log "Tag     : ${tag}"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Step 1: install
  log "Installing dependencies..."
  cd "$REPO_ROOT"
  pnpm install --frozen-lockfile

  # Step 2: build
  log "Building ${npm_name}..."
  pnpm --filter "${npm_name}" build

  # Step 3: publish
  # Use pnpm publish to resolve workspace:* protocols before uploading.
  # npm publish does NOT resolve them, breaking global installs.
  log "Publishing to npm..."
  cd "$full_dir"
  if [[ -n "$access" ]]; then
    pnpm publish --access "$access" --no-git-checks
  else
    pnpm publish --no-git-checks
  fi
  log "Published ${npm_name}@${version}"

  # Step 4: git tag
  cd "$REPO_ROOT"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    log "Warning: tag ${tag} already exists locally — skipping tag creation."
  else
    log "Creating annotated git tag ${tag}..."
    git tag -a "$tag" -m "Release ${npm_name} v${version}"
    log "Pushing tag to origin..."
    git push origin "$tag"
  fi

  # Step 5: GitHub release (optional)
  if command -v gh >/dev/null 2>&1; then
    if gh release view "$tag" >/dev/null 2>&1; then
      log "Warning: GitHub release for ${tag} already exists — skipping."
    else
      log "Creating GitHub release..."
      if gh release create "$tag" \
           --title "${npm_name} v${version}" \
           --generate-notes; then
        log "GitHub release created."
      else
        log "Warning: GitHub release creation failed — tag and npm publish already succeeded." >&2
      fi
    fi
  else
    log "Note: gh CLI not found — skipping GitHub release."
    log "      To create manually: gh release create ${tag} --generate-notes"
  fi

  log "Done: ${npm_name}@${version} (tag: ${tag})"
  echo ""
}

# ── Usage ────────────────────────────────────────────────────────────────────

usage() {
  echo "Usage: $0 <cli|testenv|testenv-runner|all>"
  echo ""
  echo "  cli             $(node -p "require('${REPO_ROOT}/packages/cli/package.json').name" 2>/dev/null)"
  echo "  testenv         $(node -p "require('${REPO_ROOT}/packages/testenv/package.json').name" 2>/dev/null)"
  echo "  testenv-runner  $(node -p "require('${REPO_ROOT}/packages/testenv-runner/package.json').name" 2>/dev/null)"
  echo "  all             Publish all three in dependency order"
  exit 2
}

# ── Argument parsing ─────────────────────────────────────────────────────────

[[ $# -eq 1 ]] || usage
TARGET="$1"

# ── Main ─────────────────────────────────────────────────────────────────────

check_prereqs

case "$TARGET" in
  all)
    log "Publishing all packages in dependency order: ${PUBLISH_ORDER[*]}"
    echo ""
    for pkg in "${PUBLISH_ORDER[@]}"; do
      publish_one "$pkg"
    done
    log "All packages published successfully."
    ;;
  cli|testenv|testenv-runner)
    publish_one "$TARGET"
    ;;
  --help|-h)
    usage
    ;;
  *)
    echo "Error: unknown package '${TARGET}'" >&2
    usage
    ;;
esac
