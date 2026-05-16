#!/bin/bash
###############################################################################
# smoke-test.sh — Validate a running Forge Registry instance
#
# Runs health, publish, resolve, search, and types checks against the registry.
#
# Usage:
#   ./smoke-test.sh <host>                    # Test against IP/hostname
#   ./smoke-test.sh <host> --api-key <key>    # Include publish test
#   ./smoke-test.sh --from-terraform          # Auto-resolve from tf outputs
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/../terraform/public-global"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1 — $2"; FAIL=$((FAIL + 1)); }
skip() { echo -e "  ${YELLOW}SKIP${NC} $1 — $2"; SKIP=$((SKIP + 1)); }

###############################################################################
# Parse arguments
###############################################################################

HOST=""
API_KEY=""
PORT=8744
SCHEME="http"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)          API_KEY="$2"; shift 2 ;;
    --port)             PORT="$2"; shift 2 ;;
    --https)            SCHEME="https"; shift ;;
    --from-terraform)   HOST=$(cd "${TF_DIR}" && terraform output -raw registry_elastic_ip 2>/dev/null); shift ;;
    -h|--help)
      echo "Usage: $0 <host> [--api-key KEY] [--port PORT] [--https]"
      echo "       $0 --from-terraform [--api-key KEY]"
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *)  HOST="$1"; shift ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "ERROR: No host specified. Usage: $0 <host> or $0 --from-terraform" >&2
  exit 1
fi

BASE_URL="${SCHEME}://${HOST}:${PORT}"

echo "Smoke testing: ${BASE_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

###############################################################################
# Test: Health
###############################################################################

echo ""
echo "Health:"
HEALTH_RESP=$(curl -sf "${BASE_URL}/health" 2>/dev/null || echo "")
if [[ -n "$HEALTH_RESP" ]]; then
  STATUS=$(echo "$HEALTH_RESP" | jq -r '.status' 2>/dev/null || echo "")
  if [[ "$STATUS" == "ok" ]]; then
    pass "GET /health → status: ok"
  else
    fail "GET /health" "unexpected status: ${STATUS}"
  fi
else
  fail "GET /health" "no response"
fi

###############################################################################
# Test: Types
###############################################################################

echo ""
echo "Types:"
TYPES_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${BASE_URL}/types" 2>/dev/null || echo "000")
if [[ "$TYPES_CODE" == "200" ]]; then
  pass "GET /types → 200"
else
  fail "GET /types" "HTTP ${TYPES_CODE}"
fi

TYPES_ALL_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${BASE_URL}/types/skill" 2>/dev/null || echo "000")
if [[ "$TYPES_ALL_CODE" == "200" ]]; then
  pass "GET /types/skill → 200"
else
  fail "GET /types/skill" "HTTP ${TYPES_ALL_CODE}"
fi

###############################################################################
# Test: Search
###############################################################################

echo ""
echo "Search:"
SEARCH_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${BASE_URL}/search?q=test" 2>/dev/null || echo "000")
if [[ "$SEARCH_CODE" == "200" ]]; then
  pass "GET /search?q=test → 200"
else
  fail "GET /search?q=test" "HTTP ${SEARCH_CODE}"
fi

###############################################################################
# Test: Publish (requires API key)
###############################################################################

echo ""
echo "Publish:"
if [[ -n "$API_KEY" ]]; then
  # Publish a smoke-test artifact
  PUBLISH_RESP=$(curl -sf -w "\n%{http_code}" \
    -X POST "${BASE_URL}/artifacts/skill/smoke-test-artifact/0.0.1" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
      "files": {
        "metadata.yaml": "'$(echo -n "id: smoke-test-artifact\nname: Smoke Test\nversion: 0.0.1\ntype: skill\ndescription: Automated smoke test artifact" | base64)'"
      }
    }' 2>/dev/null || echo -e "\n000")

  PUBLISH_CODE=$(echo "$PUBLISH_RESP" | tail -1)
  if [[ "$PUBLISH_CODE" == "201" || "$PUBLISH_CODE" == "200" ]]; then
    pass "POST /artifacts/skill/smoke-test-artifact/0.0.1 → ${PUBLISH_CODE}"

    # Verify resolve
    RESOLVE_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
      "${BASE_URL}/artifacts/skill/smoke-test-artifact/0.0.1" 2>/dev/null || echo "000")
    if [[ "$RESOLVE_CODE" == "200" ]]; then
      pass "GET /artifacts/skill/smoke-test-artifact/0.0.1 → 200"
    else
      fail "GET /artifacts/skill/smoke-test-artifact/0.0.1" "HTTP ${RESOLVE_CODE}"
    fi
  else
    fail "POST /artifacts/skill/smoke-test-artifact/0.0.1" "HTTP ${PUBLISH_CODE}"
  fi
else
  skip "POST /artifacts (publish)" "no --api-key provided"
  skip "GET /artifacts (resolve)" "depends on publish"
fi

###############################################################################
# Summary
###############################################################################

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "Results: ${GREEN}${PASS} pass${NC} / ${RED}${FAIL} fail${NC} / ${YELLOW}${SKIP} skip${NC} (${TOTAL} total)"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
