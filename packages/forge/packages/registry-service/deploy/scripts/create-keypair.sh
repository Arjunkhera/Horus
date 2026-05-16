#!/bin/bash
###############################################################################
# create-keypair.sh — Create an EC2 key pair for the Forge Registry
#
# Creates the key pair in AWS and saves the .pem file locally.
#
# Usage:
#   ./create-keypair.sh                          # Default name + region
#   ./create-keypair.sh --name my-key --region us-west-2
###############################################################################

set -euo pipefail

KEY_NAME="horus-registry-us-east-1"
REGION="us-east-1"
OUTPUT_DIR="${HOME}/Desktop"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)   KEY_NAME="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--name KEY_NAME] [--region REGION] [--output DIR]"
      exit 0
      ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

PEM_FILE="${OUTPUT_DIR}/${KEY_NAME}.pem"

if aws ec2 describe-key-pairs --key-names "${KEY_NAME}" --region "${REGION}" &>/dev/null; then
  echo "Key pair '${KEY_NAME}' already exists in ${REGION}."
  echo "Delete it first: aws ec2 delete-key-pair --key-name ${KEY_NAME} --region ${REGION}"
  exit 1
fi

echo "Creating key pair '${KEY_NAME}' in ${REGION}..."
aws ec2 create-key-pair \
  --key-name "${KEY_NAME}" \
  --region "${REGION}" \
  --key-type ed25519 \
  --query 'KeyMaterial' \
  --output text > "${PEM_FILE}"

chmod 600 "${PEM_FILE}"

echo "Key pair created!"
echo "  Name: ${KEY_NAME}"
echo "  File: ${PEM_FILE}"
echo ""
echo "Add to terraform.tfvars:"
echo "  key_pair_name = \"${KEY_NAME}\""
