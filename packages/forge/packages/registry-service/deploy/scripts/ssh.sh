#!/bin/bash
###############################################################################
# ssh.sh — SSH into the Forge Registry EC2 instance
#
# Resolves the EC2 IP from terraform outputs and connects.
#
# Usage:
#   ./ssh.sh                          # Interactive SSH session
#   ./ssh.sh -- sudo docker logs forge-registry   # Run a command
#   ./ssh.sh --ip 1.2.3.4            # Override IP (skip terraform lookup)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/../terraform/public-global"

SSH_KEY="${SSH_KEY:-${HOME}/Desktop/horus-registry-us-east-1.pem}"
SSH_USER="ec2-user"
EC2_IP=""
CMD_ARGS=()

###############################################################################
# Parse arguments
###############################################################################

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip)  EC2_IP="$2"; shift 2 ;;
    --key) SSH_KEY="$2"; shift 2 ;;
    --)    shift; CMD_ARGS=("$@"); break ;;
    -h|--help)
      echo "Usage: $0 [--ip IP] [--key PATH] [-- COMMAND...]"
      echo ""
      echo "Options:"
      echo "  --ip IP     Override EC2 IP (skip terraform lookup)"
      echo "  --key PATH  SSH key path (default: ~/Desktop/horus-registry-us-east-1.pem)"
      echo "  -- CMD      Run CMD on the remote instead of interactive shell"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

###############################################################################
# Resolve IP
###############################################################################

if [[ -z "$EC2_IP" ]]; then
  EC2_IP=$(cd "${TF_DIR}" && terraform output -raw registry_elastic_ip 2>/dev/null || echo "")
  if [[ -z "$EC2_IP" ]]; then
    echo "ERROR: Cannot resolve EC2 IP. Use --ip or run terraform apply first." >&2
    exit 1
  fi
fi

###############################################################################
# Connect
###############################################################################

if [[ ! -f "$SSH_KEY" ]]; then
  echo "ERROR: SSH key not found at ${SSH_KEY}" >&2
  echo "Set SSH_KEY env var or use --key flag." >&2
  exit 1
fi

chmod 600 "$SSH_KEY" 2>/dev/null || true

if [[ ${#CMD_ARGS[@]} -gt 0 ]]; then
  exec ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${EC2_IP}" "${CMD_ARGS[@]}"
else
  exec ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${EC2_IP}"
fi
