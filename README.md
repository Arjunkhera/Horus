# Horus

Integration layer for the Horus stack — Anvil, Vault, and Forge running together.

## Repos

| Service | Port | Description |
|---------|------|-------------|
| [Anvil](../Anvil) | 8100 | Notes and knowledge MCP server (Node.js) |
| [Vault](../Vault) | 8000 | Knowledge base REST API (FastAPI) |
| [Forge](../Forge) | 8200 | Workspace manager MCP server (Node.js) |

Supporting data repos: [Notes](../Notes), [Forge-Registry](../Forge-Registry), [knowledge-base](../knowledge-base)

## Prerequisites

- Docker + Docker Compose
- All sibling repos cloned at the same directory level as this one

## Running the stack

```bash
# Start all three services
docker-compose up --build

# Or in detached mode
docker-compose up --build -d

# With custom env overrides (copy and edit first)
cp .env.example .env
docker-compose --env-file .env up --build
```

Forge depends on Anvil and Vault being healthy before it starts. Expect ~60s for the full stack to be ready.

## Running tests

With the stack running:

```bash
# Individual service smoke tests
bash tests/smoke-anvil.sh   # 7 Anvil MCP tools
bash tests/smoke-vault.sh   # 10 Vault REST endpoints
bash tests/smoke-forge.sh   # 9 Forge MCP tools + workspace lifecycle

# All three in sequence
bash tests/smoke-all.sh

# End-to-end integration test
bash tests/smoke-e2e.sh

# Skip Docker-exec phase (if running tests from outside Docker)
SKIP_DOCKER=1 bash tests/smoke-e2e.sh
```

Environment variables for all scripts (defaults shown):

```bash
ANVIL_URL=http://localhost:8100
VAULT_URL=http://localhost:8000
FORGE_URL=http://localhost:8200
FORGE_CONTAINER=forge   # container name for docker exec in e2e test
SKIP_DOCKER=0
```

## What the e2e test validates

1. **Pre-flight** — all three services respond to health checks
2. **Workspace lifecycle** — Forge creates, lists, and reports status of a workspace
3. **MCP config verification** — emitted `anvil.json` and `vault.json` point to the correct services
4. **Simulated agent flow** — Anvil search → Vault resolve-context → Forge repo-resolve
5. **Cleanup** — workspace deleted and confirmed gone

## Test fixtures

The e2e test relies on fixtures in sibling repos:

- `../Notes/_test/` — 4 test notes tagged `test-fixture` (loaded by Anvil)
- `../Forge-Registry/workspace-configs/test-workspace/` — workspace config used by Forge
- `../Forge-Registry/skills/test-integration-skill/` — skill installed into test workspaces
