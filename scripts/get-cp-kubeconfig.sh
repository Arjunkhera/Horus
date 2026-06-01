#!/usr/bin/env bash
# get-cp-kubeconfig.sh — Fetch the Track A k3s kubeconfig and install it locally
#
# SSHes to the persistent Horus control-plane node, reads the root-owned k3s
# admin kubeconfig (/etc/rancher/k3s/k3s.yaml), rewrites the loopback server URL
# (127.0.0.1) to the node's public Elastic IP, renames the cluster/user/context
# to a named context, and writes the result to a standalone kubeconfig file.
#
# Usage:
#   ./scripts/get-cp-kubeconfig.sh
#
# Then:
#   KUBECONFIG=~/.kube/horus-track-a.yaml kubectl get nodes
#   # or merge into ~/.kube/config and: kubectl config use-context horus-track-a
#
# Overridable via env:
#   CP_HOST     public EIP / hostname of the node   (default 13.219.32.204)
#   CP_USER     SSH user                            (default ubuntu)
#   CP_KEY      SSH private key                     (default ~/.ssh/horus-track-a.pem)
#   CP_CONTEXT  named context to write              (default horus-track-a)
#   CP_OUTPUT   output kubeconfig path              (default ~/.kube/horus-track-a.yaml)
#
# Note: the bearer token in the fetched file is cluster-admin — the output is
# written mode 600 and must never be committed.
set -euo pipefail

CP_HOST="${CP_HOST:-13.219.32.204}"
CP_USER="${CP_USER:-ubuntu}"
CP_KEY="${CP_KEY:-$HOME/.ssh/horus-track-a.pem}"
CP_CONTEXT="${CP_CONTEXT:-horus-track-a}"
CP_OUTPUT="${CP_OUTPUT:-$HOME/.kube/horus-track-a.yaml}"

if [[ ! -f "$CP_KEY" ]]; then
  echo "error: SSH key not found at $CP_KEY (set CP_KEY=...)" >&2
  exit 1
fi

echo "Fetching kubeconfig from ${CP_USER}@${CP_HOST} ..." >&2
raw="$(ssh -i "$CP_KEY" -o StrictHostKeyChecking=accept-new \
  "${CP_USER}@${CP_HOST}" 'sudo cat /etc/rancher/k3s/k3s.yaml')"

if [[ -z "$raw" || "$raw" != *"clusters:"* ]]; then
  echo "error: did not receive a valid kubeconfig from the node" >&2
  exit 1
fi

# 1. Point the server at the public EIP instead of the node's loopback.
# 2. k3s names the cluster/user/context all "default"; rename to $CP_CONTEXT so
#    the context is descriptive and won't collide with other "default" contexts.
rewritten="$(printf '%s\n' "$raw" \
  | sed -e "s#https://127\.0\.0\.1:6443#https://${CP_HOST}:6443#" \
        -e "s#: default\$#: ${CP_CONTEXT}#" \
        -e "s#name: default\$#name: ${CP_CONTEXT}#" \
        -e "s#current-context: default\$#current-context: ${CP_CONTEXT}#")"

mkdir -p "$(dirname "$CP_OUTPUT")"
( umask 077; printf '%s\n' "$rewritten" > "$CP_OUTPUT" )
chmod 600 "$CP_OUTPUT"

echo "Wrote kubeconfig to $CP_OUTPUT (context: $CP_CONTEXT)" >&2
echo "Try:  KUBECONFIG=$CP_OUTPUT kubectl get nodes" >&2
