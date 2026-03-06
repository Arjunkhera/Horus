#!/usr/bin/env bash
# publish-cli.sh — Build and publish @arkhera30/cli to npm
#
# Usage:
#   ./publish-cli.sh <otp>
#
# Example:
#   ./publish-cli.sh 123456

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/cli"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <otp>"
  echo "Example: $0 123456"
  exit 1
fi

OTP="$1"

echo "Building @arkhera30/cli..."
cd "$CLI_DIR"
npm install --silent
npm run build

echo ""
echo "Publishing to npm..."
npm publish --otp="$OTP"

echo ""
echo "Done. Published $(node -p "require('./package.json').version")"
