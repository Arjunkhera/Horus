#!/usr/bin/env bash
# scripts/update-client.sh — Update a local Horus client (CLI + container services).
#
# The painless client update already lives in the CLI: `horus update` snapshots
# the current images, pulls the latest, force-recreates the containers, and waits
# for health (`horus update --rollback` restores the previous snapshot). This
# wrapper adds an optional CLI self-update first, so one command brings both the
# CLI and the running services up to date.
#
# Usage:
#   scripts/update-client.sh [--with-cli] [-y] [extra horus-update args...]
#   scripts/update-client.sh --rollback [-y]
#
# Options:
#   --with-cli   Also `npm install -g @arkhera30/cli@latest` before updating services
#   --rollback   Roll the services back to the previous snapshot (horus update --rollback)
#   -y, --yes    Skip confirmation prompts (passed through to `horus update`)
#   -h, --help   This help
#
# Anything not recognized here is passed straight through to `horus update`.

set -euo pipefail

WITH_CLI=0
PASSTHRU=()

log()  { echo "[update-client] $*"; }
fail() { echo "[update-client] FAIL: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-cli) WITH_CLI=1; shift;;
    -h|--help)  sed -n '2,22p' "$0"; exit 0;;
    *) PASSTHRU+=("$1"); shift;;   # --rollback, -y, etc. -> horus update
  esac
done

command -v horus >/dev/null 2>&1 || fail "the 'horus' CLI is not installed. Run: npm install -g @arkhera30/cli@latest"

if [[ "$WITH_CLI" == 1 ]]; then
  log "Updating the Horus CLI itself..."
  npm install -g @arkhera30/cli@latest
  log "CLI now: $(horus --version 2>/dev/null || echo unknown)"
fi

log "Updating client services via 'horus update ${PASSTHRU[*]:-}'"
exec horus update "${PASSTHRU[@]}"
