---
title: Deploy the Horus Control Plane (k3s)
description: Stand up the remote Horus control plane on single-node k3s via ArgoCD, wire principal auth and secrets, and onboard users.
slug: runbook-control-plane-k3s
tags: [runbook, operator, control-plane, k3s, argocd, deploy]
schema_version: 1
keywords: [control plane, k3s, argocd, kustomize, sealed secrets, cert-manager, ingress, traefik, operator, vault router, reader, writer, forge registry, deploy, onboard, mint, bundle, EKS]
related_commands: [horus operator init, horus operator status, horus operator user add, horus setup, horus login]
sidebar_position: 11
---

# Runbook — Deploy the Horus Control Plane (k3s)

**Purpose:** Stand up the remote Horus control plane — the gateway, identity/operator
service, the Vault Reader/Writer split + router, and the Forge registry — on a
single-node **k3s** cluster via **ArgoCD + Kustomize**, then onboard users who connect
through it.

**Audience:** an operator with Docker + GHCR push rights, AWS access, and
`kubectl`/ArgoCD access to the cluster. **This runbook is not runnable from an agent
sandbox** (no Docker daemon, GHCR push blocked, no cluster).

**Source:** `deploy/ALPHA-INTEGRATION.md` (end-to-end bring-up) and
`deploy/secrets/README.md` (Sealed Secrets). Manifests live under `deploy/`.

> **Why k3s, not EKS?** EKS/Fargate/ECS were evaluated and rejected — the EKS control
> plane alone (~$73/mo) exceeds the entire current single-node substrate (~$51/mo).
> The deployment below is what's actually in use. An EKS migration would change
> §Substrate and §Bootstrap only; the manifests in `deploy/base` are
> ingress-controller-agnostic apart from the Traefik `ingressClassName`.

---

## Architecture

| Component | Kind | Role |
|-----------|------|------|
| `horus-service` | Deployment ×2 | **Only public surface** (HTTPS Ingress, host `horus.arjunkhera.io`). Verifies inbound client JWTs, mints a 60s `X-Horus-Principal` JWT, proxies to Vault/Forge. |
| `operator-service` | StatefulSet | Identity + provisioning. ClusterIP only (no ingress; NetworkPolicy denies external). Generates the two keypairs on first boot. |
| `vault-router` | Deployment | Multi-vault proxy: routes reads → reader pool, writes → writer, per the vault-registry ConfigMap. |
| `vault-reader` | Deployment ×N | Stateless reads from Typesense + Neo4j; clones knowledge repo to emptyDir on start. |
| `vault-writer` | StatefulSet ×1 | Sole writer of the knowledge repo (PVC-backed git checkout). |
| `forge-registry` | Deployment | Artifact registry, S3-backed (`horus-forge-registry`). Verifies `X-Horus-Principal` before writes. |
| Typesense, Neo4j | StatefulSet | Shared datastores. |
| cert-manager, sealed-secrets, observability, backup | ArgoCD apps | TLS, secret unsealing, Prometheus/Grafana, SQLite→S3 backup CronJob. |

The two principal keypairs: a **client-facing** keypair (verifies user tokens) and an
**internal signing** keypair (mints `X-Horus-Principal`). Vault and forge-registry
both mount the **same** internal public JWK (`horus-principal-pub`) to verify the
principal — it is the single shared verification key.

---

## Substrate (already provisioned — reference)

A single always-on EC2 node runs k3s + ArgoCD.

| Attribute | Value |
|-----------|-------|
| Instance | `i-0698c4706c202cd3c` — t4g.large (ARM/Graviton, 2 vCPU, 8 GB) |
| AMI | Ubuntu 22.04 LTS **arm64** |
| Root volume | 40 GB gp3 |
| Elastic IP | `13.219.32.204` (`eipalloc-0f0883acbb80306b4`) |
| Region / account | us-east-1 / `065585372120` |
| Security group | `horus-track-a-sg` — `22` from admin IP, `80`/`443` public (6443 **not** open) |
| SSH key | `~/.ssh/horus-track-a.pem`, user `ubuntu` |

> **ARM substrate:** because the node is Graviton/arm64, every published image must be
> multi-arch (amd64+arm64). A non-multi-arch image pulls fine but crash-loops on exec.

If you ever rebuild the node from scratch:

```bash
# On the node (Ubuntu) — k3s bundles Traefik ingress + local-path StorageClass.
curl -sfL https://get.k3s.io | sh -
sudo k3s kubectl create namespace argocd
sudo k3s kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

### Get kubectl access from your machine

```bash
scripts/get-cp-kubeconfig.sh          # writes ~/.kube/horus-track-a.yaml, context "horus-track-a"
kubectl config use-context horus-track-a
kubectl get nodes                      # gate: node Ready
```

The kubeconfig bearer token is **cluster-admin** — treat the file as a secret
(`chmod 600`, never commit). The DNS A-record `horus.arjunkhera.io → 13.219.32.204`
must be **DNS-only** (grey cloud in Cloudflare, not proxied) or HTTP-01 TLS issuance
and client-IP visibility break.

---

## 1. Publish images (pinned `0.1.0-alpha.1`)

Tags must match `deploy/base/kustomization.yaml` + `deploy/forge-registry/kustomization.yaml`.

**Preferred (CI):** tag `master` HEAD and let `docker-publish.yml` build all six
multi-arch images:

```bash
git tag v0.1.0-alpha.1 && git push origin v0.1.0-alpha.1
```

Six images: `horus-service`, `operator-service`, `vault` (one image, run as reader
**and** writer via `VAULT_MODE`), `vault-router`, `forge-registry`, `backup`. The
manual `docker buildx --platform linux/amd64,linux/arm64 --push` fallback is in
`deploy/ALPHA-INTEGRATION.md §2`.

**Gate 1:** all six tags visible under `ghcr.io/arjunkhera/horus/*:0.1.0-alpha.1`.

---

## 2. Seal secrets (GitOps — never imperative)

Secrets are committed **encrypted** as `*.sealed.yaml` under `deploy/secrets/`; the
`sealed-secrets` controller unseals them into real `Secret`s before workloads start.
**Full procedure: `deploy/secrets/README.md`.** The six:

| SealedSecret | Holds |
|--------------|-------|
| `vault-secrets` | `NEO4J_AUTH`, `NEO4J_PASSWORD`, `TYPESENSE_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO=Arjunkhera/horus-knowledge` |
| `forge-registry-secrets` | S3 access key id/secret for `horus-forge-registry` |
| `backup-credentials` | AWS creds + `BACKUP_BUCKET` |
| `grafana-admin` | Grafana admin password |
| `horus-service-secrets` | client JWKS + internal signing **private** key — derived in §4 |
| `horus-principal-pub` | internal signing **public** JWK — derived in §4 |

`deploy/secrets.example.yaml` documents the plaintext key shapes (never fill it in and
commit it).

> **Single-point-of-loss:** back up the sealed-secrets controller key offline. Losing
> it forces re-sealing all six secrets against a new cluster key.

**Gate 2:** `deploy/secrets/kustomization.yaml` references the four non-principal
sealed secrets; principal secrets added in §4.

---

## 3. Bootstrap ArgoCD (app-of-apps)

```bash
kubectl apply -f deploy/argocd/app-of-apps.yaml
```

`horus-root` recursively syncs every child Application under `deploy/argocd/apps`, in
sync-wave order:

| Wave | Apps |
|------|------|
| -2 | `cert-manager`, `sealed-secrets` (controllers + CRDs) |
| -1 | `cluster-issuers` (LE staging/prod), `horus-secrets` (the six SealedSecrets) |
| 0  | `horus-control-plane` (`deploy/overlays/alpha`), `horus-forge-registry`, `horus-observability`, `horus-backup` |

```bash
kubectl -n argocd get applications      # watch them go green
kubectl -n horus-system get pods
```

**Gate 3:** `horus-service` (×2), `operator-service`, `vault-reader` (×2),
`vault-writer`, `vault-router`, `forge-registry`, `typesense`, `neo4j` all `Running`,
plus observability + backup CronJob.

---

## 4. Wire principal auth (operator first-boot keys)

`operator-service` generates the two keypairs on first boot and persists them to its
PVC. Derive the principal Secrets from them.

**Automated (preferred) — GitOps:**

```bash
horus operator init --namespace horus-system --dry-run \
  | kubeseal --controller-namespace sealed-secrets --format yaml \
  > deploy/secrets/principal-secrets.sealed.yaml
# then uncomment principal-secrets in deploy/secrets/kustomization.yaml, commit, let ArgoCD apply
```

`horus operator init` port-forwards operator-service, calls the admin-only
`GET /admin/principal-bundle`, and produces `horus-service-secrets` +
`horus-principal-pub`. The internal signing **private** key is exported only over the
cluster-internal port-forward — it never crosses the public boundary. (Direct-apply
`horus operator init --namespace horus-system` exists for non-GitOps bring-up; manual
steps in `deploy/ALPHA-INTEGRATION.md §4`.)

**Gate 4:** `kubectl -n horus-system get secret horus-service-secrets
horus-principal-pub` both exist; horus-service + Vault pods restart healthy.

---

## 5. Smoke-test the contract surface

```bash
HOST=horus.arjunkhera.io
curl -s https://$HOST/health
curl -s https://$HOST/api/v1/aggregate/status     # federates Vault + Forge /health
curl -s https://$HOST/api/v1/forge/health         # principal-authenticated path
kubectl -n horus-system get certificate horus-service-tls   # Ready=True once HTTP-01 completes
```

**Verification gate 5:**
- `/health` and `/api/v1/aggregate/status` return healthy.
- `horus-service-tls` certificate `Ready=True` (flip issuer
  `letsencrypt-staging`→`letsencrypt-prod` only after staging succeeds).
- A registry **read** with no principal succeeds (reads are public); a **publish**
  without a `publisher`/`registry-admin` principal returns `403`.

---

## 6. Onboard a user

Mint a user bundle from `operator-service`. It's a ClusterIP, so reach it via an SSH
tunnel to the node (port 6443 is closed; the tunnel is the only path).

```bash
# Tunnel: forward local :8090 → node → operator-service. Pick a fresh high node-side
# port if you hit "address already in use".
ssh -i ~/.ssh/horus-track-a.pem -o ExitOnForwardFailure=yes \
  -L 8090:127.0.0.1:38090 ubuntu@13.219.32.204 \
  'sudo k3s kubectl -n horus-system port-forward svc/operator-service 38090:8090' &
curl -fsS http://127.0.0.1:8090/health           # gate: operator healthy

# Mint. CRITICAL: --tenant default (the CP vault is single-tenant 'default';
# --tenant alpha causes 403 TENANT_MISMATCH on every vault read).
horus operator user add <user-id> \
  --tenant default \
  --role registry-admin \
  --vault default=https://horus.arjunkhera.io/api/v1/vault \
  --vault vault-code=https://horus.arjunkhera.io/api/v1/vault \
  --cp-url https://horus.arjunkhera.io \
  --operator-url http://127.0.0.1:8090 \
  --out "<user-id>.bundle.yaml"
```

> **Role:** `--role registry-admin` is needed to register repos / publish artifacts.
> Read-only client usage can drop to `--role user` (Forge writes then return 403).

Hand the bundle to the user; they run the [client-setup runbook](./client-setup.md)
Path B. The bundle's static JWT is a **secret** — deliver it out-of-band, never commit
it.

**Verification gate 6 (run from the user's side, or with their token):**

```bash
TOKEN=$(grep -E 'config:' "<user-id>.bundle.yaml" | sed -E 's/.*config:[[:space:]]*//' | tr -d '"')
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  https://horus.arjunkhera.io/api/v1/vault/     # expect 200
```

`200` → user can reach the remote Vault through the gateway, Reader/Writer split
honored. `403 TENANT_MISMATCH` → re-mint with `--tenant default`.

---

## Known caveats

- **Cloudflare must be DNS-only** for `horus.arjunkhera.io` — a proxied record breaks
  HTTP-01 issuance and hides the client IP from Traefik.
- **operator-service TLS trust:** its Node `fetch` must trust the cluster CA — set
  `NODE_EXTRA_CA_CERTS=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`.
- **ArgoCD selfHeal vs operator writes:** the vault-registry ConfigMap is both
  git-declared and operator-patched. Use `ignoreDifferences` +
  `RespectIgnoreDifferences=true` on its `/data` so ArgoCD doesn't revert operator
  writes.
- **Observability is up/down only:** only `horus-service` exposes `/metrics`; others
  are blackbox-probed on `/health` (`ServiceProbeDown` alert).
- **Image tags pinned to `0.1.0-alpha.1`** across `deploy/base`,
  `deploy/forge-registry`, and the inline `backup` image — keep them in lockstep on
  any re-pin.
- **`default` vault `get-page` by UUID** may return 502→404 (it holds one empty
  placeholder); `vault-code` content reads fine.

---

## Rollback

Images are version-pinned in the kustomizations, so rollback is a manifest revert:

1. Revert the image tag(s) in `deploy/base/kustomization.yaml` /
   `deploy/forge-registry/kustomization.yaml` to the prior good tag and commit.
2. ArgoCD (automated sync, prune + selfHeal) re-syncs to the reverted tag — or force
   it: `kubectl -n argocd patch app horus-control-plane --type merge -p
   '{"operation":{"sync":{}}}'`.
3. Re-run §5 smoke tests.

For a single bad workload, `kubectl -n horus-system rollout undo deploy/<name>` is a
faster stopgap, but ArgoCD selfHeal will reconcile back to git — fix the manifest.
