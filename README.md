# Horus

Integration layer for the Horus stack — Anvil, Vault, and Forge running together in Docker.

## Services

| Service | Port | Description |
|---------|------|-------------|
| [Anvil](../Anvil) | 8100 | Notes MCP server (Node.js) |
| [Vault REST](../Vault/knowledge-service) | 8000 | Knowledge base REST API (FastAPI) — internal only |
| [Vault MCP](../Vault/knowledge-mcp) | 8300 | Vault MCP adapter (Node.js) |
| [Forge](../Forge) | 8200 | Workspace manager MCP server (Node.js) |

Supporting data repos: [Notes](../Notes), [Forge-Registry](../Forge-Registry), [knowledge-base](../knowledge-base)

Vault REST (8000) is internal to the Docker network — Claude Desktop never connects to it directly.
Vault MCP (8300) is the public-facing MCP adapter that proxies calls to Vault REST.

## Prerequisites

- Docker + Docker Compose
- All sibling repos cloned at the same directory level as this one

## Installation

```bash
npm install -g @arkhera30/cli
horus setup
```

## Updating

**Update container services** (Vault, Anvil, Forge — pulls latest images):

```bash
horus update
```

**Update the Horus CLI itself:**

```bash
npm install -g @arkhera30/cli@latest
```

Run `horus --version` to confirm the new version. To roll back services after an update: `horus update --rollback`.

## Running the stack

```bash
# Start all four services
docker-compose up --build -d

# Watch startup logs
docker-compose logs -f

# Check health
docker-compose ps
```

Startup order: Anvil and Vault boot first → Vault MCP and Forge wait for their dependencies to be healthy. Expect ~60–90s for the full stack to be ready.

## Claude Desktop configuration

With the stack running, set `~/Library/Application Support/Claude/claude_desktop_config.json` to:

```json
{
  "mcpServers": {
    "anvil": {
      "url": "http://localhost:8100"
    },
    "vault": {
      "url": "http://localhost:8300"
    },
    "forge": {
      "url": "http://localhost:8200"
    }
  }
}
```

Restart Claude Desktop after saving. That's the complete setup — no local builds, no config files, just Docker.

## Environment overrides

Copy `.env.example` to `.env` for custom port bindings or settings:

```bash
cp .env.example .env
docker-compose --env-file .env up --build -d
```

See `.env.example` for all available variables.

## Running tests

With the stack running:

```bash
# Individual service smoke tests
bash tests/smoke-anvil.sh       # 7 Anvil MCP tools
bash tests/smoke-vault.sh       # 10 Vault REST endpoints
bash tests/smoke-forge.sh       # 9 Forge MCP tools + workspace lifecycle

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

### Shutdown validation (run separately)

```bash
# Verifies all containers stop within the grace period and exit cleanly.
# ⚠ This STOPS the stack — restart manually afterward.
bash tests/smoke-shutdown.sh
```

The shutdown test checks:
- `docker compose stop` completes within 30s
- All containers exit with code 0 or 143 (clean SIGTERM), not 137 (SIGKILL)

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

## License & Contributing

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

By submitting a pull request or other contribution, you agree to the [Contributor License Agreement](CLA.md).
