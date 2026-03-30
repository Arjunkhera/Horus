# Anvil — Notes MCP Server

**This is a package inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-anvil-package.md" })
```

For architecture and inter-package relationships:
```
knowledge_get_page({ id: "shared/concepts/horus-package-architecture.md" })
```

## What This Package Does

MCP server providing 10 tools for structured note management (tasks, journals, stories). Uses SQLite (in-process WASM) for metadata and Typesense for search via the shared `horus_documents` collection.

## Build & Test

```bash
pnpm build    # TypeScript → dist/
pnpm test     # Vitest
```

## Dependencies

- `@horus/search` (workspace:*) — changes to `packages/search` require rebuilding this package
- Typesense (runtime, port 8108)

## Rules

- **Never run `docker compose build anvil`** — push to master and let CI build the GHCR image
- Changes here trigger CI build of `ghcr.io/arjunkhera/horus/anvil`
