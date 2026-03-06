# Horus Quickstart

Get Horus running and connected to Claude in under five minutes.

---

## Prerequisites

- **Docker >= 24** (or Podman >= 4 with Docker Compose compatibility)
- **Node.js >= 18**
- **Claude Desktop**, **Claude Code**, or **Cursor** installed (with your Anthropic API key already configured)

---

## Install

```bash
npm i -g @arkhera30/cli
```

Verify the installation:

```
$ horus --version
@arkhera30/cli 0.1.0
```

---

## Setup

```bash
horus setup
```

The setup wizard walks you through each step interactively:

```
$ horus setup

Horus Setup
--------------------------------------

[1/5] Detecting container runtime...
      Found Docker 27.1.1 at /usr/local/bin/docker
      Compose plugin: v2.29.1

[2/5] Data directory:
      Where should Horus store data? (~/.horus/data)
      Created /Users/you/.horus/data

[3/5] Port configuration:
      Anvil MCP:     8100 (default)
      Vault MCP:     8300 (default)
      Forge MCP:     8200 (default)
      All ports available.

[4/5] Pulling images...
      Pulling qmd-daemon...     done
      Pulling anvil...          done
      Pulling vault...          done
      Pulling vault-mcp...      done
      Pulling forge...          done

[5/5] Starting Horus stack...
      Waiting for QMD daemon...   healthy (12s)
      Waiting for Anvil...        healthy (8s)
      Waiting for Vault REST...   healthy (5s)
      Waiting for Vault MCP...    healthy (3s)
      Waiting for Forge...        healthy (4s)

--------------------------------------
Setup complete.

  Run: horus status      to check service health
  Run: horus connect     to configure Claude Desktop / Code / Cursor
```

**What happened at each step:**

1. **Runtime detection** -- Horus found Docker (or Podman) and verified the Compose plugin is available.
2. **Data directory** -- Created `~/.horus/data/` with subdirectories for notes, knowledge-base, registry, and workspaces.
3. **Port configuration** -- Checked that the default ports (8100, 8200, 8300) are available on your machine.
4. **Image pull** -- Downloaded the five Docker images that make up the Horus stack.
5. **Stack start + health check** -- Started all containers and waited for each service to report healthy.

> **First run note:** The QMD daemon downloads a GGUF embedding model (~1-2 GB) on first boot. This can take several minutes depending on your connection. Subsequent starts reuse the cached model and are much faster.

---

## Verify

```bash
horus status
```

Expected output when everything is healthy:

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
  Uptime:         3m 42s
  Memory usage:   1.8 GB / 6.0 GB limit

All services healthy.
```

If any service shows `unhealthy` or `stopped`, check the logs:

```bash
horus status          # identify the failing service
docker compose logs anvil   # replace with the service name
```

---

## Connect Claude

```bash
horus connect
```

This auto-configures MCP integration for your AI client:

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
  Updating ~/.claude/CLAUDE.md with routing rules

--------------------------------------
Done. Restart Claude Desktop to pick up the new MCP servers.
```

**What this does:**

- For **Claude Desktop**: writes the MCP server URLs into `claude_desktop_config.json` so Claude can call Anvil, Vault, and Forge.
- For **Claude Code**: installs skill files to `~/.claude/skills/` and injects routing intelligence into `~/.claude/CLAUDE.md`.
- For **Cursor**: writes the equivalent MCP configuration into Cursor's settings.

After running `horus connect`, **fully quit and relaunch** your AI client so it picks up the new MCP servers.

---

## Your First Session

Open Claude and try these prompts to verify each service is working:

**Anvil** (notes, tasks, projects):

> "What's pending?"

Horus routes this to Anvil, which searches your notes for open tasks and returns them.

**Anvil** (creating structured notes):

> "Create a project called My App"

Anvil creates a new project note with the name "My App" and returns the created record.

**Vault** (knowledge base):

> "How does the auth module work?"

Horus routes this to Vault, which runs a semantic search over your knowledge base and returns relevant documentation.

**Forge** (workspaces):

> "List my workspaces"

Forge returns all active development workspaces (empty on first run -- that is expected).

---

## Next Steps

| Command | Description |
|---------|-------------|
| `horus config` | View or change settings (ports, data directory, runtime) |
| `horus update` | Pull the latest service images and restart |
| `horus doctor` | Diagnose common issues (port conflicts, missing config, unhealthy services) |
| `horus down` | Stop the stack gracefully (all data is preserved) |
| `horus backup` | Create a snapshot of your Horus data |

For a deeper understanding of how Horus works, see:

- [Concepts Guide](concepts.md) -- what Anvil, Vault, and Forge do and how they connect
- [Command Reference](commands.md) -- every CLI command with flags and examples
- [Architecture Overview](architecture.md) -- service diagram, ports, data flow, and resource usage
