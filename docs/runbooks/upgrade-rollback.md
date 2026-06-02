---
title: Upgrade & Rollback Horus
description: Painless update + rollback for the k3s control plane (GitOps sha-pin) and the local client (horus update), with scripts.
slug: runbook-upgrade-rollback
tags: [runbook, operator, upgrade, rollback, deploy, k3s, argocd, client]
schema_version: 1
keywords: [upgrade, update, rollback, redeploy, deploy, ship, fix, sha, pin, kustomize, overlay, argocd, gitops, horus update, snapshot, rollout, image, ghcr]
related_commands: [horus update, horus status, horus down, horus up]
sidebar_position: 12
---

# Runbook — Upgrade & Rollback Horus

**Purpose:** Ship a code fix to the running control plane and roll it back if it
misbehaves, plus keep local clients current — with one command each way.

There are two independent halves, each with its own mechanism:

| Half | Update | Rollback | Mechanism |
|------|--------|----------|-----------|
| **Control plane** (k3s) | `scripts/update-server.sh` | `scripts/update-server.sh --rollback` | GitOps **sha-pin** bump → ArgoCD auto-sync |
| **Local client** (Docker) | `horus update` (or `scripts/update-client.sh`) | `horus update --rollback` | Image snapshot → pull → force-recreate |

> **Why sha-pin and not `:latest`?** ADR-0007 (`adr/0007-kubernetes-argocd-deployment.md`)
> mandates pinned image tags. With ArgoCD, a moving `:latest` tag is invisible —
> the manifest digest never changes, so ArgoCD never re-syncs, and "what's running"
> is no longer described by git (you lose reproducible rollback). Pinning each
> service to a `sha-<commit>` keeps git as the source of truth: the update is a
> commit, the rollback is its revert.

---

## How a code fix reaches the server

```
edit code ──▶ merge to master ──▶ CI (docker-publish.yml) builds the CHANGED
   service image(s) and tags them sha-<commit> + master + latest in GHCR
                                       │
                                       ▼
        scripts/update-server.sh  ──▶  rewrites the overlay's newTag to
        (commit + push)                sha-<commit>, commits, pushes
                                       │
                                       ▼
                ArgoCD (automated sync) rolls the new pin onto the cluster
```

CI rebuilds **only the services whose paths changed** (per-package filters in
`.github/workflows/docker-publish.yml`). The whole pipeline is already automatic up
to the GHCR image; the script handles the git→cluster half.

---

## A. Control plane — update

**Preconditions:** the fix is merged to `master` and CI has finished building the
image(s) (check the Actions tab / `gh run list`). You have push access to the repo.

```bash
# Bump the dev overlay's horus-service + operator-service to the latest master sha,
# commit, push. ArgoCD on the dev cluster auto-syncs.
scripts/update-server.sh

# Same, and smoke-test the gateway once it has rolled (use your dev cluster's host):
scripts/update-server.sh --smoke horus-dev.example.com

# Only one service, an explicit sha, a different overlay:
scripts/update-server.sh --services "horus-service" --sha a1b2c3d --overlay dev

# Preview the edit without committing:
scripts/update-server.sh --dry-run

# Confirm the image actually exists in GHCR before committing (needs `docker login ghcr.io`):
scripts/update-server.sh --verify
```

Default overlay is **`dev`** and default services are **`horus-service
operator-service`** (the two you iterate on). The script edits
`deploy/overlays/<overlay>/kustomization.yaml` with `awk`, preserving its comment
trail.

**Verify the rollout:**

```bash
kubectl -n argocd get app horus-control-plane-dev      # SYNCED / Healthy
kubectl -n horus-system get pods -w                    # new pods Running
curl -s https://<dev-host>/health                      # ok
curl -s https://<dev-host>/api/v1/aggregate/status     # Vault + Forge healthy
```

**Verification gate:** ArgoCD app `SYNCED`+`Healthy`, new pods `Running`, `/health`
and aggregate status green.

---

## B. Control plane — rollback

Rollback is a git operation; ArgoCD reconciles the cluster back to it.

```bash
# Undo the most recent deploy bump (reverts HEAD, pushes; ArgoCD syncs back):
scripts/update-server.sh --rollback

# Or re-pin to a specific known-good sha (auditable, explicit):
scripts/update-server.sh --rollback --to d132db0
```

**Manual fallbacks** (when you can't run the script):

```bash
# Revert the bump commit by hand:
git revert --no-edit <bump-commit-sha> && git push

# Emergency in-cluster stopgap — fast, but ArgoCD selfHeal will reconcile back to
# git, so you MUST also fix the pin in git or it bounces back:
kubectl -n horus-system rollout undo deployment/horus-service
kubectl -n horus-system rollout undo statefulset/operator-service
```

> Because the cluster is GitOps-managed with `selfHeal: true`, the **git pin is the
> source of truth**. A `kubectl rollout undo` is only a stopgap — always land the
> rollback in git too, or selfHeal will roll you forward again within seconds.

---

## C. Local client — update & rollback

The client update path is built into the CLI and is fully automatic: it snapshots
the running image tags, pulls the latest, force-recreates the containers, and waits
for health.

```bash
horus update                       # pull latest images + restart + health-wait
horus update --rollback            # restore the previous snapshot (cached images)

# Convenience wrapper — also self-updates the CLI first:
scripts/update-client.sh --with-cli
scripts/update-client.sh --rollback
```

Snapshots are written to `~/Horus/snapshots/` before each update, so rollback works
even offline (it reuses cached images). To update the CLI binary itself:

```bash
npm install -g @arkhera30/cli@latest
```

**Verification gate:** `horus status` shows all four containers healthy and the
expected mode; for connected clients, `control_plane` connected in
`curl -s localhost:8400/api/system/status`.

---

## Setting up the dev cluster (first time)

The update script targets the **`dev`** overlay and assumes a second k3s cluster
exists with its own ArgoCD. Stand it up once:

1. Provision the substrate + install k3s/ArgoCD/cert-manager/sealed-secrets and the
   secrets exactly as in [control-plane-k3s.md](./control-plane-k3s.md) §Substrate–§4.
   The platform apps (`cert-manager`, `sealed-secrets`, `cluster-issuers`,
   `horus-secrets`) are env-agnostic — install them from `deploy/argocd/apps/` as-is.
2. Apply the **dev** control-plane Application (it points ArgoCD at
   `deploy/overlays/dev` instead of alpha):
   ```bash
   kubectl apply -f deploy/argocd/dev/horus-control-plane.yaml
   ```
   This file lives outside `deploy/argocd/apps/` on purpose, so the alpha cluster's
   app-of-apps never picks it up.
3. Point a DNS record at the dev cluster's EIP and set the Ingress host accordingly
   (the dev overlay inherits the base Ingress host — re-pin it in the overlay if you
   want a separate hostname like `horus-dev.example.com`).

From then on, the day-to-day loop is just §A / §B.

---

## Caveats

- **Wait for CI before updating.** If you bump to a `sha-<commit>` whose image CI
  hasn't finished pushing, pods `ImagePullBackOff`. Use `--verify` (needs `docker
  login ghcr.io`) to fail fast, or check `gh run list` first.
- **One git repo, two clusters.** alpha and dev share this repo but use separate
  overlays. A `scripts/update-server.sh --overlay alpha` would ship to the alpha
  cluster — the default is `dev` to keep production untouched.
- **selfHeal reconciles to git.** Any out-of-band `kubectl` change is temporary.
- **Multi-arch.** The cluster nodes are arm64 (Graviton); all images are multi-arch,
  so `sha-<commit>` tags run on both. A non-multi-arch image would crash-loop.
- **CLI vs services.** `horus update` updates the *containers*, not the CLI binary.
  Use `scripts/update-client.sh --with-cli` or `npm i -g @arkhera30/cli@latest` for
  the CLI itself.
