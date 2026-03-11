#!/bin/sh
# QMD MCP HTTP daemon entrypoint.
#
# Collections are registered and maintained by Anvil and Vault via subprocess
# (they share the qmd-daemon-data volume and therefore the same SQLite index).
# This script simply starts the HTTP server.

set -e

PORT="${QMD_DAEMON_PORT:-8181}"

# Ensure the shared volume directory exists.
mkdir -p ~/.cache/qmd

# umask 0 → new files created by qmd (SQLite db, -wal, -shm, model cache)
# get mode 666/777, allowing other container users (anvil, appuser) to write
# to the same SQLite database via subprocess qmd calls.
#
# NOTE: We intentionally do NOT chmod -R the cache directory. The shared
# qmd-daemon-data volume is written by three different UIDs (qmd, anvil,
# appuser). A recursive chmod fails on files owned by other UIDs and
# crashes the entrypoint under set -e.  umask 0 handles new files correctly.
umask 0

echo "=== QMD MCP HTTP daemon starting on port ${PORT} ==="
exec qmd mcp --http --port "$PORT"
