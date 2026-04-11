#!/usr/bin/env bash
# publish-cli.sh — Build, publish, and tag a release for @arkhera30/cli
#
# Usage:
#   ./publish-cli.sh
#
# Flow:
#   1. pnpm install + pnpm build (via the workspace)
#   2. npm publish (auth via browser-based 2FA when prompted)
#   3. Create an annotated git tag "cli/v<version>" and push it to origin
#   4. If `gh` is installed and authenticated, create a matching GitHub release
#
# Run from a clean working tree at the commit you want to release (typically
# master after the release bump PR has merged).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/packages/cli"

# ── Step 1: install dependencies ────────────────────────────────────────────
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
pnpm install --frozen-lockfile

# ── Step 2: build the CLI ───────────────────────────────────────────────────
echo "Building @arkhera30/cli..."
pnpm --filter @arkhera30/cli run build

# ── Step 3: publish to npm ──────────────────────────────────────────────────
echo ""
echo "Publishing to npm..."
cd "$CLI_DIR"
npm publish

VERSION="$(node -p "require('./package.json').version")"
TAG="cli/v${VERSION}"

echo ""
echo "Published @arkhera30/cli@${VERSION}"

# ── Step 4: git tag + push ──────────────────────────────────────────────────
cd "$SCRIPT_DIR"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo ""
  echo "Warning: tag ${TAG} already exists locally — skipping tag creation."
else
  echo ""
  echo "Creating annotated git tag ${TAG}..."
  git tag -a "$TAG" -m "Release @arkhera30/cli v${VERSION}"
  echo "Pushing tag to origin..."
  git push origin "$TAG"
fi

# ── Step 5: optional GitHub release via gh ──────────────────────────────────
if command -v gh >/dev/null 2>&1; then
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo ""
    echo "Warning: GitHub release for ${TAG} already exists — skipping."
  else
    echo ""
    echo "Creating GitHub release..."
    if gh release create "$TAG" \
         --title "CLI v${VERSION}" \
         --generate-notes; then
      echo "GitHub release created."
    else
      echo "Warning: GitHub release creation failed — tag and npm publish already succeeded." >&2
    fi
  fi
else
  echo ""
  echo "Note: gh CLI not found — skipping GitHub release creation."
  echo "      To create one manually: gh release create ${TAG} --generate-notes"
fi

echo ""
echo "Done. Released @arkhera30/cli@${VERSION} (tag: ${TAG})"
