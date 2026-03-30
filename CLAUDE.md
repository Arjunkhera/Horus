# Horus Repository

## Vault Identity

- **repo**: horus
- **program**: horus

## Critical Rules

1. **This is ONE product, ONE repo.** Anvil, Forge, and Vault are package names inside this pnpm monorepo — NOT separate repositories or independent services. They share the same git repo, Typesense instance, CI pipeline, and cannot be developed, tested, or deployed independently.

2. **Never use `docker compose` directly.** The docker-compose.yml is for CI/CD publishing only. All user-facing operations go through the `horus` CLI (`horus up`, `horus down`, `horus status`). Never run `docker compose build`, `docker compose up`, or `docker compose restart` — these create confusion between local builds and GHCR images.

3. **Images are published to GHCR, pulled at runtime.** Push to `master` → CI builds affected images → `ghcr.io/arjunkhera/horus/<service>` updated → users get new images on next `horus up`. No local image building.

## Always Load (Vault Pages)

Before working on this repo, load context from Vault. These pages are the authoritative documentation:

| Page | What It Covers |
|------|---------------|
| `shared/programs/horus.md` | Program identity, architecture overview, how users run Horus |
| `shared/repos/horus.md` | Repo structure, tech stack, all packages, Docker services, CI |
| `shared/concepts/horus-package-architecture.md` | How packages depend on each other, network call graph, shared infrastructure |
| `shared/guides/horus-development-workflow.md` | Build, test, deploy workflow — the right way to make changes |
| `shared/procedures/horus-release.md` | Release procedure for service images (CI) and CLI (npm) |

Load a specific package guide when working on that package:

| Package | Guide |
|---------|-------|
| `packages/anvil` | `shared/guides/horus-anvil-package.md` |
| `packages/forge` | `shared/guides/horus-forge-package.md` |
| `services/vault` | `shared/guides/horus-vault-service.md` |
| `services/vault-router` | `shared/guides/horus-vault-router.md` |
| `packages/vault-mcp` | `shared/guides/horus-vault-mcp.md` |
| `packages/cli` | `shared/guides/horus-cli-package.md` |
| `packages/search` | `shared/guides/horus-search-package.md` |
| `packages/ui-server` + `packages/ui-client` | `shared/guides/horus-ui-package.md` |

To load a page: `knowledge_get_page({ id: "<page-id>" })`

## Quick Reference

### Build & Test

```bash
pnpm install && pnpm build && pnpm test   # All TypeScript packages
cd services/vault && pytest                 # Vault (Python)
```

### Deploy Changes

Push to `master` → CI auto-builds affected Docker images → GHCR updated.

### CLI Release

```bash
cd packages/cli && pnpm build && pnpm test && npm publish
```

### Workspace Dependencies

```
@horus/search ← packages/anvil, packages/forge/packages/core
@forge/core   ← packages/forge/packages/mcp-server, packages/forge/packages/cli
```

Changes to `@horus/search` require rebuilding Anvil and Forge.
