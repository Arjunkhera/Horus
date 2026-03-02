#!/bin/bash

# Smoke test for Vault REST API
# Validates all 10 Vault endpoints via HTTP curl against a running Vault server

set -u

# Configuration
VAULT_URL="${VAULT_URL:-http://localhost:8000}"
TIMEOUT=10
PASS_COUNT=0
FAIL_COUNT=0
CREATED_REGISTRY_ENTRY=""

# Helper: Make HTTP call with proper error handling
call_rest() {
    local method="$1"
    local path="$2"
    local data="${3:-}"

    local args=(-s -X "$method" -H "Content-Type: application/json")

    if [[ -n "$data" ]]; then
        args+=(-d "$data")
    fi

    args+=(--max-time "$TIMEOUT" "$VAULT_URL$path")

    curl "${args[@]}"
}

# Helper: Extract field from JSON response
extract_field() {
    local json="$1"
    local field="$2"
    python3 -c "
import sys, json
try:
    data = json.loads('$json')
    if isinstance(data, dict) and '$field' in data:
        val = data['$field']
        if isinstance(val, (dict, list)):
            print(json.dumps(val))
        else:
            print(val)
except Exception as e:
    pass
" 2>/dev/null || echo ""
}

# Helper: Check if response contains error
has_error() {
    local json="$1"
    python3 -c "
import sys, json
try:
    data = json.loads('$json')
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

# Test 1: GET /health
test_health() {
    local response=$(call_rest "GET" "/health")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: health — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('status') == 'ok' and data.get('service') == 'knowledge-service':
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: health"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: health — missing required fields"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 2: GET /schema
test_schema() {
    local response=$(call_rest "GET" "/schema")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: schema — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('version') is not None and 'page_types' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: schema"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: schema — missing version or page_types"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 3: POST /search
test_search() {
    local payload=$(python3 -c "import json; print(json.dumps({
        'query': 'anvil',
        'limit': 5
    }))")

    local response=$(call_rest "POST" "/search" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: search — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'results' in data and 'total' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: search"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: search — missing results or total"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 4: POST /resolve-context
test_resolve_context() {
    local payload=$(python3 -c "import json; print(json.dumps({
        'repo': 'anvil',
        'include_full': False
    }))")

    local response=$(call_rest "POST" "/resolve-context" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: resolve-context — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'operational_pages' in data and 'scope' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: resolve-context"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: resolve-context — missing operational_pages or scope"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 5: POST /validate-page (valid content)
test_validate_page_valid() {
    local content='---
title: Test Page
type: guide
mode: reference
scope:
  program: test-program
---

# Test Content

This is a test page for validation.'

    local payload=$(python3 -c "
import json
content = '''$content'''
print(json.dumps({'content': content}))
")

    local response=$(call_rest "POST" "/validate-page" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: validate-page (valid) — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'valid' in data and 'errors' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: validate-page (valid)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: validate-page (valid) — missing valid or errors fields"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 6: POST /validate-page (invalid content)
test_validate_page_invalid() {
    local content='---
type: invalid-type
---

# Invalid content'

    local payload=$(python3 -c "
import json
content = '''$content'''
print(json.dumps({'content': content}))
")

    local response=$(call_rest "POST" "/validate-page" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: validate-page (invalid) — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'valid' in data and 'errors' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: validate-page (invalid)"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: validate-page (invalid) — missing valid or errors fields"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 7: POST /suggest-metadata
test_suggest_metadata() {
    local content='# Some New Topic

This is content about a new development topic.'

    local payload=$(python3 -c "
import json
content = '''$content'''
print(json.dumps({'content': content, 'hints': {}}))
")

    local response=$(call_rest "POST" "/suggest-metadata" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: suggest-metadata — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'kb_status' in data and 'suggestions' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: suggest-metadata"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: suggest-metadata — missing kb_status or suggestions"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 8: POST /check-duplicates
test_check_duplicates() {
    local payload=$(python3 -c "import json; print(json.dumps({
        'title': 'Novel Content Page',
        'content': 'This is completely unique content that should not match any existing pages.',
        'threshold': 0.75
    }))")

    local response=$(call_rest "POST" "/check-duplicates" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: check-duplicates — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'matches' in data and 'has_conflicts' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: check-duplicates"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: check-duplicates — missing matches or has_conflicts"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 9: POST /list-by-scope
test_list_by_scope() {
    local payload=$(python3 -c "import json; print(json.dumps({
        'scope': {'program': 'anvil-forge-vault'},
        'limit': 10
    }))")

    local response=$(call_rest "POST" "/list-by-scope" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: list-by-scope — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if 'pages' in data and 'total' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        echo "PASS: list-by-scope"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: list-by-scope — missing pages or total"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Test 10: POST /registry/add
test_registry_add() {
    local timestamp=$(date +%s%N | cut -b1-13)
    local test_tag="smoke-test-tag-$timestamp"

    local payload=$(python3 -c "
import json
print(json.dumps({
    'registry': 'tags',
    'entry': {
        'id': '$test_tag',
        'description': 'Smoke test registry entry',
        'aliases': ['smoke-test'],
        'scope_program': 'test-program'
    }
}))
")

    local response=$(call_rest "POST" "/registry/add" "$payload")

    if [[ "$(has_error "$response")" == "true" ]]; then
        echo "FAIL: registry/add — API error"
        ((FAIL_COUNT++))
        return 1
    fi

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('added') == True and 'entry' in data and 'total_entries' in data:
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        CREATED_REGISTRY_ENTRY="$test_tag"
        echo "PASS: registry/add"
        ((PASS_COUNT++))
        return 0
    else
        echo "FAIL: registry/add — missing added, entry, or total_entries"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Main execution
main() {
    echo "Vault Knowledge Service Smoke Test"
    echo "URL: $VAULT_URL"
    echo "---"

    # Run all tests
    test_health || true
    test_schema || true
    test_search || true
    test_resolve_context || true
    test_validate_page_valid || true
    test_validate_page_invalid || true
    test_suggest_metadata || true
    test_check_duplicates || true
    test_list_by_scope || true
    test_registry_add || true

    echo "---"
    echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"

    if [[ $FAIL_COUNT -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

main "$@"
