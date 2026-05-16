#!/bin/bash
###############################################################################
# deploy.sh — Full deployment orchestration for Forge Registry
#
# Runs the complete deployment pipeline:
#   1. Build + push Docker image to GHCR (linux/arm64)
#   2. Terraform plan + apply
#   3. Wait for EC2 bootstrap
#   4. Smoke test
#
# Prerequisites:
#   - gh auth (with write:packages scope)
#   - docker buildx configured
#   - terraform CLI installed
#   - AWS credentials configured (~/.aws/credentials or env vars)
#   - EC2 key pair created and .pem on disk
#   - terraform.tfvars populated (see terraform/public-global/terraform.tfvars.example)
#
# Usage:
#   ./deploy.sh              # Full deploy (build + infra + verify)
#   ./deploy.sh --skip-build # Skip Docker build, just terraform + verify
#   ./deploy.sh --plan-only  # Terraform plan without apply
#   ./deploy.sh --build-only # Build and push image only
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${SCRIPT_DIR}/.."
TF_DIR="${DEPLOY_DIR}/terraform/public-global"

# Walk up to monorepo root (5 levels from deploy/scripts/)
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"

# Configuration
GHCR_IMAGE="ghcr.io/arjunkhera/horus/forge-registry"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="linux/arm64"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
err()  { echo -e "${RED}[deploy]${NC} $*" >&2; }
info() { echo -e "${CYAN}[deploy]${NC} $*"; }

###############################################################################
# Parse arguments
###############################################################################

SKIP_BUILD=false
PLAN_ONLY=false
BUILD_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --plan-only)  PLAN_ONLY=true; shift ;;
    --build-only) BUILD_ONLY=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--skip-build|--plan-only|--build-only]"
      echo ""
      echo "Options:"
      echo "  --skip-build  Skip Docker image build, run terraform + verify only"
      echo "  --plan-only   Run terraform plan without applying"
      echo "  --build-only  Build and push Docker image only"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

###############################################################################
# Preflight checks
###############################################################################

log "Preflight checks..."

command -v docker >/dev/null 2>&1 || { err "docker not found"; exit 1; }
command -v terraform >/dev/null 2>&1 || { err "terraform not found"; exit 1; }
command -v gh >/dev/null 2>&1 || { err "gh CLI not found"; exit 1; }
command -v aws >/dev/null 2>&1 || { err "aws CLI not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq not found"; exit 1; }

# Verify gh has write:packages scope
if ! gh auth status 2>&1 | grep -q "write:packages"; then
  warn "gh auth may lack write:packages scope. Run:"
  warn "  gh auth login -h github.com -s write:packages"
fi

# Verify AWS identity
AWS_IDENTITY=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || echo "")
if [[ -z "$AWS_IDENTITY" ]]; then
  err "AWS credentials not configured. Set AWS_PROFILE or env vars."
  exit 1
fi
log "  AWS account: ${AWS_IDENTITY}"

# Verify tfvars exists
if [[ ! -f "${TF_DIR}/terraform.tfvars" ]]; then
  err "terraform.tfvars not found at ${TF_DIR}/terraform.tfvars"
  err "Copy terraform.tfvars.example and fill in values."
  exit 1
fi

log "  Preflight OK"

###############################################################################
# Phase 1: Docker Build + Push
###############################################################################

if [[ "$SKIP_BUILD" == "false" ]]; then
  log ""
  log "═══════════════════════════════════════════════════════════════════"
  log "Phase 1: Docker Build + Push (${PLATFORM})"
  log "═══════════════════════════════════════════════════════════════════"

  # Login to GHCR
  log "Authenticating with GHCR..."
  GH_TOKEN=$(gh auth token)
  echo "${GH_TOKEN}" | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin

  # Ensure buildx builder exists
  if ! docker buildx inspect forge-builder &>/dev/null; then
    log "Creating buildx builder..."
    docker buildx create --name forge-builder --use
  else
    docker buildx use forge-builder
  fi

  # Build and push
  log "Building ${GHCR_IMAGE}:${IMAGE_TAG} for ${PLATFORM}..."
  docker buildx build \
    --platform "${PLATFORM}" \
    --tag "${GHCR_IMAGE}:${IMAGE_TAG}" \
    --file "${DEPLOY_DIR}/Dockerfile.registry" \
    --push \
    "${REPO_ROOT}"

  log "Image pushed successfully: ${GHCR_IMAGE}:${IMAGE_TAG}"

  if [[ "$BUILD_ONLY" == "true" ]]; then
    log "Done (--build-only)."
    exit 0
  fi
else
  log "Phase 1: Skipped (--skip-build)"
fi

###############################################################################
# Phase 2: Terraform
###############################################################################

log ""
log "═══════════════════════════════════════════════════════════════════"
log "Phase 2: Terraform"
log "═══════════════════════════════════════════════════════════════════"

cd "${TF_DIR}"

if [[ ! -d .terraform ]]; then
  log "Running terraform init..."
  terraform init
fi

log "Running terraform plan..."
terraform plan -out=tfplan

if [[ "$PLAN_ONLY" == "true" ]]; then
  log "Plan complete (--plan-only). Review above and re-run without flag to apply."
  rm -f tfplan
  exit 0
fi

echo ""
read -p "Apply this plan? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  warn "Aborted by user."
  rm -f tfplan
  exit 1
fi

terraform apply tfplan
rm -f tfplan

# Capture outputs
EC2_IP=$(terraform output -raw registry_elastic_ip 2>/dev/null || echo "")
CF_DOMAIN=$(terraform output -raw cloudfront_domain 2>/dev/null || echo "")

log "Terraform outputs:"
info "  EC2 Elastic IP: ${EC2_IP}"
info "  CloudFront:     ${CF_DOMAIN}"

###############################################################################
# Phase 3: Wait for bootstrap
###############################################################################

if [[ -n "$EC2_IP" ]]; then
  log ""
  log "═══════════════════════════════════════════════════════════════════"
  log "Phase 3: Waiting for EC2 bootstrap (up to 5 min)..."
  log "═══════════════════════════════════════════════════════════════════"

  ATTEMPTS=0
  MAX_ATTEMPTS=30
  until curl -sf "http://${EC2_IP}:8744/health" >/dev/null 2>&1 || [[ $ATTEMPTS -ge $MAX_ATTEMPTS ]]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    printf "  attempt %d/%d — sleeping 10s\r" "$ATTEMPTS" "$MAX_ATTEMPTS"
    sleep 10
  done
  echo ""

  if curl -sf "http://${EC2_IP}:8744/health" >/dev/null 2>&1; then
    log "Registry is healthy on EC2!"
  else
    err "Registry not healthy after 5 min. Debug with:"
    err "  ./ssh.sh"
    err "  sudo docker compose -f /opt/forge-registry/docker-compose.yml logs"
    exit 1
  fi
fi

###############################################################################
# Phase 4: Smoke test
###############################################################################

log ""
log "═══════════════════════════════════════════════════════════════════"
log "Phase 4: Smoke Test"
log "═══════════════════════════════════════════════════════════════════"

"${SCRIPT_DIR}/smoke-test.sh" "${EC2_IP}"

log ""
log "═══════════════════════════════════════════════════════════════════"
log "Deployment complete!"
log "═══════════════════════════════════════════════════════════════════"
info "  EC2:        ssh ec2-user@${EC2_IP}"
info "  Health:     http://${EC2_IP}:8744/health"
info "  CloudFront: https://${CF_DOMAIN}"
log ""
log "Next steps:"
log "  1. Confirm SNS alarm subscription email"
log "  2. Verify CloudFront distribution is deployed (can take 5-15 min)"
log "  3. Record admin API key from first container boot logs:"
log "     ./ssh.sh -- sudo docker logs forge-registry 2>&1 | grep 'Admin API key'"
