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

Deployed to AWS (us-east-1) via Terraform. Architecture: CloudFront + WAF → EC2 (t4g.small, ARM64) → nginx → registry (:8744) + typesense (:8108). Artifacts stored in S3 with CloudFront OAC for reads.

### Deploy scripts

All in `deploy/scripts/`:

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Full pipeline: Docker build → terraform → verify |
| `redeploy.sh` | Code update: build → push → SSH pull → restart |
| `smoke-test.sh` | Validate running instance |
| `ssh.sh` | SSH helper (auto-resolves IP from terraform) |
| `teardown.sh` | Destroy infrastructure |
| `create-keypair.sh` | First-time EC2 key pair setup |

### Terraform

Located at `deploy/terraform/public-global/`. State is LOCAL — back up `terraform.tfstate`.

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
