#!/bin/bash

# Master smoke test script for Horus Integration
# Runs Vault, Forge, and Anvil smoke tests in sequence and reports combined summary

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration from environment or defaults
VAULT_URL="${VAULT_URL:-http://localhost:8000}"
FORGE_URL="${FORGE_URL:-http://localhost:8200}"
ANVIL_URL="${ANVIL_URL:-http://localhost:8100}"

# Track results
declare -A results
total_pass=0
total_fail=0

echo "=========================================="
echo "Horus Integration Smoke Tests"
echo "=========================================="
echo "Vault:  $VAULT_URL"
echo "Forge:  $FORGE_URL"
echo "Anvil:  $ANVIL_URL"
echo "=========================================="
echo ""

# Run Vault smoke tests
echo "Running Vault tests..."
if VAULT_URL="$VAULT_URL" bash "$SCRIPT_DIR/smoke-vault.sh" > /tmp/vault_output.txt 2>&1; then
    results[vault]="PASS"
    vault_pass=$(grep "^PASS:" /tmp/vault_output.txt | wc -l)
    vault_fail=$(grep "^FAIL:" /tmp/vault_output.txt | wc -l)
    cat /tmp/vault_output.txt
    total_pass=$((total_pass + vault_pass))
else
    results[vault]="FAIL"
    vault_pass=$(grep "^PASS:" /tmp/vault_output.txt | wc -l)
    vault_fail=$(grep "^FAIL:" /tmp/vault_output.txt | wc -l)
    cat /tmp/vault_output.txt
    total_pass=$((total_pass + vault_pass))
    total_fail=$((total_fail + vault_fail + 1))
fi
echo ""

# Run Forge smoke tests
echo "Running Forge tests..."
if FORGE_URL="$FORGE_URL" bash "$SCRIPT_DIR/smoke-forge.sh" > /tmp/forge_output.txt 2>&1; then
    results[forge]="PASS"
    forge_pass=$(grep "^PASS:" /tmp/forge_output.txt | wc -l)
    forge_fail=$(grep "^FAIL:" /tmp/forge_output.txt | wc -l)
    cat /tmp/forge_output.txt
    total_pass=$((total_pass + forge_pass))
else
    results[forge]="FAIL"
    forge_pass=$(grep "^PASS:" /tmp/forge_output.txt | wc -l)
    forge_fail=$(grep "^FAIL:" /tmp/forge_output.txt | wc -l)
    cat /tmp/forge_output.txt
    total_pass=$((total_pass + forge_pass))
    total_fail=$((total_fail + forge_fail + 1))
fi
echo ""

# Run Anvil smoke tests
echo "Running Anvil tests..."
if ANVIL_URL="$ANVIL_URL" bash "$SCRIPT_DIR/smoke-anvil.sh" > /tmp/anvil_output.txt 2>&1; then
    results[anvil]="PASS"
    anvil_pass=$(grep "^PASS:" /tmp/anvil_output.txt | wc -l)
    anvil_fail=$(grep "^FAIL:" /tmp/anvil_output.txt | wc -l)
    cat /tmp/anvil_output.txt
    total_pass=$((total_pass + anvil_pass))
else
    results[anvil]="FAIL"
    anvil_pass=$(grep "^PASS:" /tmp/anvil_output.txt | wc -l)
    anvil_fail=$(grep "^FAIL:" /tmp/anvil_output.txt | wc -l)
    cat /tmp/anvil_output.txt
    total_pass=$((total_pass + anvil_pass))
    total_fail=$((total_fail + anvil_fail + 1))
fi
echo ""

# Print combined summary
echo "=========================================="
echo "COMBINED SUMMARY"
echo "=========================================="
echo "Vault:  ${results[vault]}"
echo "Forge:  ${results[forge]}"
echo "Anvil:  ${results[anvil]}"
echo ""
echo "Total Results: $total_pass passed, $total_fail failed"
echo "=========================================="

# Exit with appropriate code
if [[ ${results[vault]} == "PASS" && ${results[forge]} == "PASS" && ${results[anvil]} == "PASS" ]]; then
    exit 0
else
    exit 1
fi
