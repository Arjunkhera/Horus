#!/usr/bin/env bash
# publish-cli.sh — Build and publish @arkhera30/cli to npm
#
# Usage:
#   ./publish-cli.sh
#
# Auth is handled via browser-based 2FA when prompted by npm.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/packages/cli"

echo "Building @arkhera30/cli..."
cd "$SCRIPT_DIR"
pnpm --filter @arkhera30/cli run build

echo ""
echo "Publishing to npm..."
cd "$CLI_DIR"
npm publish

echo ""
echo "Done. Published $(node -p "require('./package.json').version")"
