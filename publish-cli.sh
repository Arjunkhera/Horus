#!/usr/bin/env bash
# publish-cli.sh — Compatibility shim. Use scripts/publish.sh instead.
#
# This file is kept so any existing bookmarks/CI references don't break.
# It delegates to the unified publish script.

set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/publish.sh" cli "$@"
