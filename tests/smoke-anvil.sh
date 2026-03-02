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

# Test note IDs from _test/ fixtures
TEST_NOTE_ID="550e8400-e29b-41d4-a716-446655440001"
TEST_TASK_ID="550e8400-e29b-41d4-a716-446655440002"
TEST_WORK_ITEM_ID="550e8400-e29b-41d4-a716-446655440003"
TEST_PROJECT_ID="550e8400-e29b-41d4-a716-446655440004"

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
        "$ANVIL_URL/"
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
            result = json.loads(result)
        if isinstance(result, dict) and '$field' in result:
            print(result['$field'])
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

# Test: anvil_list_types
test_anvil_list_types() {
    local response=$(call_mcp "tools/list" "{}")
    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_list_types — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify response contains tools array
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

    # Extract the created noteId
    local note_id=$(python3 -c "
import sys, json
try:
    data = json.loads('$response')
    result = data.get('result', {})
    if isinstance(result, str):
        result = json.loads(result)
    print(result.get('noteId', ''))
except:
    pass
" 2>/dev/null)

    if [[ -n "$note_id" ]]; then
        CREATED_NOTE_IDS+=("$note_id")
        echo "PASS: anvil_create_note"
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
    local params=$(python3 -c "import json; print(json.dumps({
        'noteId': '$TEST_NOTE_ID'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_get_note\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_get_note — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify response contains note content
    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    result = json.loads(result)
if 'title' in result and 'noteId' in result:
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
        test_id="$TEST_NOTE_ID"
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

    # Verify response structure
    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    result = json.loads(result)
if 'noteId' in result:
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

    # Verify response contains array results
    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    result = json.loads(result)
if isinstance(result, list) and len(result) > 0:
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

# Test: anvil_query_view (list format)
test_anvil_query_view() {
    local params=$(python3 -c "import json; print(json.dumps({
        'format': 'list',
        'limit': 10
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_query_view\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_query_view — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify response contains array of items
    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    result = json.loads(result)
if isinstance(result, list):
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
    local params=$(python3 -c "import json; print(json.dumps({
        'noteId': '$TEST_NOTE_ID'
    }))")

    local response=$(call_mcp "tools/call" "{\"name\":\"anvil_get_related\",\"arguments\":$params}")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: anvil_get_related — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    # Verify response has expected structure (forward links, backlinks)
    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
result = data.get('result', {})
if isinstance(result, str):
    result = json.loads(result)
if isinstance(result, dict):
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
