# Horus Architecture

Technical overview of the Horus system for users who want to understand how the services fit together.

---

## Service Diagram

```
+------------------------------------------------------------------+
|  Host Machine                                                    |
|                                                                  |
|  +---------------------------+                                   |
|  | Claude Desktop / Code /   |                                   |
|  | Cursor                    |                                   |
|  +------+-------+-------+---+                                    |
|         |       |       |                                        |
|      MCP/HTTP   |    MCP/HTTP                                    |
|         |       |       |                                        |
|  +------+-------+-------+---------------------------------------+
|  | Docker Bridge Network: horus-net                              |
|  |                                                               |
|  |  :8100          :8300           :8200                         |
|  |  +--------+     +-----------+   +---------+                   |
|  |  | Anvil  |     | Vault MCP |   |  Forge  |                   |
|  |  | Node.js|     | Node.js   |   | Node.js |                   |
|  |  +---+----+     +-----+-----+   +----+----+                  |
|  |      |                |              |                        |
|  |      |          +-----+-----+        |                        |
|  |      |          | Vault REST|        |                        |
|  |      |          | FastAPI   |        |                        |
|  |      |          |   :8000   |        |                        |
|  |      |          +-----+-----+        |                        |
|  |      |                |              |                        |
|  |      +--------+-------+---------+----+                        |
|  |               |                                               |
|  |         +-----+-------+                                       |
|  |         | QMD Daemon  |                                       |
|  |         | :8181       |                                       |
|  |         | (internal)  |                                       |
|  |         +-------------+                                       |
|  |                                                               |
|  +---------------------------------------------------------------+
|                                                                  |
|  Host Filesystem                                                 |
|  ~/Horus/data/                                                  |
|    notes/            Anvil markdown notes (git repo)             |
|    knowledge-base/   Vault knowledge pages (git repo)            |
|    registry/         Forge plugin registry (git repo)            |
|    workspaces/       Forge workspace directories                 |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Flow

A request travels through Horus in four stages:

```
1. User        "What's pending?"
                     |
2. Claude      Reads horus-core routing rules
               Decides: this is an Anvil query
               Calls MCP tool: anvil_search({ query: "pending" })
                     |
3. Service     Anvil receives the tool call over HTTP
               Queries the QMD daemon for semantic search
               Reads matching notes from disk
               Returns structured results
                     |
4. Claude      Formats results into natural language
               Responds: "You have 3 pending tasks..."
```

### Request Paths by Service

**Anvil (notes, tasks, projects):**

```
Claude --MCP/HTTP--> Anvil (:8100) --search--> QMD Daemon (:8181)
                         |
                         +--> reads/writes --> ~/Horus/data/notes/
```

**Vault (knowledge base):**

```
Claude --MCP/HTTP--> Vault MCP (:8300) --REST/HTTP--> Vault REST (:8000)
                                                          |
                                                          +--> search --> QMD Daemon (:8181)
                                                          +--> reads/writes --> ~/Horus/data/knowledge-base/
```

**Forge (workspaces, repos, plugins):**

```
Claude --MCP/HTTP--> Forge (:8200) --reads--> ~/Horus/data/registry/
                         |
                         +--> reads/writes --> ~/Horus/data/workspaces/
                         +--> reads (ro) ----> /path/to/your/repos/
```

---

## Port Map

| Service | Container Port | Default Host Port | Protocol | Exposed To |
|---------|---------------|-------------------|----------|-----------|
| Anvil | 8100 | 8100 | HTTP (MCP) | Claude clients |
| Vault REST | 8000 | 8000 | HTTP (REST) | Internal only (Docker network) |
| Vault MCP | 8300 | 8300 | HTTP (MCP) | Claude clients |
| Forge | 8200 | 8200 | HTTP (MCP) | Claude clients |
| QMD Daemon | 8181 | -- (not exposed) | HTTP | Internal only (Docker network) |

**Claude connects to three endpoints:**
- `http://localhost:8100` -- Anvil
- `http://localhost:8300` -- Vault (via MCP adapter)
- `http://localhost:8200` -- Forge

**Internal-only services (not accessible from the host by default):**
- Vault REST (`:8000`) -- the actual knowledge service; Vault MCP proxies to it
- QMD Daemon (`:8181`) -- embedding search; accessed by Anvil and Vault over the Docker network

> Host ports are configurable via `horus config set port.<service> <port>` or by setting environment variables (`ANVIL_PORT`, `VAULT_MCP_PORT`, `FORGE_PORT`) before starting the stack.

---

## Service Dependencies and Startup Order

Services start in dependency order, enforced by Docker Compose health checks:

```
Phase 1:  qmd-daemon starts
          Waits: downloads GGUF model on first boot (~1-2 GB)
          Health: curl http://localhost:8181/health
               |
Phase 2:  anvil starts          vault (REST) starts
          Depends on:            Depends on:
            qmd-daemon healthy     qmd-daemon healthy
               |                       |
Phase 3:  (anvil healthy)       vault-mcp starts
                                Depends on:
                                  vault (REST) healthy
               |                       |
Phase 4:  forge starts
          Depends on:
            anvil healthy
            vault (REST) healthy
```

**Typical startup times:**

| Scenario | Total Time |
|----------|-----------|
| First boot (model download) | 3-10 minutes |
| Cold start (models cached) | 60-90 seconds |
| Warm restart | 30-60 seconds |

---

## Data Persistence

### Host Bind Mounts

All user data is stored on the host filesystem under the configured data directory (default: `~/Horus/data/`). These are Docker bind mounts, meaning data survives container removal, image updates, and `docker compose down`.

| Host Path | Container Mount | Service | Purpose |
|-----------|----------------|---------|---------|
| `~/Horus/data/notes/` | `/data/notes` | Anvil | Notes, tasks, journals (git repo) |
| `~/Horus/data/knowledge-base/` | `/data/knowledge-repo` | Vault REST | Knowledge pages, guides, decisions (git repo) |
| `~/Horus/data/registry/` | `/data/registry` | Forge | Plugin/skill registry (git repo) |
| `~/Horus/data/workspaces/` | `/data/workspaces` | Forge | Workspace directories |
| `<host-repos-path>/` | `/data/repos` (read-only) | Forge | Your local git repositories for indexing |

### Named Docker Volumes

These are managed by Docker and store internal caches. They persist across container restarts but are removed by `docker compose down -v`.

| Volume | Mounted In | Purpose |
|--------|-----------|---------|
| `qmd-daemon-data` | QMD Daemon, Anvil, Vault | Shared GGUF model cache (~1-2 GB) and SQLite search index |
| `vault-workspace` | Vault REST | Staging area for draft knowledge pages before commit |

> **Safe to remove:** Running `docker compose down -v` removes only the named volumes. Your notes, knowledge base, registry, and workspaces live in bind mounts and are never deleted by Docker commands.

### Git Sync

Anvil, Vault, and Forge each manage a git repository. On first boot, they clone from the configured remote URL. On subsequent boots, they pull the latest changes. Background sync runs at a configurable interval (default: 300 seconds / 5 minutes).

| Service | Sync Interval Variable | Default |
|---------|----------------------|---------|
| Anvil | `ANVIL_SYNC_INTERVAL` | 300s |
| Vault | `VAULT_SYNC_INTERVAL` | 300s |
| Forge | `FORGE_SYNC_INTERVAL` | 300s |

---

## Network

All services communicate over a Docker bridge network named `horus-net`. Services discover each other by container name:

| From | To | Address Used |
|------|----|-------------|
| Anvil | QMD Daemon | `http://qmd-daemon:8181` |
| Vault REST | QMD Daemon | `http://qmd-daemon:8181` |
| Vault MCP | Vault REST | `http://vault:8000` |
| Forge | Anvil | `http://anvil:8100` |
| Forge | Vault MCP | `http://vault-mcp:8300` |

No service needs to know the host port mappings. Internal communication always uses container names and internal ports over `horus-net`.

---

## Resource Requirements

Memory limits are set per service in the Docker Compose configuration:

| Service | Memory Limit | Memory Reservation | Notes |
|---------|-------------|-------------------|-------|
| QMD Daemon | 4 GB | 512 MB | Holds GGUF embedding model in memory |
| Anvil | 512 MB | 256 MB | Node.js MCP server |
| Vault REST | 512 MB | 256 MB | FastAPI with QMD subprocess calls |
| Vault MCP | 256 MB | 64 MB | Thin Node.js proxy layer |
| Forge | 512 MB | 128 MB | Node.js MCP server + workspace operations |
| **Total** | **5.75 GB** | **1.2 GB** | |

**Recommended system requirements:**

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Disk | 5 GB free | 10 GB free |
| CPU | 2 cores | 4 cores |

The QMD daemon is the heaviest service. It loads a GGUF embedding model (~1-2 GB) into memory and keeps it warm for fast search. The first boot also requires network bandwidth to download the model.

---

## Environment Variables

Full list of environment variables that control the stack. Set these in `.env` alongside `docker-compose.yml` or export them before running `horus up`.

### Required

| Variable | Description |
|----------|-------------|
| `HORUS_DATA_PATH` | Absolute path to the data directory. Must not use `~` or `${HOME}` (Docker limitation). |
| `HOST_REPOS_PATH` | Absolute path to your git repositories on the host. Mounted read-only into Forge. |

### Optional -- Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `ANVIL_PORT` | `8100` | Host port for Anvil MCP |
| `VAULT_PORT` | `8000` | Host port for Vault REST (internal) |
| `VAULT_MCP_PORT` | `8300` | Host port for Vault MCP |
| `FORGE_PORT` | `8200` | Host port for Forge MCP |

### Optional -- Repository URLs

| Variable | Default | Description |
|----------|---------|-------------|
| `ANVIL_REPO_URL` | (empty) | Git URL for the Notes repository |
| `VAULT_KNOWLEDGE_REPO_URL` | (public default) | Git URL for the knowledge base repository |
| `FORGE_REGISTRY_REPO_URL` | (public default) | Git URL for the Forge plugin registry |
| `GITHUB_TOKEN` | (empty) | GitHub token for cloning/pulling private repos |

### Optional -- Service Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `ANVIL_SYNC_INTERVAL` | `300` | Seconds between Anvil git pulls |
| `ANVIL_DEBOUNCE_SECONDS` | `5` | Debounce interval for Anvil file watching |
| `ANVIL_QMD_COLLECTION` | `anvil` | QMD collection name for Anvil's search index |
| `VAULT_SYNC_INTERVAL` | `300` | Seconds between Vault git pulls |
| `QMD_INDEX_NAME` | `knowledge` | QMD collection name for Vault's search index |
| `LOG_LEVEL` | `info` | Vault log verbosity (`debug`, `info`, `warning`, `error`) |
