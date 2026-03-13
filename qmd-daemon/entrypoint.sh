#!/bin/sh
# QMD MCP HTTP daemon entrypoint.
#
# Collections are registered and maintained by Anvil and Vault via subprocess
# (they share the qmd-daemon-data volume and therefore the same SQLite index).
# This script starts the HTTP server, then ensures the shared SQLite database
# is world-writable so other containers (anvil, vault) can write to it.

set -e

PORT="${QMD_DAEMON_PORT:-8181}"
DB_DIR="$HOME/.cache/qmd"
DB_PATH="$DB_DIR/index.sqlite"

# Ensure the shared volume directory exists and is world-writable so other
# container users (anvil, appuser) can create files here too.
mkdir -p "$DB_DIR"
chmod 777 "$DB_DIR" 2>/dev/null || true

# umask 0 for new files, though SQLite hardcodes open() with mode 0644
# so we also need the explicit chmod below.
umask 0

# Start qmd in background so we can fix SQLite file permissions after creation.
echo "=== QMD MCP HTTP daemon starting on port ${PORT} ==="
qmd mcp --http --port "$PORT" &
QMD_PID=$!

# Wait for the SQLite database to be created, then make it world-writable.
# SQLite hardcodes open() with mode 0644 regardless of umask, so the only way
# to let other UIDs (anvil, appuser) write is an explicit chmod after creation.
i=0
while [ "$i" -lt 30 ]; do
  if [ -f "$DB_PATH" ]; then
    chmod 666 "$DB_PATH" 2>/dev/null || true
    chmod 666 "${DB_PATH}-shm" 2>/dev/null || true
    chmod 666 "${DB_PATH}-wal" 2>/dev/null || true
    echo "=== SQLite database permissions fixed for shared access ==="
    break
  fi
  sleep 1
  i=$((i + 1))
done

# Wait for qmd process — keeps the container alive and forwards signals.
wait $QMD_PID
