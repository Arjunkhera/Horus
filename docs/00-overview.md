# Horus System Overview

Horus is a personal operating system for software development. It comprises three interconnected products that together provide a complete environment for managing work, knowledge, and code.

## The Three Systems

```
+------------------+     +------------------+     +------------------+
|      ANVIL       |     |      VAULT       |     |      FORGE       |
|   Data Layer     |     |  Knowledge Layer |     | Execution Layer  |
|                  |     |                  |     |                  |
| Notes, tasks,    |     | Guides, repo     |     | Workspaces,      |
| journals,        |     | profiles,        |     | sessions, repos, |
| stories, plans   |     | procedures,      |     | skills, plugins  |
|                  |     | concepts, ADRs   |     |                  |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         |    MCP Protocol        |    MCP Protocol        |    MCP Protocol
         |                        |                        |
+--------v------------------------v------------------------v---------+
|                         Claude Code / Cursor                       |
|                      (AI-assisted development)                     |
+--------------------------------------------------------------------+
```

### Anvil — Live State

Anvil manages all structured data: tasks, notes, stories, journals, projects, and more. It uses a dynamic type system where note types are defined as YAML files, and notes are stored as markdown files with YAML frontmatter. An embedded SQLite database provides full-text search and relationship tracking.

**Key characteristics:**
- Dynamic type system with inheritance
- Markdown files with YAML frontmatter
- SQLite FTS5 for search
- Wiki-link based relationships
- Git-backed sync (pull/push)
- Append-only journal behavior

### Vault — Knowledge Base

Vault stores long-lived, structured documentation about codebases, conventions, procedures, and decisions. It has a two-tier architecture: a Python REST API (FastAPI) for search and knowledge logic, and a thin TypeScript MCP adapter that translates MCP calls to HTTP requests.

**Key characteristics:**
- Page types: repo-profile, guide, procedure, concept, keystone, learning
- Scope resolution: program-level and repo-level pages
- Write pipeline: check duplicates -> suggest metadata -> validate -> write (via PR)
- Hybrid search (keyword + semantic + reranking)
- Git-backed with PR-based writes
- Multi-vault support (fan-out reads, routed writes)

### Forge — Execution Environment

Forge manages the developer's execution environment: workspaces for context, sessions for coding, a repository index for discovery, and an artifact system for skills/plugins/agents.

**Key characteristics:**
- Context-only workspaces (MCP configs, skills, env vars — no repo cloning)
- Code sessions via `forge_develop` (git worktrees for isolated coding)
- Repository index with language/framework detection
- Versioned artifact system (skills, agents, plugins, workspace-configs)
- Multi-target compilation (Claude Code, Cursor)

## How They Connect

```
                    Forge reads repo profiles
              +----------------------------------+
              |                                  |
              v                                  |
+----------+  workflow config  +----------+      |
|  FORGE   |<-----------------+  VAULT   |      |
+----+-----+                  +----------+      |
     |                             ^            |
     | forge_develop               |            |
     | creates session             | write-path |
     | linked to workItem          | (via PR)   |
     |                             |            |
     v                             |            |
+----------+                       |            |
|  ANVIL   +-----------------------+            |
+----------+  knowledge about work items        |
     ^                                          |
     |         session cleanup checks           |
     +------------------------------------------+
              Anvil note status
```

1. **Forge -> Vault**: Forge reads Vault repo-profiles to resolve git workflow configuration (push strategy, PR targets, branch patterns).

2. **Forge -> Anvil**: `forge_develop` sessions link to Anvil work items (notes/stories). Session cleanup checks Anvil note status to determine which sessions are stale.

3. **Vault -> Anvil** (indirect): Knowledge pages document conventions for work tracked in Anvil. The scope system links knowledge to repos and programs.

4. **Agent orchestration**: All three systems are exposed as MCP servers. Claude Code or Cursor connects to all three simultaneously via a workspace's MCP configuration.

## Architecture

### Deployment Model

```
Docker Compose Stack
+---------------------------------------------------+
|                                                   |
|  +-------------+  +-------------+  +----------+  |
|  | Anvil MCP   |  | Vault MCP   |  | Forge    |  |
|  | (Node.js)   |  | (Node.js)   |  | (Node.js)|  |
|  | :8100       |  | :8300       |  | :8200    |  |
|  +------+------+  +------+------+  +-----+----+  |
|         |                |                |       |
|         |         +------v------+         |       |
|         |         | Vault REST  |         |       |
|         |         | (Python)    |         |       |
|         |         | :8000       |         |       |
|         |         +-------------+         |       |
|         |                                 |       |
+---------------------------------------------------+
          |                                 |
          v                                 v
  ~/Horus/horus-data/              ~/Horus/horus-data/
  notes/ (git repo)                registry/ (git repo)
  knowledge-base/ (git repo)       workspaces/
                                   sessions/
                                   config/
```

### Data Directory Layout

All runtime data lives in `~/Horus/horus-data/`:

```
horus-data/
├── notes/                  # Anvil vault (cloned git repo)
│   ├── .anvil/
│   │   ├── types/          # Note type definitions (YAML)
│   │   ├── plugins/        # Plugin type directories
│   │   └── .local/         # Local state (never synced)
│   │       ├── index.db    # SQLite FTS index
│   │       └── state.json  # Runtime state
│   ├── tasks/              # Note files by type
│   ├── stories/
│   └── .git/
│
├── knowledge-base/         # Vault content (cloned git repo)
│   ├── repos/              # Repo-profile pages
│   ├── programs/           # Keystone pages
│   ├── concepts/           # Concept pages
│   ├── guides/             # Guide pages
│   ├── procedures/         # Procedure pages
│   ├── learnings/          # Learning pages
│   ├── _schema/            # Schema + registries
│   │   ├── schema.yaml
│   │   └── registries/
│   │       ├── tags.yaml
│   │       ├── programs.yaml
│   │       └── repos.yaml
│   └── .git/
│
├── registry/               # Forge artifact registry (cloned git repo)
│   ├── skills/
│   ├── agents/
│   ├── plugins/
│   ├── workspace-configs/
│   └── .git/
│
├── workspaces/             # Active Forge workspaces
│   └── sdlc-default-ws-abc12345/
│       ├── forge.yaml
│       ├── forge.lock
│       ├── CLAUDE.md
│       ├── .cursorrules
│       ├── workspace.env
│       ├── .claude/
│       │   ├── settings.json
│       │   ├── settings.local.json
│       │   ├── mcp-servers/
│       │   └── scripts/
│       └── .cursor/
│           ├── mcp.json
│           └── rules/
│
├── sessions/               # Forge code sessions (git worktrees)
│   └── my-feature-repo/
│       └── (git worktree)
│
├── config/
│   └── forge.yaml          # Global Forge configuration
│
└── repos/                  # Managed repo pool (tier 2)
```

## Monorepo Structure

The source code is a pnpm monorepo:

```
Horus/
├── packages/
│   ├── anvil/              # Anvil MCP server (TypeScript/Node)
│   ├── vault-mcp/          # Vault MCP thin client (TypeScript/Node)
│   ├── forge/              # Forge (nested pnpm workspace)
│   │   └── packages/
│   │       ├── core/       # Core business logic
│   │       ├── mcp-server/ # MCP server adapter
│   │       └── cli/        # CLI interface
│   ├── cli/                # `horus` CLI tool
│   ├── ui-client/          # React frontend
│   ├── ui-server/          # Express backend
│   ├── search/             # Typesense integration
│   └── shared/             # Shared types
├── services/
│   └── vault/              # Vault REST API (Python/FastAPI)
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Anvil MCP | TypeScript, Node.js, SQLite (WASM), MCP SDK |
| Vault MCP | TypeScript, Node.js, MCP SDK (thin HTTP client) |
| Vault REST | Python, FastAPI, SQLite FTS5 |
| Forge Core | TypeScript, Node.js |
| Forge MCP | TypeScript, Node.js, MCP SDK |
| Frontend | React 18, Vite |
| Backend | Express, Anthropic AI SDK |
| Storage | Markdown + YAML frontmatter, Git repos |
| Search | SQLite FTS5 (Anvil), Hybrid search (Vault) |
| Deployment | Docker Compose |
| Package Manager | pnpm (monorepo) |
