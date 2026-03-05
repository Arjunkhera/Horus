#!/bin/sh
# QMD MCP HTTP daemon entrypoint.
#
# Collections are registered and maintained by Anvil and Vault via subprocess
# (they share the qmd-daemon-data volume and therefore the same SQLite index).
# This script simply starts the HTTP server.

set -e

PORT="${QMD_DAEMON_PORT:-8181}"

# Ensure the shared volume directory is world-writable so Anvil and Vault
# (running as different users) can write to the same SQLite database via
# subprocess qmd calls.  chmod -R covers any files left by a previous run.
mkdir -p ~/.cache/qmd
chmod -R 777 ~/.cache/qmd

# umask 0 → new files created by qmd (SQLite db, -wal, -shm, model cache)
# get mode 666/777, allowing other container users to write them.
umask 0

echo "=== QMD MCP HTTP daemon starting on port ${PORT} ==="
exec qmd mcp --http --port "$PORT"
