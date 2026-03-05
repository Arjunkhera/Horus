#!/bin/sh
# QMD MCP HTTP daemon entrypoint.
#
# Collections are registered and maintained by Anvil and Vault via subprocess
# (they share the qmd-daemon-data volume and therefore the same SQLite index).
# This script simply starts the HTTP server.

set -e

PORT="${QMD_DAEMON_PORT:-8181}"

echo "=== QMD MCP HTTP daemon starting on port ${PORT} ==="
exec qmd mcp --http --port "$PORT"
