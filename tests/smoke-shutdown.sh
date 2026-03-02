#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# smoke-shutdown.sh — Graceful shutdown validation for the Horus stack
#
# Verifies that `docker compose stop` completes within the grace period and
# that all containers exit with code 0 (clean shutdown, not SIGKILL'd).
#
# IMPORTANT: This test STOPS the running stack. Run it after smoke-all.sh
# and smoke-e2e.sh, or any time you want to validate shutdown behaviour.
# The stack is NOT restarted after this test — restart it manually if needed.
#
# Usage:
#   bash tests/smoke-shutdown.sh
#
# Environment variables:
#   COMPOSE_FILE     Path to docker-compose.yml (default: ../docker-compose.yml relative to this script)
#   STOP_TIMEOUT     Seconds to wait for all containers to stop (default: 30)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/../docker-compose.yml}"
STOP_TIMEOUT="${STOP_TIMEOUT:-30}"

pass=0
fail=0

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "  $1"; }
ok()   { echo "PASS: $1"; ((pass++)); }
fail() { echo "FAIL: $1"; ((fail++)); }

# ── Pre-flight: verify all three services are currently running ───────────────
echo ""
echo "── Pre-flight ────────────────────────────────────────────────────────────"

ALL_UP=true
for svc in anvil vault forge; do
  STATE=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
    | python3 -c "
import sys, json
rows = [json.loads(l) for l in sys.stdin if l.strip()]
for r in rows:
    if r.get('Service') == '$svc':
        print(r.get('State','unknown'))
        sys.exit(0)
print('not_found')
" 2>/dev/null || echo "error")

  if [ "$STATE" = "running" ]; then
    log "$svc: running ✓"
  else
    log "$svc: $STATE (expected running)"
    ALL_UP=false
  fi
done

if [ "$ALL_UP" = "false" ]; then
  echo ""
  echo "ERROR: Not all services are running. Start the stack first:"
  echo "  docker compose -f $COMPOSE_FILE up -d"
  exit 1
fi

# ── Stop the stack and time it ─────────────────────────────────────────────────
echo ""
echo "── Shutdown ──────────────────────────────────────────────────────────────"
log "Sending docker compose stop (grace period: ${STOP_TIMEOUT}s)..."

START_TIME=$(date +%s)
docker compose -f "$COMPOSE_FILE" stop --timeout "$STOP_TIMEOUT"
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

log "Stack stopped in ${ELAPSED}s"

if [ "$ELAPSED" -le "$STOP_TIMEOUT" ]; then
  ok "Stack stopped within ${STOP_TIMEOUT}s grace period (took ${ELAPSED}s)"
else
  fail "Stack took ${ELAPSED}s to stop — exceeded ${STOP_TIMEOUT}s grace period (containers may have been SIGKILL'd)"
fi

# ── Verify exit codes ─────────────────────────────────────────────────────────
echo ""
echo "── Exit codes ────────────────────────────────────────────────────────────"
# After `docker compose stop`, containers are in 'exited' state.
# Exit code 0 = clean shutdown (process caught SIGTERM and exited gracefully).
# Exit code 137 = killed by SIGKILL (143 = terminated by SIGTERM without handler,
# which is still acceptable for services that don't register a SIGTERM handler).

for svc in anvil vault forge; do
  EXIT_CODE=$(docker compose -f "$COMPOSE_FILE" ps --all --format json 2>/dev/null \
    | python3 -c "
import sys, json
rows = [json.loads(l) for l in sys.stdin if l.strip()]
for r in rows:
    if r.get('Service') == '$svc':
        print(r.get('ExitCode', -1))
        sys.exit(0)
print(-1)
" 2>/dev/null || echo "-1")

  # Exit code 0 = clean. 143 = SIGTERM received (acceptable). 137 = SIGKILL = bad.
  case "$EXIT_CODE" in
    0)   ok "$svc exited cleanly (code 0)" ;;
    143) ok "$svc exited via SIGTERM (code 143 — acceptable)" ;;
    137) fail "$svc was SIGKILL'd (code 137) — did not exit within grace period" ;;
    *)   fail "$svc exited with unexpected code $EXIT_CODE" ;;
  esac
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "SHUTDOWN SUMMARY: $pass passed, $fail failed"
echo "=========================================="
echo ""
echo "NOTE: The stack has been stopped. To restart:"
echo "  docker compose -f $COMPOSE_FILE up -d"
echo ""

[ "$fail" -eq 0 ] && exit 0 || exit 1
