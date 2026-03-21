# Horus Repository

## CLI Release Process

Before performing any release, publish, or version bump on this repository:

1. Call `knowledge_search` with query `"Horus CLI release procedure"` and scope `{ "repo": "Horus" }`
2. Read the returned procedure page with `knowledge_get_page`
3. Follow every step in order — do not skip steps

The canonical release procedure lives in Vault (`shared/procedures/horus-cli-release.md`). Always fetch the latest version before proceeding.

---

## Monorepo Layout

All services live in this single repo (as of 2026-03-21):

| Path | Service | Language |
|------|---------|----------|
| `packages/anvil/` | Anvil MCP server | TypeScript |
| `packages/forge/` | Forge workspace manager | TypeScript |
| `packages/vault-mcp/` | Vault MCP adapter | TypeScript |
| `services/vault/` | Vault knowledge service | Python |
| `packages/ui-server/` + `packages/ui-client/` | Horus UI | TypeScript |
| `packages/cli/` | Horus CLI | TypeScript |

The old separate repos (`Desktop/Repositories/Anvil`, `Vault`, `Forge`) are archived and no longer the source of truth.

## Post-Merge Docker Rebuild

For changes to backend services (build from monorepo source):

```bash
# Dev: build from source
cd ~/Desktop/Repositories/Horus
docker compose build <service> && docker compose up -d <service>
```

Where `<service>` is one of: `anvil`, `vault`, `vault-mcp`, `forge`.

CI builds and pushes images to GHCR automatically on push to `master` (path-filtered per service).
