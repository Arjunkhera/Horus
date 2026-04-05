# Horus CLI — User-Facing Interface

**This is a package inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-cli-package.md" })
```

For release procedure:
```
knowledge_get_page({ id: "shared/procedures/horus-release.md" })
```

## What This Package Does

The `horus` CLI (`@arkhera30/cli` on npm) is the ONLY way users run Horus. Commands: setup, up, down, status, connect, doctor, backup, update. It pulls pre-built Docker images from GHCR — no local building.

## Build & Test

```bash
pnpm build    # TypeScript → dist/
pnpm test     # Vitest
```

## Publishing

```bash
# Bump version in package.json first
pnpm build && pnpm test && npm publish
```

## Dependencies

- No workspace dependencies on other Horus packages
- commander, chalk, ora, execa, @inquirer/prompts

## Rules

- **This package is the authority on how Horus runs.** The embedded docker-compose template defines all services.
- **Never tell users to run `docker compose` directly.** Always use `horus up`, `horus down`, `horus status`.
- Changes here require a new npm publish — CI does NOT auto-publish the CLI.
