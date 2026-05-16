#!/bin/bash
###############################################################################
# teardown.sh — Destroy Forge Registry infrastructure
#
# DANGER: This destroys all infrastructure. Data in S3 is protected by
# prevent_destroy but the EC2 instance, CloudFront, WAF, etc. will be gone.
#
# Usage:
#   ./teardown.sh              # Interactive confirmation
#   ./teardown.sh --force      # Skip confirmation (CI use only)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/../terraform/public-global"

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║  WARNING: This will destroy Forge Registry infrastructure ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

if [[ "$FORCE" != "true" ]]; then
  echo -e "${YELLOW}Resources that will be destroyed:${NC}"
  echo "  - EC2 instance + Elastic IP"
  echo "  - CloudFront distribution"
  echo "  - WAF Web ACL"
  echo "  - IAM roles and policies"
  echo "  - CloudWatch alarms and dashboard"
  echo "  - SNS topic"
  echo ""
  echo -e "${YELLOW}Protected (will NOT be destroyed):${NC}"
  echo "  - S3 bucket (prevent_destroy lifecycle)"
  echo ""
  read -p "Type 'destroy' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "destroy" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

cd "${TF_DIR}"
terraform destroy
