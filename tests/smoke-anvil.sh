#!/bin/bash

# Smoke test for Anvil MCP server
# Validates all 7 Anvil MCP tools via HTTP curl against a running Anvil server

set -u

# Configuration
ANVIL_URL="${ANVIL_URL:-http://localhost:8100}"
TIMEOUT=10
PASS_COUNT=0
FAIL_COUNT=0
CREATED_NOTE_IDS=()
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
        "$ANVIL_URL/")
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
        "$ANVIL_URL/")
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

# Test: anvil_list_types
test_anvil_list_types() {
    local response=$(call_mcp "tools/list" "{}")
    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_list_types — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify response contains tools array with required tool names
    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    result = json.loads(result)
tools = result.get('tools', [])
tool_names = [t.get('name') for t in tools]
required = ['anvil_create_note', 'anvil_get_note', 'anvil_update_note', 'anvil_search', 'anvil_query_view', 'anvil_list_types', 'anvil_get_related']
for tool in required:
    if tool not in tool_names:
        sys.exit(1)
sys.exit(0)
" 2>/dev/null; then
        echo "PASS: anvil_list_types"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_list_types — missing required tools"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test: anvil_create_note
test_anvil_create_note() {
    local params=$(python3 -c "import json; print(json.dumps({
        'type': 'note',
        'title': 'Smoke Test Note',
        'content': 'This is a temporary test note for smoke testing.',
        'use_template': True
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_create_note\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_create_note — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Unwrap content[0].text and extract noteId
    local note_id=$(echo "$response" | get_tool_output | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('noteId', ''))
except:
    pass
" 2>/dev/null)

    if [[ -n "$note_id" ]]; then
        CREATED_NOTE_IDS+=("$note_id")
        echo "PASS: anvil_create_note (id: $note_id)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_create_note — no noteId in response"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test: anvil_get_note
test_anvil_get_note() {
    # Use a note created by this test run if available
    local test_id="${CREATED_NOTE_IDS[0]:-}"
    if [[ -z "$test_id" ]]; then
        echo "SKIP: anvil_get_note — no note created to fetch"
        return 0
    fi

    local params=$(python3 -c "import json; print(json.dumps({'noteId': '$test_id'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_get_note\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_get_note — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify unwrapped output has title and noteId
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'title' in data and 'noteId' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: anvil_get_note"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_get_note — missing required fields"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test: anvil_update_note
test_anvil_update_note() {
    local test_id="${CREATED_NOTE_IDS[0]:-}"
    if [[ -z "$test_id" ]]; then
        echo "SKIP: anvil_update_note — no note created to update"
        return 0
    fi

    local params=$(python3 -c "import json; print(json.dumps({
        'noteId': '$test_id',
        'fields': {
            'tags': ['smoke-test', 'updated']
        }
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_update_note\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_update_note — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify unwrapped output has noteId
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'noteId' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: anvil_update_note"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_update_note — invalid response structure"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test: anvil_search
test_anvil_search() {
    # Give the search index a moment to catch up
    sleep 1

    local params=$(python3 -c "import json; print(json.dumps({
        'query': 'Test'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_search\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_search — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify unwrapped output has a results array
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
# Search returns {results: [...], total: N, ...}
if isinstance(data, dict) and 'results' in data and len(data['results']) > 0:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: anvil_search"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_search — no results or invalid format"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test: anvil_query_view (list view)
test_anvil_query_view() {
    local params=$(python3 -c "import json; print(json.dumps({
        'view': 'list',
        'limit': 10
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_query_view\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_query_view — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify unwrapped output has items array (query_view returns {view, items, total, ...})
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and 'items' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: anvil_query_view"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_query_view — invalid response structure"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test: anvil_get_related
test_anvil_get_related() {
    local test_id="${CREATED_NOTE_IDS[0]:-}"
    if [[ -z "$test_id" ]]; then
        echo "SKIP: anvil_get_related — no note created to fetch related for"
        return 0
    fi

    local params=$(python3 -c "import json; print(json.dumps({'noteId': '$test_id'}))")
    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_get_related\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_get_related — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify unwrapped output has forward and reverse relationship keys
    if echo "$response" | get_tool_output | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if isinstance(data, dict) and 'forward' in data and 'reverse' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: anvil_get_related"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: anvil_get_related — invalid response structure"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Main execution
main() {
    echo "Anvil MCP Smoke Test"
    echo "URL: $ANVIL_URL"
    echo "---"

    # Initialize MCP session
    mcp_initialize
    if [[ -z "$SESSION_ID" ]]; then
        echo "FAIL: Could not establish MCP session (no session ID returned)"
        exit 1
    fi

    # Run all tests
    test_anvil_list_types || true
    test_anvil_create_note || true
    test_anvil_get_note || true
    test_anvil_update_note || true
    test_anvil_search || true
    test_anvil_query_view || true
    test_anvil_get_related || true

    echo "---"
    echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"

    if [[ $FAIL_COUNT -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

main "$@"
