# Forge Registry Service — HTTP Artifact Registry

**This is a sub-package inside the Horus monorepo at `packages/forge/packages/registry-service/`.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "procedures/forge-registry-deploy.md" })
knowledge_get_page({ id: "concepts/forge-registry-architecture.md" })
knowledge_get_page({ id: "learnings/forge-registry-deploy-gotchas.md" })
```

## What This Package Does

HTTP registry service for publishing, resolving, searching, and verifying Forge artifacts (skills, agents, plugins, personas, workspace-configs). Fastify server with S3 storage, Typesense search, SQLite auth/audit, and built-in/trusted-headers/webhook auth strategies.

## Infrastructure

> **⚠️ RETIRED (2026-05-31).** The AWS EC2 + CloudFront + WAF + Terraform deployment described in this
> section has been **decommissioned**. The registry now runs **in-cluster on Kubernetes** (`horus-system`),
> deployed by ArgoCD from `deploy/forge-registry/` (app `horus-forge-registry`), exposed via the Horus
> gateway at `https://horus.arjunkhera.io/api/v1/forge` (anonymous reads, JWT-gated writes). The S3 bucket
> `horus-forge-registry` is **unchanged**. Redeploy = push to `master` → CI builds
> `ghcr.io/arjunkhera/horus/forge-registry` → ArgoCD syncs. The `deploy/scripts/` + `deploy/terraform/`
> tree and the `forge-registry-ops` skill below are **historical**. See story `2828ffb7` and Alpha Program
> journal `13855a87`.

**(Historical) AWS deployment:** CloudFront + WAF → EC2 (t4g.small, ARM64) → nginx → registry (:8744) + typesense (:8108), artifacts in S3 with CloudFront OAC for reads. Deploy scripts (`deploy.sh`, `redeploy.sh`, `smoke-test.sh`, `ssh.sh`, `teardown.sh`, `create-keypair.sh`) lived in `deploy/scripts/`; Terraform (local state) at `deploy/terraform/public-global/`. All torn down — do not run.

## Build & Test

```bash
pnpm build    # Requires @horus/search and @forge/core built first
pnpm test     # Vitest
```

## Docker

```bash
# Build ARM64 image (from monorepo root):
docker buildx build --platform linux/arm64 \
  --tag ghcr.io/arjunkhera/horus/forge-registry:latest \
  --file packages/forge/packages/registry-service/deploy/Dockerfile.registry \
  --push .
```

## Dependencies

- `@forge/core` (workspace:*) — core artifact logic
- `@horus/search` (transitive via @forge/core) — **must be in Dockerfile**
- Typesense (runtime, :8108)
- S3 (runtime, explicit IAM user creds — does NOT use instance profile)

## Rules

- **Dockerfile pins `pnpm@9.15.9`** — do NOT upgrade to v11 (breaks esbuild postinstall)
- **`@horus/search` must be in Dockerfile** — `@forge/core` imports it at build time
- **S3 creds are explicit** — `config.ts` requires `FORGE_REGISTRY_S3_ACCESS_KEY_ID` env var, does not use credential chain
- **Typesense image has no curl** — healthcheck must use bash TCP check
- **AL2023 curl-minimal** — user-data.sh uses `--allowerasing` to install full curl

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Fastify server entry |
| `src/config.ts` | Configuration loader (S3 fail-closed check at L306) |
| `src/auth/builtin.ts` | Bearer token auth, bcrypt comparison |
| `src/routes/publish.ts` | `POST /artifacts/:type/:id/:version` (JSON body, base64 files) |
| `deploy/Dockerfile.registry` | Multi-stage Docker build (patched for monorepo) |
| `deploy/scripts/user-data.sh` | EC2 cloud-init bootstrap |
| `deploy/templates/docker-compose.prod.yml` | Production compose template |
| `deploy/templates/forge-registry.yaml.tpl` | Service config (Terraform-rendered) |
