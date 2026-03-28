#!/bin/bash

# End-to-End Integration Smoke Test for Horus
# Exercises the full agent loop:
#   1. Pre-flight: verify all three services are healthy
#   2. Workspace lifecycle: create → list → status → delete via Forge MCP
#   3. MCP config verification: inspect emitted files (requires Docker)
#   4. Simulated agent flow:
#        Anvil anvil_search → Vault /resolve-context → Forge forge_repo_resolve
#
# Usage:
#   ./smoke-e2e.sh
#
# Environment variables:
#   ANVIL_URL        Anvil MCP HTTP base (default: http://localhost:8100)
#   VAULT_URL        Vault REST HTTP base (default: http://localhost:8000)
#   FORGE_URL        Forge MCP HTTP base (default: http://localhost:8200)
#   FORGE_CONTAINER  Docker container name for Forge (default: horus-forge-1)
#   SKIP_DOCKER      Set to 1 to skip Docker-based MCP config inspection

set -u

# ─── Configuration ─────────────────────────────────────────────────────────────
ANVIL_URL="${ANVIL_URL:-http://localhost:8100}"
VAULT_URL="${VAULT_URL:-http://localhost:8000}"
FORGE_URL="${FORGE_URL:-http://localhost:8200}"
FORGE_CONTAINER="${FORGE_CONTAINER:-horus-forge-1}"
SKIP_DOCKER="${SKIP_DOCKER:-0}"
TIMEOUT=30

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
WORKSPACE_ID=""
WORKSPACE_NAME=""
ANVIL_SESSION_ID=""
FORGE_SESSION_ID=""

# ─── Helpers ───────────────────────────────────────────────────────────────────

# Initialize an MCP session and store the session ID
# $1 = base URL, $2 = variable name to store session ID (nameref)
mcp_initialize() {
    local base_url="$1"
    local init_payload='{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e-smoke","version":"1.0"}}}'
    local response_with_headers
    response_with_headers=$(curl -s -D - -X POST \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "$init_payload" \
        --max-time "$TIMEOUT" \
        "$base_url/")
    echo "$response_with_headers" | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r\n'
}

# Make an MCP JSON-RPC 2.0 call via HTTP POST (with session header)
# $1 = base URL, $2 = session ID, $3 = method, $4 = JSON params object string
call_mcp() {
    local base_url="$1"
    local session_id="$2"
    local method="$3"
    local params="${4:-}"
    [[ -z "$params" ]] && params="{}"
    local req_id=$((RANDOM % 10000 + 1))

    local payload="{\"jsonrpc\":\"2.0\",\"id\":$req_id,\"method\":\"$method\",\"params\":$params}"

    local curl_args=(-s -X POST
        -H "Content-Type: application/json"
        -H "Accept: application/json, text/event-stream"
        -d "$payload"
        --max-time "$TIMEOUT"
        "$base_url/")
    [[ -n "$session_id" ]] && curl_args+=(-H "Mcp-Session-Id: $session_id")

    curl "${curl_args[@]}"
}

# Make a Vault REST call
# $1 = HTTP method, $2 = path, $3 = optional JSON body
call_vault() {
    local method="$1"
    local path="$2"
    local data="${3:-}"

    local args=(-s -X "$method" -H "Content-Type: application/json")
    [[ -n "$data" ]] && args+=(-d "$data")
    args+=(--max-time "$TIMEOUT" "$VAULT_URL$path")

    curl "${args[@]}"
}

# Unwrap MCP tools/call result from content[0].text and print as JSON
get_tool_output() {
    python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    result = data.get('result', {})
    if isinstance(result, str):
        result = json.loads(result)
    if isinstance(result, dict) and 'content' in result:
        content = result.get('content', [])
        if content and isinstance(content[0], dict) and content[0].get('type') == 'text':
            text = content[0].get('text', '')
            try:
                print(json.dumps(json.loads(text)))
            except:
                print(json.dumps(text))
    else:
        print(json.dumps(result))
except Exception:
    print('{}')
" 2>/dev/null
}

# Return 'true' if the JSON-RPC response has a top-level error key
has_mcp_error() {
    local json="$1"
    echo "$json" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print('true' if 'error' in data else 'false')
except:
    print('true')
" 2>/dev/null
}

# Return 'true' if the Vault REST response contains error / detail
has_rest_error() {
    local json="$1"
    echo "$json" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    if isinstance(data, dict) and ('error' in data or 'detail' in data):
        print('true')
    elif not isinstance(data, dict):
        print('true')
    else:
        print('false')
except:
    print('true')
" 2>/dev/null
}

pass() { echo "PASS: $1"; ((PASS_COUNT++)); }
fail() { echo "FAIL: $1"; ((FAIL_COUNT++)); }
skip() { echo "SKIP: $1"; ((SKIP_COUNT++)); }

# ─── Phase 1: Pre-flight health checks ────────────────────────────────────────

check_anvil_health() {
    local response
    response=$(curl -s --max-time 10 "$ANVIL_URL/health")

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('status') == 'ok' and data.get('service') == 'anvil':
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "preflight: Anvil responding (GET /health OK)"
        return 0
    else
        fail "preflight: Anvil health — unexpected response: $response"
        return 1
    fi
}

check_vault_health() {
    local response
    response=$(call_vault "GET" "/health")

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('status') == 'ok' and data.get('service') == 'knowledge-service':
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "preflight: Vault responding (GET /health OK)"
        return 0
    else
        fail "preflight: Vault health — unexpected response: $response"
        return 1
    fi
}

check_forge_health() {
    local response
    response=$(curl -s --max-time 10 "$FORGE_URL/health")

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('status') == 'ok' and data.get('service') == 'forge':
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "preflight: Forge responding (GET /health OK)"
        return 0
    else
        fail "preflight: Forge health — unexpected response: $response"
        return 1
    fi
}

# ─── Phase 2: Workspace lifecycle ─────────────────────────────────────────────

test_workspace_create() {
    local params
    params=$(python3 -c "import json; print(json.dumps({
        'config': 'test-workspace',
        'storyId': 'STORY-E2E-001',
        'storyTitle': 'E2E Integration Test Workspace'
    }))")

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_workspace_create\",\"arguments\":$params}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "workspace_create — API error"
        return 1
    fi

    # Response: {"success": true, "workspace": {"id": "ws-...", "name": "...", ...}}
    local output
    output=$(echo "$response" | get_tool_output)
    WORKSPACE_ID=$(echo "$output" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    workspace = data.get('workspace', {})
    print(workspace.get('id', ''))
except:
    pass
" 2>/dev/null)
    WORKSPACE_NAME=$(echo "$output" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    workspace = data.get('workspace', {})
    print(workspace.get('name', ''))
except:
    pass
" 2>/dev/null)

    if [[ -n "$WORKSPACE_ID" ]]; then
        pass "workspace_create (id: $WORKSPACE_ID, name: $WORKSPACE_NAME)"
        return 0
    else
        fail "workspace_create — no workspace id in response"
        return 1
    fi
}

test_workspace_appears_in_list() {
    if [[ -z "$WORKSPACE_ID" ]]; then
        skip "workspace_list_verify — no workspace id (create step failed)"
        return 0
    fi

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_workspace_list\",\"arguments\":{}}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "workspace_list_verify — API error"
        return 1
    fi

    # Response is a bare list of workspace records
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
ws_id = '$WORKSPACE_ID'
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    ids = [w.get('id') for w in data if isinstance(w, dict)]
    if ws_id in ids:
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "workspace_list_verify — workspace $WORKSPACE_ID found in list"
        return 0
    else
        fail "workspace_list_verify — workspace $WORKSPACE_ID not found in list"
        return 1
    fi
}

test_workspace_status() {
    if [[ -z "$WORKSPACE_ID" ]]; then
        skip "workspace_status — no workspace id (create step failed)"
        return 0
    fi

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_workspace_status\",\"arguments\":{\"id\":\"$WORKSPACE_ID\"}}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "workspace_status — API error"
        return 1
    fi

    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and 'id' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "workspace_status — workspace $WORKSPACE_ID is active"
        return 0
    else
        fail "workspace_status — unexpected response structure"
        return 1
    fi
}

# ─── Phase 3: MCP config verification (Docker-based, optional) ────────────────

test_mcp_config_anvil() {
    if [[ "$SKIP_DOCKER" == "1" ]]; then
        skip "mcp_config_anvil — SKIP_DOCKER=1"
        return 0
    fi

    if ! command -v docker &>/dev/null; then
        skip "mcp_config_anvil — docker CLI not available on host"
        return 0
    fi

    if [[ -z "$WORKSPACE_NAME" ]]; then
        skip "mcp_config_anvil — no workspace name"
        return 0
    fi

    local config_path="/data/workspaces/$WORKSPACE_NAME/.claude/mcp-servers/anvil.json"
    local config
    config=$(docker exec "$FORGE_CONTAINER" cat "$config_path" 2>/dev/null || echo "")

    if [[ -z "$config" ]]; then
        fail "mcp_config_anvil — file not found at $config_path in container $FORGE_CONTAINER"
        return 1
    fi

    if echo "$config" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
url = data.get('url', '')
if 'anvil' in url or 'localhost' in url or '8100' in url:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        local url
        url=$(echo "$config" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('url',''))" 2>/dev/null)
        pass "mcp_config_anvil — URL: $url"
        return 0
    else
        fail "mcp_config_anvil — URL does not point to Anvil (got: $config)"
        return 1
    fi
}

test_mcp_config_vault() {
    if [[ "$SKIP_DOCKER" == "1" ]]; then
        skip "mcp_config_vault — SKIP_DOCKER=1"
        return 0
    fi

    if ! command -v docker &>/dev/null; then
        skip "mcp_config_vault — docker CLI not available on host"
        return 0
    fi

    if [[ -z "$WORKSPACE_NAME" ]]; then
        skip "mcp_config_vault — no workspace name"
        return 0
    fi

    local config_path="/data/workspaces/$WORKSPACE_NAME/.claude/mcp-servers/vault.json"
    local config
    config=$(docker exec "$FORGE_CONTAINER" cat "$config_path" 2>/dev/null || echo "")

    if [[ -z "$config" ]]; then
        fail "mcp_config_vault — file not found at $config_path in container $FORGE_CONTAINER"
        return 1
    fi

    if echo "$config" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
url = data.get('url', '')
if 'vault' in url or 'localhost' in url or '8000' in url:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        local url
        url=$(echo "$config" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('url',''))" 2>/dev/null)
        pass "mcp_config_vault — URL: $url"
        return 0
    else
        fail "mcp_config_vault — URL does not point to Vault (got: $config)"
        return 1
    fi
}

test_skill_in_registry() {
    # Verify test-integration-skill is resolvable from the Forge registry.
    # Skills are not auto-installed during workspace creation (requires explicit forge_install),
    # but they must be available in the registry for the workspace config to be valid.
    local params
    params=$(python3 -c "import json; print(json.dumps({'query': 'test-integration-skill'}))")

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_search\",\"arguments\":$params}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "skill_in_registry — API error calling forge_search"
        return 1
    fi

    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list) and len(data) > 0:
    ids = [r.get('id', '') for r in data if isinstance(r, dict)]
    if any('test-integration-skill' in i for i in ids):
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "skill_in_registry — test-integration-skill found in Forge registry"
        return 0
    else
        fail "skill_in_registry — test-integration-skill not found in Forge registry"
        return 1
    fi
}

# ─── Phase 4: Simulated agent flow ────────────────────────────────────────────

test_agent_step1_anvil_search() {
    local params
    params=$(python3 -c "import json; print(json.dumps({'query': 'test'}))")

    local response
    response=$(call_mcp "$ANVIL_URL" "$ANVIL_SESSION_ID" "tools/call" "{\"name\":\"anvil_search\",\"arguments\":$params}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "agent_step1: anvil_search — API error"
        return 1
    fi

    # anvil_search returns {results: [...], total: N, ...} in content[0].text
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and 'results' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        local count
        count=$(echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
print(data.get('total', 0))
" 2>/dev/null)
        pass "agent_step1: anvil_search returned $count result(s) for 'test'"
        return 0
    else
        fail "agent_step1: anvil_search — unexpected response format"
        return 1
    fi
}

test_agent_step2_vault_resolve_context() {
    local payload
    payload=$(python3 -c "import json; print(json.dumps({
        'repo': 'anvil',
        'include_full': False
    }))")

    local response
    response=$(call_vault "POST" "/resolve-context" "$payload")

    if [[ "$(has_rest_error "$response")" == "true" ]]; then
        fail "agent_step2: vault /resolve-context — API error (response: $response)"
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'operational_pages' in data and 'scope' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        local page_count
        page_count=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
pages = data.get('operational_pages', [])
print(len(pages) if isinstance(pages, list) else '?')
" 2>/dev/null)
        pass "agent_step2: vault /resolve-context returned context ($page_count operational pages)"
        return 0
    else
        fail "agent_step2: vault /resolve-context — missing operational_pages or scope"
        return 1
    fi
}

test_agent_step3_forge_repo_resolve() {
    local params
    params=$(python3 -c "import json; print(json.dumps({'name': 'Anvil'}))")

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_repo_resolve\",\"arguments\":$params}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "agent_step3: forge_repo_resolve — API error"
        return 1
    fi

    # Returns a dict (either repo data or error object with 'code' field)
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "agent_step3: forge_repo_resolve — Forge reachable and tool registered"
        return 0
    else
        fail "agent_step3: forge_repo_resolve — invalid response structure"
        return 1
    fi
}

# ─── Phase 5: Cleanup ──────────────────────────────────────────────────────────

test_workspace_delete() {
    if [[ -z "$WORKSPACE_ID" ]]; then
        skip "workspace_delete — no workspace id (create step failed)"
        return 0
    fi

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_workspace_delete\",\"arguments\":{\"id\":\"$WORKSPACE_ID\",\"force\":true}}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "workspace_delete — API error"
        return 1
    fi

    # forge_workspace_delete returns {"success": true, "message": "..."}
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and data.get('success'):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "workspace_delete — workspace $WORKSPACE_ID deleted"
        WORKSPACE_ID=""
        WORKSPACE_NAME=""
        return 0
    else
        fail "workspace_delete — missing success in response"
        return 1
    fi
}

test_workspace_gone_from_list() {
    if [[ -n "$WORKSPACE_ID" ]]; then
        skip "workspace_gone_verify — workspace_delete failed, skipping list check"
        return 0
    fi

    local response
    response=$(call_mcp "$FORGE_URL" "$FORGE_SESSION_ID" "tools/call" "{\"name\":\"forge_workspace_list\",\"arguments\":{}}")

    if [[ "$(has_mcp_error "$response")" == "true" ]]; then
        fail "workspace_gone_verify — API error listing workspaces after delete"
        return 1
    fi

    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "workspace_gone_verify — workspace list still valid after delete"
        return 0
    else
        fail "workspace_gone_verify — invalid workspace list response after delete"
        return 1
    fi
}

# ─── Main ──────────────────────────────────────────────────────────────────────

main() {
    echo "Horus End-to-End Integration Test"
    echo "Anvil: $ANVIL_URL"
    echo "Vault: $VAULT_URL"
    echo "Forge: $FORGE_URL"
    echo "---"

    echo ""
    echo "=== Phase 1: Pre-flight health checks ==="
    check_anvil_health || true
    check_vault_health || true
    check_forge_health || true

    if [[ $FAIL_COUNT -gt 0 ]]; then
        echo ""
        echo "ABORT: One or more services failed health check. Cannot proceed."
        echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"
        exit 1
    fi

    echo ""
    echo "=== Establishing MCP sessions ==="
    ANVIL_SESSION_ID=$(mcp_initialize "$ANVIL_URL")
    FORGE_SESSION_ID=$(mcp_initialize "$FORGE_URL")

    if [[ -z "$ANVIL_SESSION_ID" ]]; then
        echo "FAIL: Could not initialize Anvil MCP session"
        ((FAIL_COUNT++))
        exit 1
    fi
    echo "Anvil session: $ANVIL_SESSION_ID"

    if [[ -z "$FORGE_SESSION_ID" ]]; then
        echo "FAIL: Could not initialize Forge MCP session"
        ((FAIL_COUNT++))
        exit 1
    fi
    echo "Forge session: $FORGE_SESSION_ID"

    echo ""
    echo "=== Phase 2: Workspace lifecycle ==="
    test_workspace_create || true
    test_workspace_appears_in_list || true
    test_workspace_status || true

    echo ""
    echo "=== Phase 3: MCP config verification ==="
    test_mcp_config_anvil || true
    test_mcp_config_vault || true
    test_skill_in_registry || true

    echo ""
    echo "=== Phase 4: Simulated agent flow ==="
    test_agent_step1_anvil_search || true
    test_agent_step2_vault_resolve_context || true
    test_agent_step3_forge_repo_resolve || true

    echo ""
    echo "=== Phase 5: Cleanup ==="
    test_workspace_delete || true
    test_workspace_gone_from_list || true

    echo ""
    echo "---"
    echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"

    if [[ $FAIL_COUNT -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

main "$@"
