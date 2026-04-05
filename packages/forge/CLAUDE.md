# Forge — Workspace & Session Manager

**This is a package inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-forge-package.md" })
```

For architecture and inter-package relationships:
```
knowledge_get_page({ id: "shared/concepts/horus-package-architecture.md" })
```

## What This Package Does

MCP server providing 18 tools for workspace management, code sessions (git worktrees), artifact registry, and repository scanning. Contains three nested sub-packages:

- `packages/core/` — @forge/core (all business logic)
- `packages/mcp-server/` — @forge/mcp-server (MCP tool wrappers)
- `packages/cli/` — @forge/cli (internal CLI, not user-facing)

## Build & Test

```bash
pnpm build    # Builds all sub-packages (core must build before mcp-server)
pnpm test     # Vitest (~390 tests)
```

## Dependencies

- `@horus/search` (workspace:* via @forge/core) — changes to `packages/search` require rebuilding
- `@forge/core` (workspace:* in mcp-server and cli)
- Anvil + Vault (runtime health check dependency)
- Typesense (runtime, port 8108)

## Rules

- **Never run `docker compose build forge`** — push to master and let CI build the GHCR image
- Changes here trigger CI build of `ghcr.io/arjunkhera/horus/forge`
- If changing `packages/core`, rebuild `packages/mcp-server` too
