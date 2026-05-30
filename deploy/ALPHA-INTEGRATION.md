# Horus Alpha — End-to-End Live Integration Runbook

The literal Definition of Done for the alpha (Seq 2 deferred this because it needs
a real cluster + published images). Standing the full stack up on a real k3s
cluster via ArgoCD, then proving a second user can connect **through**
horus-service to a remote Vault (principal-authenticated, Reader/Writer split)
and Forge.

This runbook is executed by an operator with Docker, GHCR push rights, AWS, and
`kubectl`/ArgoCD access to a k3s cluster. It is **not** runnable from the agent
sandbox (no Docker daemon, GHCR push blocked, no cluster).

> **Validation status of the image builds:** the forge-registry image uses the
> pre-existing, EC2-proven Dockerfile. The horus-service, operator-service, and
> backup Dockerfiles + CI jobs are **new in this branch** and are first validated
> at build time (step 2) — this PR targets `claude/seq2-control-plane`, not
> `master`, so `docker-publish.yml` does not CI-build them until the chain merges
> to master. Build them manually first (step 2) and fix any build issues before
> proceeding.

---

## 0. Prerequisites

- A running **k3s** (or k8s) cluster with **ArgoCD** installed, and `kubectl`
  context pointing at it.
- **Traefik** ingress (k3s default) — horus-service publishes an Ingress on host
  `horus.local`.
- Docker with **buildx** + QEMU (multi-arch amd64/arm64), logged in to GHCR with
  `write:packages` (`gh auth login -s write:packages` or a PAT).
- AWS account + an IAM user with S3 access for two buckets:
  - `horus-forge-registry` — Forge artifacts (versioning enabled by the
    `enable-forge-bucket-versioning` Job).
  - the operator backup bucket (`BACKUP_BUCKET`).
- The Horus CLI built (`pnpm --filter @arkhera30/cli build`) for `horus operator …`.

---

## 1. Images to publish (pinned tags, ADR-0007)

All six control-plane images, tag `0.1.0-alpha` (must match
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

**Preferred (CI):** once this chain is merged to `master`, push a tag
`v0.1.0-alpha` — `docker-publish.yml` builds every changed image and, on a `v*`
tag, *all* of them. Then re-pin the kustomization tags to the published SHA/tag
if not using `0.1.0-alpha`.

**Manual (pre-merge / first validation):** build the four root-context images
from the monorepo root, the two self-context ones from their dirs. Example:

```bash
# from repo root
for svc in horus-service operator-service; do
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f services/$svc/Dockerfile \
    -t ghcr.io/arjunkhera/horus/$svc:0.1.0-alpha --push .
done

docker buildx build --platform linux/amd64,linux/arm64 \
  -f packages/forge/packages/registry-service/Dockerfile \
  -t ghcr.io/arjunkhera/horus/forge-registry:0.1.0-alpha --push .

docker buildx build --platform linux/amd64,linux/arm64 \
  -f services/vault/Dockerfile \
  -t ghcr.io/arjunkhera/horus/vault:0.1.0-alpha --push services/vault

docker buildx build --platform linux/amd64,linux/arm64 \
  -f services/vault-router/Dockerfile \
  -t ghcr.io/arjunkhera/horus/vault-router:0.1.0-alpha --push services/vault-router

docker buildx build --platform linux/amd64,linux/arm64 \
  -f deploy/backup/Dockerfile \
  -t ghcr.io/arjunkhera/horus/backup:0.1.0-alpha --push deploy/backup
```

## 3. Namespace + datastore secrets

```bash
kubectl create namespace horus-system
```

Create `vault-secrets` (NEO4J_AUTH/PASSWORD, TYPESENSE_API_KEY, GITHUB_TOKEN,
GITHUB_REPO) and `forge-registry-secrets` (S3 access key id/secret) and
`backup-credentials` (AWS creds + `BACKUP_BUCKET`) from real values — see
`deploy/secrets.example.yaml` for the exact keys. **Do not commit real values.**

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
horus operator init --namespace horus-system
# or inspect first:
horus operator init --dry-run        # print the Secret manifests
horus operator init --out secrets.yaml
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

| App | Path | What |
|-----|------|------|
| `horus-control-plane` | `deploy/overlays/alpha` | gateway, operator, Vault r/w + router, datastores |
| `horus-forge-registry` | `deploy/forge-registry` | Forge registry (this migration) |
| `horus-observability` | `deploy/observability` | metrics/logs |
| `horus-backup` | `deploy/backup` | operator SQLite→S3 CronJob + bucket-versioning Jobs |

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
# Gateway is the only public surface (Ingress host horus.local).
HOST=horus.local
curl -s http://$HOST/health
curl -s http://$HOST/api/v1/aggregate/status   # federates Vault + Forge /health

# Forge reachable through the gateway, principal-authenticated:
#   horus-service mints X-Horus-Principal and injects it; forge-registry verifies
#   it against horus-principal-pub before serving writes.
curl -s http://$HOST/api/v1/forge/health
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

- **New Dockerfiles unproven until step 2.** horus-service/operator-service/backup
  images are new; build them manually first and fix issues before ArgoCD sync.
- **`horus operator init`** now automates the principal Secret wiring (step 4)
  via the admin-only `GET /admin/principal-bundle` endpoint; the manual flow
  remains as a fallback.
- **Pre-existing test failure** unrelated to this work: `registry-service`
  `tests/search.test.ts > rebuild() > creates the collection when it does not
  exist` (stale Typesense mock). It will show red in CI on the master merge —
  fix or quarantine separately.
- **Image tags** are pinned to `0.1.0-alpha` across `deploy/base` and
  `deploy/forge-registry`; keep them in lockstep when re-pinning per release.
