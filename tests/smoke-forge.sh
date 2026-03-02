#!/bin/bash

# Smoke test for Forge MCP server
# Validates all Forge MCP tools via HTTP curl against a running Forge MCP server

set -u

# Configuration
FORGE_URL="${FORGE_URL:-http://localhost:8200}"
TIMEOUT=10
PASS_COUNT=0
FAIL_COUNT=0
CREATED_WORKSPACE_ID=""

# Helper: Make MCP JSON-RPC call via HTTP POST
# Arguments: $1 = method, $2 = JSON params
call_mcp() {
    local method="$1"
    local params="${2}"
    [[ -z "$params" ]] && params="{}"
    local req_id=$((RANDOM % 10000 + 1))

    # Build JSON payload directly — $params is already valid JSON
    local payload="{\"jsonrpc\":\"2.0\",\"id\":$req_id,\"method\":\"$method\",\"params\":$params}"

    curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "$payload" \
        --max-time "$TIMEOUT" \
        "$FORGE_URL/"
}

# Helper: Extract field from JSON response
extract_field() {
    local json="$1"
    local field="$2"
    python3 -c "
import sys, json
try:
    data = json.loads('$json')
    if 'result' in data:
        result = data['result']
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except:
                pass
        if isinstance(result, dict) and '$field' in result:
            val = result['$field']
            if isinstance(val, (dict, list)):
                print(json.dumps(val))
            else:
                print(val)
except Exception as e:
    pass
" 2>/dev/null || echo ""
}

# Helper: Check if JSON contains an error
has_error() {
    local json="$1"
    python3 -c "
import sys, json
try:
    data = json.loads('$json')
    if 'error' in data:
        print('true')
    else:
        print('false')
except:
    print('true')
" 2>/dev/null
}

# Test 1: forge_list (available)
test_forge_list_available() {
    local params=$(python3 -c "import json; print(json.dumps({
        'scope': 'available'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_list\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_list (available) — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'artifacts' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_list (available)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_list (available) — missing artifacts in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 2: forge_list (installed)
test_forge_list_installed() {
    local params=$(python3 -c "import json; print(json.dumps({
        'scope': 'installed'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_list\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_list (installed) — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'artifacts' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_list (installed)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_list (installed) — missing artifacts in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 3: forge_search
test_forge_search() {
    local params=$(python3 -c "import json; print(json.dumps({
        'query': 'test'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_search\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_search — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'results' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_search"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_search — missing results in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 4: forge_repo_list
test_forge_repo_list() {
    local params=$(python3 -c "import json; print(json.dumps({}))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_repo_list\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_repo_list — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'repos' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_repo_list"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_repo_list — missing repos in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 5: forge_repo_resolve
test_forge_repo_resolve() {
    local params=$(python3 -c "import json; print(json.dumps({
        'name': 'Anvil'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_repo_resolve\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        # forge_repo_resolve may fail if Anvil is not indexed, which is acceptable in smoke test
        echo "FAIL: forge_repo_resolve — API error (may be acceptable if repo not indexed)"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_repo_resolve"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_repo_resolve — missing repo data in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 6: forge_workspace_create
test_forge_workspace_create() {
    local params=$(python3 -c "import json; print(json.dumps({
        'config': 'test-workspace',
        'configVersion': 'latest',
        'storyId': 'STORY-999',
        'storyTitle': 'Smoke Test Workspace'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_workspace_create\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_workspace_create — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Extract workspace ID from response for cleanup
    local ws_id=$(python3 -c "
import sys, json
try:
    data = json.loads('$response')
    result = data.get('result', {})
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except:
            pass
    if isinstance(result, dict) and 'id' in result:
        print(result['id'])
except:
    pass
" 2>/dev/null)

    if [[ -n "$ws_id" ]]; then
        CREATED_WORKSPACE_ID="$ws_id"
        echo "PASS: forge_workspace_create (id: $ws_id)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_workspace_create — missing workspace id in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 7: forge_workspace_list
test_forge_workspace_list() {
    local params=$(python3 -c "import json; print(json.dumps({}))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_workspace_list\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_workspace_list — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'workspaces' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_workspace_list"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_workspace_list — missing workspaces in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 8: forge_workspace_status
test_forge_workspace_status() {
    # Use the created workspace ID, or skip if none exists
    if [[ -z "$CREATED_WORKSPACE_ID" ]]; then
        echo "SKIP: forge_workspace_status — no workspace created"
        return 0
    fi

    local params=$(python3 -c "import json; print(json.dumps({
        'id': '$CREATED_WORKSPACE_ID'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_workspace_status\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_workspace_status — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'id' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_workspace_status"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_workspace_status — missing id in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 9: forge_workspace_delete
test_forge_workspace_delete() {
    # Use the created workspace ID, or skip if none exists
    if [[ -z "$CREATED_WORKSPACE_ID" ]]; then
        echo "SKIP: forge_workspace_delete — no workspace created"
        return 0
    fi

    local params=$(python3 -c "import json; print(json.dumps({
        'id': '$CREATED_WORKSPACE_ID',
        'force': True
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_workspace_delete\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_workspace_delete — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    try:
        result = json.loads(result)
    except:
        pass
if isinstance(result, dict) and 'deleted' in result:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_workspace_delete"
        ((PASS_COUNT++))
        CREATED_WORKSPACE_ID=""
        return 0
    else
        echo "FAIL: forge_workspace_delete — missing deleted in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Main execution
main() {
    echo "Forge MCP Smoke Test"
    echo "URL: $FORGE_URL"
    echo "---"

    # Run all tests
    test_forge_list_available || true
    test_forge_list_installed || true
    test_forge_search || true
    test_forge_repo_list || true
    test_forge_repo_resolve || true
    test_forge_workspace_create || true
    test_forge_workspace_list || true
    test_forge_workspace_status || true
    test_forge_workspace_delete || true

    echo "---"
    echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"

    if [[ $FAIL_COUNT -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

main "$@"
