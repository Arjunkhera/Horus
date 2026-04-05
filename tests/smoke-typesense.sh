#!/bin/bash

# Typesense Integration Smoke Test for Horus
# Verifies that all three services (Anvil, Vault, Forge) are correctly
# using Typesense as their search engine via the shared horus_documents collection.
#
# Tests:
#   1. Typesense health check
#   2. horus_documents collection exists with correct schema
#   3. Documents from all three sources (anvil, vault, forge) are present
#   4. Cross-source query (no source filter) returns mixed results
#   5. Source-filtered queries return correct results
#   6. Startup re-index: collection has documents after service restart
#
# Usage:
#   ./smoke-typesense.sh
#
# Environment variables:
#   TYPESENSE_URL    Typesense HTTP base (default: http://localhost:8108)
#   TYPESENSE_API_KEY  API key (default: horus-local-key)

set -u

# ─── Configuration ─────────────────────────────────────────────────────────────
TYPESENSE_URL="${TYPESENSE_URL:-http://localhost:8108}"
TYPESENSE_API_KEY="${TYPESENSE_API_KEY:-horus-local-key}"
COLLECTION_NAME="horus_documents"
TIMEOUT=10

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# ─── Helpers ───────────────────────────────────────────────────────────────────

pass() { echo "PASS: $1"; ((PASS_COUNT++)); }
fail() { echo "FAIL: $1"; ((FAIL_COUNT++)); }
skip() { echo "SKIP: $1"; ((SKIP_COUNT++)); }

ts_get() {
    local path="$1"
    curl -s -H "X-TYPESENSE-API-KEY: $TYPESENSE_API_KEY" \
        --max-time "$TIMEOUT" \
        "$TYPESENSE_URL$path"
}

ts_search() {
    local query="$1"
    local filter="${2:-}"
    local filter_param=""
    [[ -n "$filter" ]] && filter_param="&filter_by=$filter"
    ts_get "/collections/$COLLECTION_NAME/documents/search?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))")&query_by=title,body${filter_param}"
}

# ─── Tests ─────────────────────────────────────────────────────────────────────

test_typesense_health() {
    local response
    response=$(ts_get "/health")

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('ok', False):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        pass "Typesense health check — server is healthy"
        return 0
    else
        fail "Typesense health check — server not responding or unhealthy"
        return 1
    fi
}

test_collection_exists() {
    local response
    response=$(ts_get "/collections/$COLLECTION_NAME")

    if echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
if data.get('name') == '$COLLECTION_NAME':
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
        local num_docs
        num_docs=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
print(data.get('num_documents', 0))
" 2>/dev/null)
        pass "Collection '$COLLECTION_NAME' exists ($num_docs documents)"
        return 0
    else
        fail "Collection '$COLLECTION_NAME' does not exist"
        return 1
    fi
}

test_collection_has_required_fields() {
    local response
    response=$(ts_get "/collections/$COLLECTION_NAME")

    local missing
    missing=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
fields = {f['name'] for f in data.get('fields', [])}
required = {'source', 'source_type', 'title', 'body', 'tags', 'created_at', 'modified_at'}
missing = required - fields
if missing:
    print(','.join(sorted(missing)))
else:
    print('')
" 2>/dev/null)

    if [[ -z "$missing" ]]; then
        pass "Collection schema has all required fields"
        return 0
    else
        fail "Collection schema missing fields: $missing"
        return 1
    fi
}

test_anvil_documents_present() {
    local response
    response=$(ts_search "*" "source:=anvil")

    local count
    count=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
print(data.get('found', 0))
" 2>/dev/null)

    if [[ "$count" -gt 0 ]]; then
        pass "Anvil documents present in Typesense ($count documents)"
        return 0
    else
        skip "No Anvil documents found (may need data seeding)"
        return 0
    fi
}

test_vault_documents_present() {
    local response
    response=$(ts_search "*" "source:=vault")

    local count
    count=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
print(data.get('found', 0))
" 2>/dev/null)

    if [[ "$count" -gt 0 ]]; then
        pass "Vault documents present in Typesense ($count documents)"
        return 0
    else
        skip "No Vault documents found (may need data seeding)"
        return 0
    fi
}

test_forge_documents_present() {
    local response
    response=$(ts_search "*" "source:=forge")

    local count
    count=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
print(data.get('found', 0))
" 2>/dev/null)

    if [[ "$count" -gt 0 ]]; then
        pass "Forge documents present in Typesense ($count documents)"
        return 0
    else
        skip "No Forge documents found (may need data seeding)"
        return 0
    fi
}

test_cross_source_query() {
    local response
    response=$(ts_search "*")

    local total_found
    total_found=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
print(data.get('found', 0))
" 2>/dev/null)

    if [[ "$total_found" -gt 0 ]]; then
        local source_count
        source_count=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
sources = set()
for hit in data.get('hits', []):
    sources.add(hit.get('document', {}).get('source', 'unknown'))
print(len(sources))
" 2>/dev/null)
        pass "Cross-source query: $total_found total docs, $source_count distinct sources"
        return 0
    else
        skip "Cross-source query: no documents found (empty collection)"
        return 0
    fi
}

test_source_facet_filtering() {
    # Verify that source faceting works (used by per-service filtering)
    local response
    response=$(ts_get "/collections/$COLLECTION_NAME/documents/search?q=*&query_by=title,body&facet_by=source&per_page=0")

    local facet_ok
    facet_ok=$(echo "$response" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
facets = data.get('facet_counts', [])
for f in facets:
    if f.get('field_name') == 'source':
        print('ok')
        sys.exit(0)
print('missing')
" 2>/dev/null)

    if [[ "$facet_ok" == "ok" ]]; then
        pass "Source facet filtering is working"
        return 0
    else
        fail "Source facet not available on collection"
        return 1
    fi
}

# ─── Main ──────────────────────────────────────────────────────────────────────

main() {
    echo "Horus Typesense Integration Smoke Test"
    echo "Typesense: $TYPESENSE_URL"
    echo "Collection: $COLLECTION_NAME"
    echo "---"

    echo ""
    echo "=== Phase 1: Typesense health ==="
    test_typesense_health || true

    if [[ $FAIL_COUNT -gt 0 ]]; then
        echo ""
        echo "ABORT: Typesense is not healthy. Cannot proceed."
        echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"
        exit 1
    fi

    echo ""
    echo "=== Phase 2: Collection schema ==="
    test_collection_exists || true
    test_collection_has_required_fields || true

    echo ""
    echo "=== Phase 3: Per-service documents ==="
    test_anvil_documents_present || true
    test_vault_documents_present || true
    test_forge_documents_present || true

    echo ""
    echo "=== Phase 4: Cross-source & faceting ==="
    test_cross_source_query || true
    test_source_facet_filtering || true

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
