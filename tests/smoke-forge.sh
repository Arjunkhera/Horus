#!/bin/bash

# Smoke test for Forge MCP server
# Validates all Forge MCP tools via HTTP curl against a running Forge MCP server

set -u

# Configuration
FORGE_URL="${FORGE_URL:-http://localhost:8200}"
TIMEOUT=30
PASS_COUNT=0
FAIL_COUNT=0
CREATED_WORKSPACE_ID=""
SESSION_ID=""

# Helper: Initialize MCP session and store session ID
mcp_initialize() {
    local init_payload='{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}'
    local response_with_headers
    response_with_headers=$(curl -s -D - -X POST \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "$init_payload" \
        --max-time "$TIMEOUT" \
        "$FORGE_URL/")
    SESSION_ID=$(echo "$response_with_headers" | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r\n')
}

# Helper: Make MCP JSON-RPC call via HTTP POST
# Arguments: $1 = method, $2 = JSON params
call_mcp() {
    local method="$1"
    local params="${2}"
    [[ -z "$params" ]] && params="{}"
    local req_id=$((RANDOM % 10000 + 1))

    # Build JSON payload directly — $params is already valid JSON
    local payload="{\"jsonrpc\":\"2.0\",\"id\":$req_id,\"method\":\"$method\",\"params\":$params}"

    # Build curl args array — session header added separately to avoid quoting issues
    local curl_args=(-s -X POST
        -H "Content-Type: application/json"
        -H "Accept: application/json, text/event-stream"
        -d "$payload"
        --max-time "$TIMEOUT"
        "$FORGE_URL/")
    [[ -n "$SESSION_ID" ]] && curl_args+=(-H "Mcp-Session-Id: $SESSION_ID")

    curl "${curl_args[@]}"
}

# Helper: Check if JSON response contains a top-level error
has_error() {
    local json="$1"
    echo "$json" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    if 'error' in data:
        print('true')
    else:
        print('false')
except:
    print('true')
" 2>/dev/null
}

# Helper: Unwrap MCP tools/call result from content[0].text and parse as JSON
# MCP tool call responses wrap output in: {"result": {"content": [{"type": "text", "text": "<json>"}]}}
get_tool_output() {
    python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    result = data.get('result', {})
    if isinstance(result, str):
        result = json.loads(result)
    # Unwrap MCP content array
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
except Exception as e:
    print('{}')
" 2>/dev/null
}

# Test 1: forge_list (available)
test_forge_list_available() {
    local params=$(python3 -c "import json; print(json.dumps({'scope': 'available'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"forge_list\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_list (available) — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # forge_list returns a bare list of artifact objects
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_list (available)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_list (available) — invalid response format"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 2: forge_list (installed)
test_forge_list_installed() {
    local params=$(python3 -c "import json; print(json.dumps({'scope': 'installed'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"forge_list\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_list (installed) — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # forge_list returns a bare list
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_list (installed)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_list (installed) — invalid response format"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 3: forge_search
test_forge_search() {
    local params=$(python3 -c "import json; print(json.dumps({'query': 'test'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"forge_search\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_search — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # forge_search returns a bare list of search result objects
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_search"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_search — invalid response format"
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

    # forge_repo_list returns a bare list (may be empty if no repos indexed)
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_repo_list"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_repo_list — invalid response format"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 5: forge_repo_resolve
test_forge_repo_resolve() {
    local params=$(python3 -c "import json; print(json.dumps({'name': 'Anvil'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"forge_repo_resolve\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_repo_resolve — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # forge_repo_resolve returns a dict (either repo data or error object) — both are dicts
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_repo_resolve"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_repo_resolve — invalid response format"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 6: forge_workspace_create
test_forge_workspace_create() {
    local params=$(python3 -c "import json; print(json.dumps({
        'config': 'test-workspace',
        'storyId': 'STORY-999',
        'storyTitle': 'Smoke Test Workspace'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"forge_workspace_create\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_workspace_create — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Extract workspace ID from response: {"success": true, "workspace": {"id": "ws-...", ...}}
    local ws_id=$(echo "$response" | get_tool_output | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    workspace = data.get('workspace', {})
    print(workspace.get('id', ''))
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

    # forge_workspace_list returns a bare list of workspace records
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, list):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_workspace_list"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: forge_workspace_list — invalid response format"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 8: forge_workspace_status
test_forge_workspace_status() {
    if [[ -z "$CREATED_WORKSPACE_ID" ]]; then
        echo "SKIP: forge_workspace_status — no workspace created"
        return 0
    fi

    local params=$(python3 -c "import json; print(json.dumps({'id': '$CREATED_WORKSPACE_ID'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"forge_workspace_status\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: forge_workspace_status — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # forge_workspace_status returns the workspace record dict with an id field
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and 'id' in data:
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

    # forge_workspace_delete returns {"success": true, "message": "..."}
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and data.get('success'):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: forge_workspace_delete"
        ((PASS_COUNT++))
        CREATED_WORKSPACE_ID=""
        return 0
    else
        echo "FAIL: forge_workspace_delete — missing success in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Main execution
main() {
    echo "Forge MCP Smoke Test"
    echo "URL: $FORGE_URL"
    echo "---"

    # Initialize MCP session
    mcp_initialize
    if [[ -z "$SESSION_ID" ]]; then
        echo "FAIL: Could not establish MCP session (no session ID returned)"
        exit 1
    fi

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
