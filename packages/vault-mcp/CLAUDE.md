# Vault MCP — Knowledge MCP Adapter

**This is a package inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-vault-mcp.md" })
```

For the full Vault chain (MCP → Router → Service):
```
knowledge_get_page({ id: "shared/guides/horus-vault-router.md" })
knowledge_get_page({ id: "shared/guides/horus-vault-service.md" })
```

## What This Package Does

Thin MCP adapter that translates 14 MCP tool calls into HTTP REST requests against the Vault Router. Contains NO business logic — all knowledge logic lives in `services/vault` (Python).

## Build & Test

```bash
pnpm build    # TypeScript → dist/
```

No tests — this is a pure passthrough. Test the Vault service directly.

## Dependencies

- `@modelcontextprotocol/sdk` (only dependency — no workspace imports)
- Vault Router (runtime, HTTP calls to port 8400)

## Rules

- **Never run `docker compose build vault-mcp`** — push to master and let CI build the GHCR image
- Changes here trigger CI build of `ghcr.io/arjunkhera/horus/vault-mcp`
- Claude connects here (port 8300), NOT to the Vault service directly
