# Horus CLI Command Reference

Complete reference for every `horus` CLI command.

---

## horus setup

Initialize Horus on this machine. Run once after installing the CLI.

**Synopsis:**

```
horus setup [--api-key <key>] [--data-dir <path>] [--repos-path <path>] [--yes]
```

**Description:**

Runs an interactive wizard that detects your container runtime, prompts for configuration, pulls Docker images, starts the Horus stack, and verifies all services are healthy. Configuration is saved to `~/.horus/config.json`.

**Flags:**

| Flag | Description |
|------|-------------|
| `--api-key <key>` | Provide the Anthropic API key non-interactively. Skips the prompt. |
| `--data-dir <path>` | Set the data directory. Must be an absolute path. Default: `~/.horus/data` |
| `--repos-path <path>` | Absolute path to your local git repositories. Mounted read-only into Forge for repo indexing. |
| `--yes` | Accept all defaults without prompting. Useful for scripted installs. |

**What it does:**

1. Detects Docker or Podman and verifies the Compose plugin
2. Prompts for your Anthropic API key (stored locally)
3. Creates the data directory with subdirectories for each service
4. Checks port availability (8100, 8200, 8300)
5. Pulls the latest Horus Docker images
6. Starts all five services (QMD daemon, Anvil, Vault REST, Vault MCP, Forge)
7. Waits for each service to pass its health check

**Example:**

```
$ horus setup

Horus Setup
--------------------------------------

[1/6] Detecting container runtime...
      Found Docker 27.1.1 at /usr/local/bin/docker
      Compose plugin: v2.29.1

[2/6] Anthropic API key:
      Enter your API key (sk-ant-...): sk-ant-••••••••
      Saved to ~/.horus/config.json

[3/6] Data directory:
      Where should Horus store data? (~/.horus/data)
      Created /Users/you/.horus/data

[4/6] Port configuration:
      Anvil MCP:     8100 (default)
      Vault MCP:     8300 (default)
      Forge MCP:     8200 (default)
      All ports available.

[5/6] Pulling images...
      Pulling qmd-daemon...     done
      Pulling anvil...          done
      Pulling vault...          done
      Pulling vault-mcp...      done
      Pulling forge...          done

[6/6] Starting Horus stack...
      Waiting for QMD daemon...   healthy (12s)
      Waiting for Anvil...        healthy (8s)
      Waiting for Vault REST...   healthy (5s)
      Waiting for Vault MCP...    healthy (3s)
      Waiting for Forge...        healthy (4s)

--------------------------------------
Setup complete.
```

**Non-interactive example:**

```bash
horus setup --api-key sk-ant-abc123 --data-dir /opt/horus/data --repos-path /home/me/repos --yes
```

---

## horus up

Start the Horus stack.

**Synopsis:**

```
horus up
```

**Description:**

Starts all Docker services in the correct dependency order. If the stack is already running, this is a no-op. Services start as follows: QMD daemon first, then Anvil and Vault REST in parallel, then Vault MCP and Forge once their dependencies are healthy.

**Example:**

```
$ horus up

Starting Horus stack...
  qmd-daemon    starting...  healthy
  anvil         starting...  healthy
  vault         starting...  healthy
  vault-mcp     starting...  healthy
  forge         starting...  healthy

All services running. Startup time: 32s
```

> **First boot:** The QMD daemon downloads embedding models (~1-2 GB) on first startup. This can take several minutes. Subsequent starts reuse the cached models and complete in under a minute.

---

## horus down

Stop the Horus stack.

**Synopsis:**

```
horus down
```

**Description:**

Gracefully stops all Docker containers. All data is preserved -- notes, knowledge pages, workspaces, and the QMD model cache persist across restarts. Containers are removed but named volumes are kept.

**Example:**

```
$ horus down

Stopping Horus stack...
  forge         stopped
  vault-mcp     stopped
  vault         stopped
  anvil         stopped
  qmd-daemon    stopped

Stack stopped. Data preserved in /Users/you/.horus/data
```

---

## horus status

Show service health and versions.

**Synopsis:**

```
horus status
```

**Description:**

Queries each service's health endpoint and displays a summary table. Shows port bindings, health status, version, memory usage, and uptime.

**Example:**

```
$ horus status

Horus Stack Status
--------------------------------------

  Service        Port    Status     Version
  qmd-daemon     --      healthy    0.4.0
  anvil          8100    healthy    1.2.0
  vault-rest     8000    healthy    0.9.1
  vault-mcp      8300    healthy    0.9.1
  forge          8200    healthy    1.1.0

  Data directory: /Users/you/.horus/data
  Uptime:         2h 14m
  Memory usage:   1.8 GB / 6.0 GB limit

All services healthy.
```

**When a service is unhealthy:**

```
$ horus status

Horus Stack Status
--------------------------------------

  Service        Port    Status      Version
  qmd-daemon     --      healthy     0.4.0
  anvil          8100    healthy     1.2.0
  vault-rest     8000    unhealthy   --
  vault-mcp      8300    stopped     --
  forge          8200    healthy     1.1.0

  Issues detected:
    vault-rest: health check failing (3 consecutive failures)
    vault-mcp:  stopped (depends on vault-rest)

  Run: horus doctor       for diagnostics
  Run: docker compose logs vault   for service logs
```

---

## horus config

View or modify configuration.

**Synopsis:**

```
horus config
horus config get <key>
horus config set <key> <value>
```

**Description:**

Manages the Horus configuration stored in `~/.horus/config.json`. Running `horus config` with no arguments prints all current settings. Use `get` to read a single value or `set` to change one.

**Available keys:**

| Key | Description | Default |
|-----|-------------|---------|
| `api-key` | Anthropic API key | (set during setup) |
| `data-dir` | Absolute path to the Horus data directory | `~/.horus/data` |
| `host-repos-path` | Absolute path to your local git repositories | (set during setup) |
| `runtime` | Container runtime (`docker` or `podman`) | auto-detected |
| `port.anvil` | Host port for Anvil MCP server | `8100` |
| `port.vault-rest` | Host port for Vault REST API (internal) | `8000` |
| `port.vault-mcp` | Host port for Vault MCP adapter | `8300` |
| `port.forge` | Host port for Forge MCP server | `8200` |
| `github-token` | GitHub token for private repo access | (empty) |

**Examples:**

View all settings:

```
$ horus config

Current configuration (~/.horus/config.json):

  api-key:          sk-ant-••••••••
  data-dir:         /Users/you/.horus/data
  host-repos-path:  /Users/you/Desktop/Repositories
  runtime:          docker
  port.anvil:       8100
  port.vault-rest:  8000
  port.vault-mcp:   8300
  port.forge:       8200
  github-token:     (not set)
```

Read a single value:

```
$ horus config get port.anvil
8100
```

Change a value:

```
$ horus config set port.anvil 9100
Updated port.anvil: 8100 -> 9100

Note: Restart the stack for port changes to take effect.
  Run: horus down && horus up
```

> **Important:** If you change any MCP port, update the corresponding URL in your Claude Desktop / Claude Code / Cursor configuration, or re-run `horus connect`.

---

## horus connect (coming soon)

Auto-configure Claude Desktop, Claude Code, or Cursor for MCP integration.

**Synopsis:**

```
horus connect [--target claude-desktop|claude-code|cursor|all]
```

**Description:**

Detects installed AI clients and writes the appropriate MCP server configuration for each one. Also installs horus-core skills and routing rules for Claude Code.

| Target | What it configures |
|--------|--------------------|
| `claude-desktop` | Writes MCP server URLs to `claude_desktop_config.json` |
| `claude-code` | Installs skill files to `~/.claude/skills/` and updates `~/.claude/CLAUDE.md` with routing rules |
| `cursor` | Writes MCP configuration to Cursor's settings |
| `all` (default) | Configures all detected clients |

**Flags:**

| Flag | Description |
|------|-------------|
| `--target <client>` | Configure only the specified client. Default: `all` detected clients. |

**Example:**

```
$ horus connect

Detected clients:
  Claude Desktop    /Users/you/Library/Application Support/Claude/
  Claude Code       ~/.claude/

Configuring Claude Desktop...
  Writing MCP config to claude_desktop_config.json
  Added: anvil  -> http://localhost:8100
  Added: vault  -> http://localhost:8300
  Added: forge  -> http://localhost:8200

Configuring Claude Code...
  Installing horus-core skills to ~/.claude/skills/
    horus-anvil/SKILL.md    written
    horus-vault/SKILL.md    written
    horus-forge/SKILL.md    written
  Updating ~/.claude/CLAUDE.md with routing rules
    horus-core section upserted

--------------------------------------
Done. Restart Claude Desktop to pick up the new MCP servers.
```

**Claude Desktop config written:**

```json
{
  "mcpServers": {
    "anvil": { "url": "http://localhost:8100" },
    "vault": { "url": "http://localhost:8300" },
    "forge": { "url": "http://localhost:8200" }
  }
}
```

> **Current workaround:** Run `bash setup.sh` from the Horus repo to perform the equivalent of `horus connect`.

---

## horus update (coming soon)

Update to the latest version of all Horus services.

**Synopsis:**

```
horus update [--rollback]
```

**Description:**

Pulls the latest Docker images for all Horus services, restarts the stack, and verifies health. If the update causes issues, use `--rollback` to revert to the previously running images.

**Flags:**

| Flag | Description |
|------|-------------|
| `--rollback` | Revert to the previous image versions and restart |

**Example:**

```
$ horus update

Checking for updates...
  qmd-daemon    0.4.0 -> 0.5.0   (update available)
  anvil         1.2.0 -> 1.2.0   (up to date)
  vault         0.9.1 -> 0.10.0  (update available)
  vault-mcp     0.9.1 -> 0.10.0  (update available)
  forge         1.1.0 -> 1.1.0   (up to date)

Pulling updated images...  done
Restarting stack...        done
Health check...            all healthy

Update complete. Previous images saved for rollback.
```

---

## horus doctor (coming soon)

Diagnose common issues with the Horus installation.

**Synopsis:**

```
horus doctor
```

**Description:**

Runs a series of diagnostic checks and reports issues with suggested fixes. Checks include: container runtime availability, port conflicts, service health, disk space, configuration validity, and MCP client configuration.

**Example (all passing):**

```
$ horus doctor

Horus Doctor
--------------------------------------

  Container runtime:   Docker 27.1.1              pass
  Compose plugin:      v2.29.1                    pass
  Config file:         ~/.horus/config.json        pass
  Data directory:      /Users/you/.horus/data      pass
  Disk space:          42 GB free                  pass
  Port 8100 (Anvil):   available                   pass
  Port 8200 (Forge):   available                   pass
  Port 8300 (Vault):   available                   pass
  Docker network:      horus-net exists             pass
  Service: qmd-daemon: healthy                     pass
  Service: anvil:      healthy                     pass
  Service: vault:      healthy                     pass
  Service: vault-mcp:  healthy                     pass
  Service: forge:      healthy                     pass
  Claude Desktop MCP:  configured                  pass
  Claude Code skills:  installed                   pass

--------------------------------------
All checks passed. No issues detected.
```

**Example (with issues):**

```
$ horus doctor

Horus Doctor
--------------------------------------

  Container runtime:   Docker 27.1.1              pass
  Compose plugin:      v2.29.1                    pass
  Config file:         ~/.horus/config.json        pass
  Data directory:      /Users/you/.horus/data      pass
  Disk space:          42 GB free                  pass
  Port 8100 (Anvil):   in use by PID 12345        FAIL
  Port 8200 (Forge):   available                   pass
  Port 8300 (Vault):   available                   pass

  Issues found: 1

  [1] Port 8100 is in use by another process (PID 12345)
      Fix: Kill the process (kill 12345) or change the Anvil port:
        horus config set port.anvil 9100
        horus down && horus up
        horus connect
```

---

## horus backup (coming soon)

Backup and restore Horus data.

**Synopsis:**

```
horus backup
horus backup restore <file>
```

**Description:**

Creates a compressed archive of the Horus data directory (`~/.horus/data/`), including notes, knowledge base, registry, and workspace configurations. Use `restore` to replace the current data directory with a backup.

**Examples:**

Create a backup:

```
$ horus backup

Creating backup...
  notes/            2.1 MB
  knowledge-base/   8.4 MB
  registry/         1.2 MB
  workspaces/       340 KB

Backup saved: ~/.horus/backups/horus-backup-2026-03-06-143022.tar.gz (11.8 MB)
```

Restore from a backup:

```
$ horus backup restore ~/.horus/backups/horus-backup-2026-03-06-143022.tar.gz

Restoring from horus-backup-2026-03-06-143022.tar.gz...
  Stopping stack...           done
  Backing up current data...  saved as pre-restore-2026-03-06.tar.gz
  Extracting backup...        done
  Starting stack...           done
  Health check...             all healthy

Restore complete.
```

---

## Global Flags

These flags are available on all commands:

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for the command |
| `--version`, `-v` | Show the CLI version |
| `--verbose` | Show detailed output for debugging |
| `--quiet`, `-q` | Suppress non-essential output |

---

## Configuration File

All configuration is stored in `~/.horus/config.json`:

```json
{
  "apiKey": "sk-ant-...",
  "dataDir": "/Users/you/.horus/data",
  "hostReposPath": "/Users/you/Desktop/Repositories",
  "runtime": "docker",
  "ports": {
    "anvil": 8100,
    "vaultRest": 8000,
    "vaultMcp": 8300,
    "forge": 8200
  },
  "githubToken": ""
}
```

The config file is created by `horus setup` and can be modified with `horus config set` or by editing the file directly.
