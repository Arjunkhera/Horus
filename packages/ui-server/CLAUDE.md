# Horus UI — Web Interface

**This is a package inside the Horus monorepo. It is NOT a separate repository.**

This CLAUDE.md covers both `packages/ui-server` (Express proxy) and `packages/ui-client` (React SPA). They build into a single Docker image.

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-ui-package.md" })
knowledge_get_page({ id: "shared/procedures/horus-ui-local-dev.md" })
```

## Local Dev (fast iteration)

**Do NOT rebuild the Docker image for UI changes.** Instead, run the UI locally with hot reload:

1. Stop the `horus-ui` container (`docker stop horus-horus-ui-1`)
2. Run ui-server locally: `ANVIL_URL=http://localhost:8100 VAULT_URL=http://localhost:8300 FORGE_URL=http://localhost:8200 SEARCH_URL=http://localhost:8108 HORUS_DATA_PATH=<data-path> pnpm dev`
3. Run ui-client locally: `cd ../ui-client && pnpm dev`
4. Open `http://localhost:5173` — Vite HMR gives sub-second frontend updates

Full procedure: see Vault page `shared/procedures/horus-ui-local-dev.md`

## What This Does

- **ui-server**: Express proxy that routes `/api/anvil/*` → Anvil (8100), `/api/vault/*` → Vault MCP (8300), `/api/forge/*` → Forge (8200). Also serves the built React SPA and persists config to `$HORUS_DATA_PATH/_system/ui/`.
- **ui-client**: React + Vite SPA with AI chat integration, markdown rendering, and dashboard views.

## Build

```bash
# Frontend
cd ../ui-client && pnpm build

# No build needed for ui-server (JavaScript)
```

## Dependencies

- No workspace dependencies on other Horus packages
- Runtime: Anvil, Vault MCP, Forge (all three must be healthy)

## Rules

- **Never run `docker compose build horus-ui`** — push to master and let CI build the GHCR image
- UI proxies to Vault MCP (8300), NOT to the Vault service (8000) directly
- Config writes use atomic temp-file-then-rename pattern
