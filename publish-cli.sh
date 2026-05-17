#!/usr/bin/env bash
# publish-cli.sh — Entry point for Horus npm publish. Delegates to scripts/publish.sh.
#
# Usage:
#   ./publish-cli.sh <cli|testenv|testenv-runner|all>
#
# Kept at the repo root for convenience; the implementation lives in scripts/publish.sh.

set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/publish.sh" "$@"
