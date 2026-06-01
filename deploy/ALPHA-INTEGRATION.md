# Horus Alpha — End-to-End Live Integration Runbook

The literal Definition of Done for the alpha (Seq 2 deferred this because it needs
a real cluster + published images). Standing the full stack up on a real k3s
cluster via ArgoCD, then proving a second user can connect **through**
horus-service to a remote Vault (principal-authenticated, Reader/Writer split)
and Forge.

This runbook is executed by an operator with Docker, GHCR push rights, AWS, and
`kubectl`/ArgoCD access to a k3s cluster. It is **not** runnable from the agent
sandbox (no Docker daemon, GHCR push blocked, no cluster).

> **Status:** the alpha chain (#353–#356) is merged to `master`, so all six
> Dockerfiles + CI jobs are live. Images are CI-built by `docker-publish.yml` on
> a `v*` tag — cut `v0.1.0-alpha.1` (step 2) rather than building by hand. This
> runbook now targets a **persistent** k3s control plane (Track A): real domain
> + TLS (cert-manager), Sealed Secrets, and the full app-of-apps. The substrate
> (EC2/EIP/EBS/k3s install) and local kubeconfig access are documented in section
> **A1**.

---

## 0. Prerequisites

- A running **k3s** (or k8s) cluster with **ArgoCD** installed, and `kubectl`
  context pointing at it.
- **Traefik** ingress (k3s default) — horus-service publishes an HTTPS Ingress on
  host `horus.arjunkhera.io`, TLS issued by cert-manager / Let's Encrypt.
- **cert-manager** + **sealed-secrets** controllers (installed as ArgoCD Helm
  apps, sync-wave -2). A Cloudflare A-record `horus.arjunkhera.io → <Elastic IP>`
  set to **DNS only** (grey cloud, not proxied) so HTTP-01 and Traefik see the
  real client/EIP.
- Docker with **buildx** + QEMU (multi-arch amd64/arm64), logged in to GHCR with
  `write:packages` (`gh auth login -s write:packages` or a PAT).
- AWS account + an IAM user with S3 access for two buckets:
  - `horus-forge-registry` — Forge artifacts (versioning enabled by the
    `enable-forge-bucket-versioning` Job).
  - the operator backup bucket (`BACKUP_BUCKET`).
- The Horus CLI built (`pnpm --filter @arkhera30/cli build`) for `horus operator …`.

---

## A1. Cluster substrate & local kubeconfig access

The persistent control plane the rest of this runbook targets. Section 0 assumes a
cluster + `kubectl` context already exist — this section is how that substrate was
provisioned and how an operator gets `kubectl`/port-forward access to it.

### A1.1 How the node was provisioned

A single always-on EC2 node in **`us-east-1`** (account `065585372120`) runs k3s +
ArgoCD. It replaced the earlier throwaway validation cluster.

| Attribute | Value |
|-----------|-------|
| Instance | `i-0698c4706c202cd3c` — **t4g.large** (ARM/Graviton, 2 vCPU, 8 GB) |
| AMI | Ubuntu 22.04 LTS **arm64** |
| Root volume | 40 GB gp3 (EBS) |
| Elastic IP | **13.219.32.204** (`eipalloc-0f0883acbb80306b4`) |
| Security group | `horus-track-a-sg` — `22` from admin IP, `80`/`443` public |
| SSH keypair | `~/.ssh/horus-track-a.pem` |

> **ARM substrate:** because the node is Graviton/arm64, every published image must
> be multi-arch (amd64+arm64) — they are. A non-multi-arch image will `ImagePull`
> fine but crash-loop on exec.

Provision with the **`default` (root)** AWS profile (the `arkhera` profile is
S3-only and lacks `ec2:*`), then install k3s and bootstrap ArgoCD on the node:

```bash
# On the node (Ubuntu), install k3s — bundles Traefik ingress + local-path StorageClass.
curl -sfL https://get.k3s.io | sh -

# Bootstrap ArgoCD (the app-of-apps `horus-root` drives everything else — section 5).
sudo k3s kubectl create namespace argocd
sudo k3s kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

On the node, `kubectl` is reached via `sudo k3s kubectl` (k3s ships its own
bundled binary). The steps below give you `kubectl` from your **local** machine.

### A1.2 SSH access

```bash
ssh -i ~/.ssh/horus-track-a.pem ubuntu@13.219.32.204
```

> The `horus-track-a.pem` keypair is **distinct from the Forge registry's SSH
> key** — they are different hosts with different keypairs. Don't cross them.

### A1.3 Fetch the kubeconfig & configure a local context

k3s writes its admin kubeconfig to `/etc/rancher/k3s/k3s.yaml` (root-owned, mode
`600`) with the server set to `https://127.0.0.1:6443` — the loopback only works
on the node, so the server URL must be rewritten to the public EIP. Use the
helper script (preferred — see `scripts/get-cp-kubeconfig.sh`):

```bash
scripts/get-cp-kubeconfig.sh
# writes ~/.kube/horus-track-a.yaml with a named context "horus-track-a"
```

Or do it by hand:

```bash
# 1. Pull the admin kubeconfig (sudo: it's root-only on the node).
ssh -i ~/.ssh/horus-track-a.pem ubuntu@13.219.32.204 \
  'sudo cat /etc/rancher/k3s/k3s.yaml' > ~/.kube/horus-track-a.yaml

# 2. Rewrite the loopback server URL to the public EIP.
sed -i '' 's#https://127.0.0.1:6443#https://13.219.32.204:6443#' \
  ~/.kube/horus-track-a.yaml   # GNU sed: drop the '' after -i

# 3. Use it as a standalone kubeconfig…
KUBECONFIG=~/.kube/horus-track-a.yaml kubectl get nodes

# …or merge it into your default kubeconfig as a named context.
KUBECONFIG=~/.kube/config:~/.kube/horus-track-a.yaml \
  kubectl config view --flatten > ~/.kube/config.merged && \
  mv ~/.kube/config.merged ~/.kube/config
kubectl config use-context horus-track-a
```

> k3s names the cluster/user/context `default` in `k3s.yaml`; the script renames
> all three to `horus-track-a` so it won't collide with other `default` contexts.
> The bearer token in this file is **cluster-admin** — treat the file as a secret
> (`chmod 600`, never commit it).

### A1.4 Port-forward without a full kubeconfig (SSH tunnel)

For one-off access to an in-cluster service (e.g. operator-service's admin port
in step 4) without configuring `kubectl` locally, run the port-forward **on the
node** and tunnel the local port over SSH:

```bash
# Terminal 1 — on the node, expose the service on the node's localhost:8090.
ssh -i ~/.ssh/horus-track-a.pem ubuntu@13.219.32.204 \
  'sudo k3s kubectl -n horus-system port-forward svc/operator-service 8090:8090'

# Terminal 2 — forward your local 8090 to the node's 8090.
ssh -L 8090:localhost:8090 -i ~/.ssh/horus-track-a.pem ubuntu@13.219.32.204

# Now localhost:8090 on your machine reaches the in-cluster service.
curl -s localhost:8090/keys/jwks
```

---

## 1. Images to publish (pinned tags, ADR-0007)

All six control-plane images, tag `0.1.0-alpha.1` (must match
`deploy/base/kustomization.yaml` + `deploy/forge-registry/kustomization.yaml`):

| Image | Dockerfile | Context |
|-------|-----------|---------|
| `ghcr.io/arjunkhera/horus/horus-service` | `services/horus-service/Dockerfile` | repo root |
| `ghcr.io/arjunkhera/horus/operator-service` | `services/operator-service/Dockerfile` | repo root |
| `ghcr.io/arjunkhera/horus/vault` | `services/vault/Dockerfile` | `services/vault` |
| `ghcr.io/arjunkhera/horus/vault-router` | `services/vault-router/Dockerfile` | `services/vault-router` |
| `ghcr.io/arjunkhera/horus/forge-registry` | `packages/forge/packages/registry-service/Dockerfile` | repo root |
| `ghcr.io/arjunkhera/horus/backup` | `deploy/backup/Dockerfile` | `deploy/backup` |

> Reader/Writer Vault split is one image (`vault`) run in two modes via
> `VAULT_MODE` (see `deploy/base/vault.yaml`) — only one image to build.

## 2. Build & push

**Preferred (CI):** the chain is on `master`. Tag current `master` HEAD and push:
`git tag v0.1.0-alpha.1 && git push origin v0.1.0-alpha.1`. `docker-publish.yml`
builds *all six* images on the `v*` tag. The kustomizations are already pinned to
`0.1.0-alpha.1` (`deploy/base`, `deploy/forge-registry`, and the inline `backup`
image) — keep them in lockstep on any future re-pin.

**Manual (fallback only):** build the four root-context images from the monorepo
root, the two self-context ones from their dirs. Example:

```bash
# from repo root
for svc in horus-service operator-service; do
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f services/$svc/Dockerfile \
    -t ghcr.io/arjunkhera/horus/$svc:0.1.0-alpha.1 --push .
done

docker buildx build --platform linux/amd64,linux/arm64 \
  -f packages/forge/packages/registry-service/Dockerfile \
  -t ghcr.io/arjunkhera/horus/forge-registry:0.1.0-alpha.1 --push .

docker buildx build --platform linux/amd64,linux/arm64 \
  -f services/vault/Dockerfile \
  -t ghcr.io/arjunkhera/horus/vault:0.1.0-alpha.1 --push services/vault

docker buildx build --platform linux/amd64,linux/arm64 \
  -f services/vault-router/Dockerfile \
  -t ghcr.io/arjunkhera/horus/vault-router:0.1.0-alpha.1 --push services/vault-router

docker buildx build --platform linux/amd64,linux/arm64 \
  -f deploy/backup/Dockerfile \
  -t ghcr.io/arjunkhera/horus/backup:0.1.0-alpha.1 --push deploy/backup
```

## 3. Secrets — Sealed Secrets (A3)

Secrets are **not** created imperatively. Once the cluster + `sealed-secrets`
controller exist (the controller is the `sealed-secrets` ArgoCD app), seal each
of the six secrets and commit the encrypted `*.sealed.yaml` to `deploy/secrets/`;
the `horus-secrets` ArgoCD app (sync-wave -1) applies them and the controller
unseals them into real `Secret`s in `horus-system` before the workloads start.

**Full procedure: `deploy/secrets/README.md`.** The six:
`vault-secrets` (NEO4J_AUTH/PASSWORD, TYPESENSE_API_KEY, GITHUB_TOKEN,
GITHUB_REPO=`Arjunkhera/horus-knowledge`), `forge-registry-secrets` (S3 key
id/secret for `horus-forge-registry`), `backup-credentials` (AWS creds +
`BACKUP_BUCKET`), `grafana-admin` (password), plus the two principal secrets in
step 4. `deploy/secrets.example.yaml` still documents the plaintext key shapes.

> The Forge registry and Vault both use the cluster **Typesense**, started with
> `vault-secrets.TYPESENSE_API_KEY` — the same key Forge reads via
> `FORGE_REGISTRY_TYPESENSE_API_KEY` (wired in `deploy/forge-registry/`).

## 4. Operator first-boot keys → principal Secrets

operator-service generates the two keypairs on first boot (client-facing +
internal signing) and persists them to its PVC. Bring it up first, then derive
the Secrets the gateway + downstream verifiers need.

**Automated (preferred):** `horus operator init` derives and applies both
Secrets in one command. It port-forwards operator-service, calls the admin-only
`GET /admin/principal-bundle` (client public JWKS + internal signing **private**
key + internal **public** jwk), and applies `horus-service-secrets` +
`horus-principal-pub`:

```bash
# GitOps (this cluster): seal, commit, let ArgoCD apply — never direct-apply.
horus operator init --namespace horus-system --dry-run \
  | kubeseal --controller-namespace sealed-secrets --format yaml \
  > deploy/secrets/principal-secrets.sealed.yaml   # then uncomment in kustomization.yaml

# Direct-apply (non-GitOps / quick bring-up only):
horus operator init --namespace horus-system
```

The private signing key is exported only over the cluster-internal port-forward
(operator-service has no ingress; NetworkPolicy denies external) — it never
crosses the public boundary.

**Manual (fallback):**
1. Apply just the operator (e.g. `kubectl apply -k deploy/overlays/alpha` brings
   the whole control plane, but operator-service boots independently and is the
   key source).
2. Read the **public** halves:
   ```bash
   kubectl -n horus-system port-forward svc/operator-service 8090:8090 &
   curl -s localhost:8090/keys/jwks   # client JWKS + internal signing PUBLIC jwk
   ```
3. Construct the Secrets (see `deploy/secrets.example.yaml` for shapes):
   - `horus-service-secrets`:
     - `HORUS_CLIENT_JWKS_JSON` — client public JWKS (verifies inbound client tokens).
     - `HORUS_INTERNAL_SIGNING_KEY_JSON` — the internal signing **private** key
       (mints the 60s X-Horus-Principal JWT). Exported out-of-band from
       operator-service.
   - `horus-principal-pub` → key `pub.jwk` — the internal signing **public** JWK.
     **Both Vault and forge-registry mount this same Secret** to verify
     X-Horus-Principal (the single shared verification key — see
     `deploy/base/vault.yaml` and `deploy/forge-registry/forge-registry.yaml`).

```bash
kubectl apply -f my-secrets.yaml   # your filled-in copy of secrets.example.yaml
```

## 5. Bootstrap ArgoCD (app-of-apps)

```bash
kubectl apply -f deploy/argocd/app-of-apps.yaml
```

`horus-root` recursively syncs every child Application under
`deploy/argocd/apps`:

| App | Path | Wave | What |
|-----|------|------|------|
| `cert-manager` | Helm (charts.jetstack.io) | -2 | TLS controller + CRDs |
| `sealed-secrets` | Helm (bitnami-labs) | -2 | secret-unseal controller + CRDs |
| `cluster-issuers` | `deploy/cluster-issuers` | -1 | LE staging/prod ClusterIssuers |
| `horus-secrets` | `deploy/secrets` | -1 | the six SealedSecrets (no-op until sealed) |
| `horus-control-plane` | `deploy/overlays/alpha` | 0 | gateway, operator, Vault r/w + router, datastores |
| `horus-forge-registry` | `deploy/forge-registry` | 0 | Forge registry (in-cluster, S3 `horus-forge-registry`) |
| `horus-observability` | `deploy/observability` | 0 | Prometheus + Alertmanager + Grafana + blackbox-exporter |
| `horus-backup` | `deploy/backup` | 0 | operator SQLite→S3 CronJob + bucket-versioning Jobs |

Watch them go green:

```bash
kubectl -n argocd get applications
kubectl -n horus-system get pods
```

Expected workloads: `horus-service` (×2), `operator-service`, `vault-reader`
(×2), `vault-writer`, `vault-router`, `forge-registry`, `typesense`, `neo4j`,
plus observability + the backup CronJob.

## 6. Smoke the contract surface

```bash
# Gateway is the only public surface (HTTPS Ingress host horus.arjunkhera.io).
HOST=horus.arjunkhera.io
curl -s https://$HOST/health
curl -s https://$HOST/api/v1/aggregate/status   # federates Vault + Forge /health

# Forge reachable through the gateway, principal-authenticated:
#   horus-service mints X-Horus-Principal and injects it; forge-registry verifies
#   it against horus-principal-pub before serving writes.
curl -s https://$HOST/api/v1/forge/health

# TLS issuance check (cert-manager): Ready=True once HTTP-01 completes.
kubectl -n horus-system get certificate horus-service-tls
```

A read with no/invalid principal still succeeds (registry reads are public); a
publish without a `publisher`/`registry-admin` principal must return 403.

## 7. Two-user onboarding (the DoD flow)

```bash
# Operator onboards user "bob" and emits a pre-provisioned bundle.
horus operator user add bob > bob-bundle.json

# Second user, on their own machine, connects THROUGH horus-service:
horus setup --config bob-bundle.json
horus login
```

Verify bob's client reaches a real **remote** Vault via the gateway with the
Reader/Writer split honored (reads → reader pool, writes → writer), and Forge via
`/api/v1/forge/*`, all principal-authenticated. Confirm observability is
scraping and the backup CronJob has produced at least one versioned S3 object.

---

## 8. Known caveats

- **Cloudflare must be DNS-only for `horus.arjunkhera.io`.** A proxied (orange
  cloud) record breaks HTTP-01 issuance and hides the client IP from Traefik. Set
  the A-record to grey cloud, pointing at the Elastic IP, before flipping the
  Ingress issuer from `letsencrypt-staging` to `letsencrypt-prod`.
- **Observability covers up/down for all services, not full metrics.** Only
  `horus-service` exposes `/metrics`; the others are monitored via
  blackbox-exporter probing `/health` (`probe_success`, alert `ServiceProbeDown`).
  Per-service RED metrics need app instrumentation — separate app-track work.
- **`horus operator init`** automates the principal Secret wiring (step 4) via
  the admin-only `GET /admin/principal-bundle`; pipe through `kubeseal` for GitOps.
- **Sealing key is single-point-of-loss.** Back up the sealed-secrets controller
  key offline (see `deploy/secrets/README.md`); losing it forces re-sealing all
  six secrets against a new cluster key.
- **Image tags** are pinned to `0.1.0-alpha.1` across `deploy/base`,
  `deploy/forge-registry`, and the inline `backup` image; keep them in lockstep.
