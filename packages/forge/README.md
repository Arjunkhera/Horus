# Forge

A package manager and compiler for AI agent workspaces. Forge lets you discover, install, and manage reusable skills, agents, and plugins from registries — then compiles them into the directory structure your AI tooling expects.

Currently targets **Claude Code** (`.claude/skills/` and `.claude/agents/`), with Cursor and plugin targets planned.

## How It Works

Forge follows a familiar package-manager workflow:

1. **Initialize** a workspace with `forge init`
2. **Search** registries for skills, agents, or plugins
3. **Add** artifacts to your workspace config (`forge.yaml`)
4. **Install** to resolve dependencies and compile artifacts to disk

Registries can be local filesystem directories or remote git repos. A global config at `~/.forge/config.yaml` lets you set up registries once and use them across all your workspaces.

## Packages

Forge is a TypeScript monorepo with three packages:

| Package | Description |
|---------|-------------|
| `@forge/core` | Orchestrator, registry, resolver, compiler, adapters, and workspace management |
| `@forge/cli` | Command-line interface built with Commander |
| `@forge/mcp-server` | MCP server that exposes Forge operations as tools for LLM consumption |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+ (for workspace support)
- Git (for git-based registries)

### Installation

```bash
git clone https://github.com/arkhera/Forge.git
cd Forge
npm install
npm run build
```

### Quick Start

```bash
# Initialize a workspace
forge init my-project

# Search for available skills
forge search developer

# Add a skill
forge add skill:developer@1.0.0

# Install all artifacts
forge install

# Check what's installed
forge list --installed
```

## Registries

Forge supports three registry types:

**Filesystem** — a local directory with the registry layout:

```yaml
# forge.yaml
registries:
  - type: filesystem
    name: local
    path: ./registry
```

**Git** — a remote repository that gets shallow-cloned and cached at `~/.forge/cache/git/`:

```yaml
registries:
  - type: git
    name: team-registry
    url: https://github.com/myorg/forge-registry.git
    branch: main
    path: registry
```

**HTTP** — planned but not yet implemented.

### Registry Layout

Registries follow a standard directory structure:

```
registry/
  skills/
    my-skill/
      metadata.yaml
      SKILL.md
  agents/
    my-agent/
      metadata.yaml
      AGENT.md
```

Each artifact has a `metadata.yaml` with its id, name, version, description, tags, dependencies, and file list, plus the content files (typically a Markdown file).

### Global Configuration

Set up a registry once and have it available everywhere:

```bash
# Add a git registry globally
forge config add-registry \
  -n team-registry \
  -t git \
  -u https://github.com/myorg/forge-registry.git

# Add a local filesystem registry
forge config add-registry \
  -n local-extras \
  -t filesystem \
  -p /path/to/registry

# List global registries
forge config list

# Remove a global registry
forge config remove-registry team-registry
```

Global registries act as fallbacks — workspace-local registries take priority. If a workspace registry has the same name as a global one, the workspace version wins.

The global config lives at `~/.forge/config.yaml`.

## MCP Server

Forge ships an MCP server so AI assistants (like Claude Desktop) can search, add, and install artifacts on their own.

### Claude Desktop Setup

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "forge": {
      "command": "node",
      "args": ["/path/to/Forge/packages/mcp-server/dist/index.js"]
    }
  }
}
```

The MCP server exposes five tools: `forge_search`, `forge_add`, `forge_install`, `forge_resolve`, and `forge_list`.

## CLI Reference

| Command | Description |
|---------|-------------|
| `forge init <name>` | Initialize a new workspace |
| `forge search <query>` | Search registries for artifacts |
| `forge add <refs...>` | Add artifacts to `forge.yaml` |
| `forge install` | Resolve and compile all artifacts |
| `forge list` | List available or installed artifacts |
| `forge show <ref>` | Show detailed artifact info |
| `forge remove <refs...>` | Remove artifacts from config |
| `forge config list` | Show global registries |
| `forge config add-registry` | Add a global registry |
| `forge config remove-registry <name>` | Remove a global registry |
| `forge serve` | Start the MCP server |

Artifact refs use the format `type:id@version` (e.g., `skill:developer@1.0.0`). The type defaults to `skill` and version defaults to `*` if omitted.

## Architecture

Forge uses an adapter pattern for registry access. `FilesystemAdapter` reads from local directories, `GitAdapter` clones and caches remote repos, and `CompositeAdapter` chains multiple adapters with priority ordering and deduplication.

The install pipeline flows through four stages: **WorkspaceManager** reads config and manages file operations, **Registry** discovers and retrieves artifacts, **Resolver** walks the dependency graph, and **Compiler** emits target-specific file operations using a strategy pattern.

## Development

```bash
# Run tests (169 tests across 10 files)
npm test

# Type check
npm run lint

# Build all packages
npm run build
```

## License

MIT
