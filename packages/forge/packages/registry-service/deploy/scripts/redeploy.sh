#!/bin/bash
###############################################################################
# redeploy.sh — Update the running registry to a new Docker image
#
# This script handles the common case: code changed, rebuild image, pull on EC2.
# It does NOT touch Terraform or infrastructure — use deploy.sh for that.
#
# Steps:
#   1. Build + push new image to GHCR
#   2. SSH to EC2 and pull the new image
#   3. Restart the registry container
#   4. Verify health
#
# Usage:
#   ./redeploy.sh                    # Build, push, pull, restart
#   ./redeploy.sh --pull-only        # Just pull + restart (image already pushed)
#   ./redeploy.sh --tag v1.2.0       # Build with specific tag
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${SCRIPT_DIR}/.."
TF_DIR="${DEPLOY_DIR}/terraform/public-global"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"

# Configuration
GHCR_IMAGE="ghcr.io/arjunkhera/horus/forge-registry"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="linux/arm64"
SSH_KEY="${SSH_KEY:-${HOME}/Desktop/horus-registry-us-east-1.pem}"
SSH_USER="ec2-user"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[redeploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[redeploy]${NC} $*"; }
err()  { echo -e "${RED}[redeploy]${NC} $*" >&2; }

###############################################################################
# Parse arguments
###############################################################################

PULL_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull-only) PULL_ONLY=true; shift ;;
    --tag)       IMAGE_TAG="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--pull-only] [--tag TAG]"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

###############################################################################
# Resolve EC2 IP from terraform
###############################################################################

EC2_IP=$(cd "${TF_DIR}" && terraform output -raw registry_elastic_ip 2>/dev/null || echo "")
if [[ -z "$EC2_IP" ]]; then
  err "Cannot resolve EC2 IP from terraform outputs."
  err "Run from the terraform directory or set EC2_IP env var."
  exit 1
fi

log "Target: ${SSH_USER}@${EC2_IP}"

###############################################################################
# Build + push (unless --pull-only)
###############################################################################

if [[ "$PULL_ONLY" == "false" ]]; then
  log "Building ${GHCR_IMAGE}:${IMAGE_TAG} for ${PLATFORM}..."

  GH_TOKEN=$(gh auth token)
  echo "${GH_TOKEN}" | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin

  docker buildx use forge-builder 2>/dev/null || docker buildx create --name forge-builder --use

  docker buildx build \
    --platform "${PLATFORM}" \
    --tag "${GHCR_IMAGE}:${IMAGE_TAG}" \
    --file "${DEPLOY_DIR}/Dockerfile.registry" \
    --push \
    "${REPO_ROOT}"

  log "Image pushed: ${GHCR_IMAGE}:${IMAGE_TAG}"
fi

###############################################################################
# Pull + restart on EC2
###############################################################################

log "Pulling new image and restarting on EC2..."

ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${SSH_USER}@${EC2_IP}" bash -s <<EOF
set -euo pipefail
cd /opt/forge-registry

echo "Pulling ${GHCR_IMAGE}:${IMAGE_TAG}..."
sudo docker pull "${GHCR_IMAGE}:${IMAGE_TAG}"

echo "Restarting registry..."
sudo docker compose down forge-registry
sudo docker compose up -d forge-registry

echo "Waiting for health..."
ATTEMPTS=0
until curl -sf http://localhost:8744/health >/dev/null 2>&1 || [ \$ATTEMPTS -ge 12 ]; do
  ATTEMPTS=\$((ATTEMPTS + 1))
  sleep 5
done

if curl -sf http://localhost:8744/health >/dev/null 2>&1; then
  echo "Registry healthy!"
else
  echo "WARNING: not healthy after 60s"
  sudo docker logs --tail 20 forge-registry
  exit 1
fi
EOF

log "Redeploy complete! Image: ${GHCR_IMAGE}:${IMAGE_TAG}"
