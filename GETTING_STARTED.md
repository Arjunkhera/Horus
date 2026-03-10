# Horus — Getting Started

Anvil · Vault · Forge running as a single Docker stack.

One command to start everything. Three URLs in Claude Desktop. Done.

---

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose plugin)

---

## Step 0 — Configure Your Data Directory

Create a directory where Horus will store cloned repositories and workspace data. The path must be an absolute path (Docker does not expand `~` or `${HOME}`).

```bash
# Create the data directory
mkdir -p "$HOME/horus-data"

# Export the path (or add to ~/.bashrc or ~/.zshrc for persistence)
export HORUS_DATA_PATH="$HOME/horus-data"
```

Then set the required environment variables in `.env` or as exports:

```bash
# Copy the template
cp .env.example .env

# Edit .env and set:
# HORUS_DATA_PATH=/absolute/path/to/your/data/directory
# ANVIL_REPO_URL=https://github.com/youruser/your-notes-repo
# GITHUB_TOKEN=your_token_if_repos_are_private (optional)
```

Or export them before running `docker-compose`:

```bash
export HORUS_DATA_PATH="$HOME/horus-data"
export ANVIL_REPO_URL="https://github.com/youruser/your-notes-repo"
export GITHUB_TOKEN="your_token_if_needed"
```

**On first boot**, each service will automatically clone its repository into the appropriate subdirectory of `HORUS_DATA_PATH` if the directory is empty. Subsequent boots will use the cloned repos.

---

## Step 1 — Start the Stack

```bash
cd ~/Desktop/Repositories/Horus

# First run: starts all services and installs horus-core to ~/.claude/
bash setup.sh

# Subsequent runs (skip rebuild if images are current):
bash setup.sh --skip-build
```

The setup script:
1. Starts all four Docker services
2. Waits for Forge to be healthy
3. Copies horus-core skills to `~/.claude/skills/`
4. Upserts the system-awareness rules into `~/.claude/CLAUDE.md`

**Startup order and timing:**

| Service | Port | Waits for | Notes |
|---------|------|-----------|-------|
| Anvil | 8100 | — | Notes MCP server |
| Vault REST | 8000 | — | Knowledge base REST API (internal only) |
| Vault MCP | 8300 | Vault REST healthy | MCP adapter — this is what Claude connects to |
| Forge | 8200 | Anvil + Vault REST healthy | Workspace & registry MCP server |

Expect **60–90 seconds** on first boot. Vault builds its semantic search index on startup, which takes the longest.

> If you prefer to manage Docker manually:
> ```bash
> docker-compose up --build -d   # start stack
> docker-compose up -d           # start without rebuild
> ```
> Then run `bash setup.sh --skip-build` separately to install horus-core.

---

## Step 2 — Configure Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json` and set:

```json
{
  "mcpServers": {
    "anvil":  { "url": "http://localhost:8100" },
    "vault":  { "url": "http://localhost:8300" },
    "forge":  { "url": "http://localhost:8200" }
  }
}
```

**Save the file, then fully quit and relaunch Claude Desktop.**

> The Vault REST API (port 8000) is internal to Docker — Claude Desktop never connects to it directly.
> Vault MCP (port 8300) is the public MCP endpoint that proxies calls to Vault REST.

---

## Step 3 — Verify

Ask Claude to call a tool from each service:

- **Anvil:** _"Search my notes for 'test'"_ → should return results from your Notes repo
- **Vault:** _"What do you know about the Anvil codebase?"_ → Vault resolves context from the knowledge base
- **Forge:** _"List my workspaces"_ → Forge lists active workspaces (empty on first run is fine)

Or run the automated smoke tests:

```bash
bash tests/smoke-all.sh    # 26 checks across Anvil, Vault, Forge
bash tests/smoke-e2e.sh    # full end-to-end workspace lifecycle test
```

---

## Daily Usage

**Start:**
```bash
cd ~/Desktop/Repositories/Horus
bash setup.sh --skip-build
```

The stack must be running before Claude Desktop tries to connect. If you open Claude Desktop first, restart it after the stack is up.

**Stop:**
```bash
docker-compose stop          # stop gracefully, keep volumes
docker-compose down          # stop and remove containers, keep volumes
docker-compose down -v       # also removes the Vault internal workspace (safe)
```

> With bind mounts, `down -v` is safe: your cloned repos and Forge workspaces live in `HORUS_DATA_PATH` on the host and are never deleted. Only the internal `vault-workspace` named volume is removed.

**Rebuild after code changes:**
```bash
docker-compose up --build vault-mcp -d   # rebuild one service
docker-compose up --build -d              # rebuild everything
```

**Scanning repos in subdirectories:**

If your repos are organised in subdirectories (e.g. `~/Repositories/ArjunKhera/`), tell Forge to scan them:

```bash
horus config set host-repos-extra-scan-dirs ArjunKhera
horus down && horus up
```

Multiple subdirectories are comma-separated: `horus config set host-repos-extra-scan-dirs ArjunKhera,Work,Personal`

---

## Environment Overrides

Copy `.env.example` to `.env` and edit before starting:

```bash
cp .env.example .env
docker-compose --env-file .env up -d
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `HORUS_DATA_PATH` | (required) | Absolute path where repositories and workspaces are stored |
| `ANVIL_REPO_URL` | (empty) | Your Notes repository URL (required if starting fresh) |
| `VAULT_KNOWLEDGE_REPO_URL` | `https://github.com/arkhera/knowledge-base` | Knowledge base repository URL |
| `FORGE_REGISTRY_REPO_URL` | `https://github.com/arkhera/Forge-Registry` | Forge registry repository URL |
| `GITHUB_TOKEN` | (empty) | Token for cloning/pulling private repos (used by all three services) |
| `ANVIL_PORT` | `8100` | Host port for Anvil MCP |
| `VAULT_MCP_PORT` | `8300` | Host port for Vault MCP |
| `FORGE_PORT` | `8200` | Host port for Forge MCP |
| `FORGE_SCAN_PATHS` | `/data/repos` | Colon-separated container paths Forge scans for repos. Auto-generated by the CLI — use `horus config set host-repos-extra-scan-dirs` instead of editing directly. |
| `ANVIL_SYNC_INTERVAL` | `300` | Seconds between Notes git pulls |
| `VAULT_SYNC_INTERVAL` | `300` | Seconds between Vault syncs |
| `LOG_LEVEL` | `info` | Vault log verbosity (debug/info/warning/error) |

If you change the port for any MCP service, update the corresponding URL in your Claude Desktop config.

---

## Troubleshooting

**Claude Desktop shows MCP servers as disconnected**
- Is the stack running? `docker-compose ps` — all four services should show `running`
- Did you fully restart Claude Desktop after saving the config?
- Port conflict? Run `lsof -i :8100` (or 8200/8300) to check if another process is using the port

**A container exits immediately on startup**
```bash
docker-compose logs vault      # check for clone/pull errors
docker-compose logs forge      # check for clone/pull errors
docker-compose logs vault-mcp
docker-compose logs anvil
```
The most common cause is a missing or empty `HORUS_DATA_PATH`, or invalid repository URLs. Verify:
- `HORUS_DATA_PATH` is set to an absolute path (not `~` or `${HOME}`)
- `ANVIL_REPO_URL` is set to your Notes repo (required)
- `GITHUB_TOKEN` is set if any repos are private

**Vault is very slow to start**
Vault builds its QMD semantic search index on first boot — this is normal and can take 1–3 minutes. Subsequent starts reuse the index and are much faster. Watch with `docker-compose logs -f vault`.

**Smoke tests failing**
Check service logs first. Known intentional skips: `check-duplicates` (heavy CPU, skipped by design) and `registry/add` (read-only test fixture).

---

## Quick Reference

```
Start (first time):   bash setup.sh
Start (skip rebuild): bash setup.sh --skip-build
Stop:                 docker-compose stop
Check health:         docker-compose ps
Tail logs:            docker-compose logs -f <service>
Run smoke tests:      bash tests/smoke-all.sh
Test shutdown:        bash tests/smoke-shutdown.sh  ⚠ stops the stack
```

Claude Desktop config:
```json
"anvil":  { "url": "http://localhost:8100" }
"vault":  { "url": "http://localhost:8300" }
"forge":  { "url": "http://localhost:8200" }
```
