# Search — Shared Typesense Client

**This is a package inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-search-package.md" })
```

## What This Package Does

`@horus/search` provides the unified Typesense configuration, client factory, and collection bootstrap used by Anvil and Forge. It defines the `horus_documents` collection schema that enables cross-system search.

## Build

```bash
pnpm build    # TypeScript → dist/
```

## Critical: Blast Radius

**Changes to this package affect ALL services that use Typesense.** After any change:

1. Rebuild `packages/anvil`
2. Rebuild `packages/forge` (specifically `packages/forge/packages/core`)
3. Verify the Python Vault service schema still matches (`services/vault/`)

The Vault service (Python) reimplements the same collection schema independently — keep them in sync.

## Dependencies

- `typesense` (only dependency)

## Consumed By

- `packages/anvil` (workspace:*)
- `packages/forge/packages/core` (workspace:*)
