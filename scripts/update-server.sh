#!/usr/bin/env bash
# scripts/update-server.sh — Painless control-plane update via GitOps sha-pin.
#
# The control plane runs on k3s and is driven by ArgoCD (automated sync). Images
# are pinned per ADR-0007 (never :latest), so "update the server" means: bump the
# overlay's image newTag to the latest master `sha-<commit>`, commit, and push —
# the cluster's ArgoCD then auto-syncs the new pin. Rollback is a revert of that
# commit (or a re-pin to a known-good sha).
#
# Prereqs: CI must have already built the target images. `docker-publish.yml`
# builds the changed service image(s) on every push to master and tags them
# `sha-<short>`. So the loop is: merge fix to master -> wait for CI green ->
# run this script.
#
# Usage:
#   scripts/update-server.sh [options]
#   scripts/update-server.sh --rollback [--to <sha>]
#
# Options:
#   --overlay <name>     Kustomize overlay to edit         (default: dev)
#   --services "<list>"  Space-separated service names     (default: "horus-service operator-service")
#   --sha <short-sha>    Pin to this sha instead of latest master
#   --ref <git-ref>      Resolve --sha from this ref        (default: origin/master)
#   --rollback           Revert the most recent deploy commit (or re-pin with --to)
#   --to <short-sha>     With --rollback: re-pin to this sha instead of git-revert
#   --verify             Check each image:sha exists in GHCR before committing (needs docker login)
#   --smoke <host>       After push, curl https://<host>/health + aggregate status
#   --no-push            Commit locally but don't push
#   --dry-run            Show the planned newTag edits and exit (no commit)
#   -h, --help           This help
#
# Examples:
#   scripts/update-server.sh                          # bump dev to latest master sha
#   scripts/update-server.sh --smoke horus.arjunkhera.io
#   scripts/update-server.sh --services "horus-service" --sha a1b2c3d
#   scripts/update-server.sh --rollback               # undo the last bump
#   scripts/update-server.sh --rollback --to d132db0  # re-pin to a known-good sha

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_PREFIX="ghcr.io/arjunkhera/horus"

OVERLAY="dev"
SERVICES="horus-service operator-service"
SHA=""
REF="origin/master"
ROLLBACK=0
TO_SHA=""
VERIFY=0
SMOKE_HOST=""
PUSH=1
DRY_RUN=0

log()  { echo "[update-server] $*"; }
fail() { echo "[update-server] FAIL: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --overlay)  OVERLAY="$2"; shift 2;;
    --services) SERVICES="$2"; shift 2;;
    --sha)      SHA="$2"; shift 2;;
    --ref)      REF="$2"; shift 2;;
    --rollback) ROLLBACK=1; shift;;
    --to)       TO_SHA="$2"; shift 2;;
    --verify)   VERIFY=1; shift;;
    --smoke)    SMOKE_HOST="$2"; shift 2;;
    --no-push)  PUSH=0; shift;;
    --dry-run)  DRY_RUN=1; shift;;
    -h|--help)  sed -n '2,40p' "$0"; exit 0;;
    *) fail "unknown option: $1 (try --help)";;
  esac
done

KUSTOMIZATION="$REPO_ROOT/deploy/overlays/$OVERLAY/kustomization.yaml"
[[ -f "$KUSTOMIZATION" ]] || fail "overlay not found: $KUSTOMIZATION"

# Rewrite the newTag for one image in the overlay, preserving comments + layout.
# awk: when a line is exactly "- name: <image>" (any indent), arm; on the next
# "newTag:" line, replace its value keeping the original indentation.
set_tag() {
  local image="$1" tag="$2" file="$3" tmp
  tmp="$(mktemp)"
  awk -v image="$image" -v tag="$tag" '
    {
      line = $0
      trimmed = line; sub(/^[[:space:]]+/, "", trimmed)
      if (trimmed == "- name: " image) { armed = 1; print; next }
      if (armed && match(line, /^[[:space:]]*newTag:/)) {
        indent = line; sub(/newTag:.*/, "", indent)
        print indent "newTag: " tag
        armed = 0; next
      }
      print
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

current_tag() {
  local image="$1" file="$2"
  awk -v image="$image" '
    { trimmed=$0; sub(/^[[:space:]]+/,"",trimmed)
      if (trimmed=="- name: " image) { armed=1; next }
      if (armed && match($0,/newTag:/)) { v=$0; sub(/.*newTag:[[:space:]]*/,"",v); print v; exit } }
  ' "$file"
}

verify_image() {
  local ref="$1"
  if docker manifest inspect "$ref" >/dev/null 2>&1; then
    log "  verified $ref exists in GHCR"
  else
    fail "image not found in GHCR: $ref (has CI finished building it? run without --verify to skip)"
  fi
}

# ── Rollback path ─────────────────────────────────────────────────────────────
if [[ "$ROLLBACK" == 1 ]]; then
  cd "$REPO_ROOT"
  if [[ -n "$TO_SHA" ]]; then
    log "Re-pinning [$SERVICES] on overlay '$OVERLAY' to sha-$TO_SHA"
    WORK="$(mktemp)"; cp "$KUSTOMIZATION" "$WORK"; trap 'rm -f "$WORK"' EXIT
    for svc in $SERVICES; do
      set_tag "$IMAGE_PREFIX/$svc" "sha-$TO_SHA" "$WORK"
    done
    diff -u "$KUSTOMIZATION" "$WORK" || true
    [[ "$DRY_RUN" == 1 ]] && { log "dry-run: not committing"; exit 0; }
    cp "$WORK" "$KUSTOMIZATION"
    git add "$KUSTOMIZATION"
    git commit -q -m "revert(deploy): re-pin $OVERLAY [$SERVICES] to sha-$TO_SHA

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  else
    log "Reverting the most recent commit (assumed to be the last deploy bump)"
    log "  HEAD: $(git --no-pager log --oneline -1)"
    [[ "$DRY_RUN" == 1 ]] && { log "dry-run: would 'git revert --no-edit HEAD'"; exit 0; }
    git revert --no-edit HEAD
  fi
  [[ "$PUSH" == 1 ]] && { log "Pushing..."; git push; } || log "--no-push: skipping push"
  log "ArgoCD will sync the revert. Watch: kubectl -n argocd get app horus-control-plane-$OVERLAY"
  exit 0
fi

# ── Update path ───────────────────────────────────────────────────────────────
cd "$REPO_ROOT"

if [[ -z "$SHA" ]]; then
  log "Resolving latest sha from $REF ..."
  git fetch origin --quiet
  SHA="$(git rev-parse --short=7 "$REF")" || fail "could not resolve $REF"
fi
log "Target image tag: sha-$SHA"

if [[ "$VERIFY" == 1 ]]; then
  for svc in $SERVICES; do verify_image "$IMAGE_PREFIX/$svc:sha-$SHA"; done
fi

WORK="$(mktemp)"; cp "$KUSTOMIZATION" "$WORK"; trap 'rm -f "$WORK"' EXIT
CHANGED=0
for svc in $SERVICES; do
  cur="$(current_tag "$IMAGE_PREFIX/$svc" "$KUSTOMIZATION")"
  if [[ "$cur" == "sha-$SHA" ]]; then
    log "  $svc already at sha-$SHA — skipping"
    continue
  fi
  log "  $svc: $cur -> sha-$SHA"
  set_tag "$IMAGE_PREFIX/$svc" "sha-$SHA" "$WORK"
  CHANGED=1
done

[[ "$CHANGED" == 0 ]] && { log "Nothing to update — all targeted services already pinned."; exit 0; }

echo
diff -u "$KUSTOMIZATION" "$WORK" || true
echo

if [[ "$DRY_RUN" == 1 ]]; then
  log "dry-run: not committing. Re-run without --dry-run to apply."
  exit 0
fi

cp "$WORK" "$KUSTOMIZATION"
git add "$KUSTOMIZATION"
git commit -q -m "chore(deploy): bump $OVERLAY [$SERVICES] to sha-$SHA

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
log "Committed: $(git --no-pager log --oneline -1)"

if [[ "$PUSH" == 1 ]]; then
  log "Pushing..."
  git push
else
  log "--no-push: commit made locally; push when ready."
fi

echo
log "ArgoCD (automated sync) will roll the new pin out. Verify:"
log "  kubectl -n argocd get app horus-control-plane-$OVERLAY"
log "  kubectl -n horus-system get pods -w"

if [[ -n "$SMOKE_HOST" ]]; then
  echo
  log "Smoke test against https://$SMOKE_HOST (allow a moment for ArgoCD to sync + pods to roll)..."
  curl -fsS "https://$SMOKE_HOST/health" && echo "  /health OK" || log "  /health not yet healthy — re-check after sync"
  curl -fsS "https://$SMOKE_HOST/api/v1/aggregate/status" || log "  aggregate status not yet ready"
fi
