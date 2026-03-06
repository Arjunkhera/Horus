# Horus Concepts

A guide to the Horus ecosystem for new users.

---

## What is Horus?

Horus is an AI-augmented development environment that gives Claude **persistent memory** and **structured workflows**. Without Horus, every Claude session starts from scratch. With Horus, Claude can:

- Remember your projects, tasks, and decisions across sessions
- Search your documentation and codebase knowledge semantically
- Create and manage isolated development workspaces
- Follow your team's conventions by reading stored guides and procedures

Horus runs as a set of Docker services on your machine. Claude communicates with these services through MCP (Model Context Protocol), gaining access to tools for reading, writing, and searching your data.

---

## The Three Systems

Horus is made up of three core systems. Each handles a different kind of data and a different part of your workflow.

### Anvil -- Live Workspace

**What it is:** A structured notebook that Claude can read and write. Anvil stores your active work items as markdown files with typed frontmatter.

**What it stores:**

- **Projects** -- top-level containers for related work
- **Stories** -- features or initiatives within a project
- **Tasks** -- concrete to-do items with status tracking
- **Journals** -- append-only logs for daily notes, standups, or session records
- **Notes** -- freeform entries for anything else

**How it works:** Anvil uses a dynamic type system. Each note has a `type` field in its frontmatter that determines what fields are available (title, status, tags, assignee, etc.). When Claude wants to create a task, it first asks Anvil what types exist and what fields they support, then creates the note with the correct structure.

**Key tools:** `anvil_search`, `anvil_create_note`, `anvil_update_note`, `anvil_query_view`

**Example interactions:**
- "What's pending?" -- Anvil searches for open tasks
- "Create a task to fix the login bug" -- Anvil creates a typed task note
- "Show my tasks as a board" -- Anvil returns a kanban-style view grouped by status

---

### Vault -- Knowledge Base

**What it is:** A persistent knowledge base with semantic search. Vault stores long-lived documentation that Claude can reference across sessions.

**What it stores:**

- **Guides** -- how-to documents and procedures
- **Decisions** -- architectural decision records (ADRs)
- **Repo profiles** -- summaries of codebases, their conventions, and structure
- **Learnings** -- patterns, gotchas, and insights discovered during development

**How it works:** Vault stores pages as markdown files in a git repository. Each page has structured metadata (scope, tags, category). When you ask Claude a knowledge question, Vault uses semantic search powered by locally-running embedding models to find the most relevant pages. This means Vault understands meaning, not just keywords -- asking "how do we handle authentication" will find pages about auth even if they never use the exact word "authentication."

**Key tools:** `knowledge_search`, `knowledge_resolve_context`, `knowledge_write_page`, `knowledge_get_page`

**Example interactions:**
- "How does the auth module work?" -- Vault searches for relevant knowledge
- "Document the decision to use PostgreSQL" -- Vault creates a decision record
- "What are the conventions for the API repo?" -- Vault looks up the repo profile

---

### Forge -- Dev Environment Manager

**What it is:** A workspace and plugin manager that sets up isolated development environments and manages Horus extensions.

**What it manages:**

- **Workspaces** -- isolated working directories tied to a story or task, with their own git worktrees and MCP configuration
- **Repositories** -- an index of your local repos that Claude can search and reference
- **Plugins/Skills** -- extensions that teach Claude new capabilities or domain knowledge

**How it works:** When you start work on a story, Forge creates a workspace: a dedicated directory with its own git worktree, configuration files, and MCP server settings. This keeps work isolated -- you can have multiple workspaces for different features without them interfering with each other. Forge also manages a registry of skills (markdown instruction files) that get injected into Claude's context.

**Key tools:** `forge_workspace_create`, `forge_workspace_list`, `forge_repo_list`, `forge_search`, `forge_install`

**Example interactions:**
- "Set me up to work on the auth refactor" -- Forge creates a workspace
- "What repos do I have?" -- Forge lists indexed repositories
- "Install the testing skill" -- Forge adds a skill from the registry

---

## Supporting Services

### QMD -- Embedding Daemon

QMD (Query Model Daemon) is an internal service that powers semantic search across both Anvil and Vault. It:

- Runs GGUF embedding models locally on your machine (no data leaves your computer)
- Maintains a shared SQLite index that both Anvil and Vault read from
- Keeps models warm in memory so searches are fast after the initial load
- Downloads and caches the embedding model (~1-2 GB) on first boot

You never interact with QMD directly. It runs in the background and is used automatically when Anvil or Vault need to perform semantic search.

### horus-core -- Routing Intelligence

horus-core is a plugin that gets installed into Claude's configuration automatically during setup. It contains:

- **Routing rules** -- instructions that teach Claude when to use Anvil vs. Vault vs. Forge
- **Skill files** -- detailed tool references for each service

Without horus-core, Claude would not know which system to route your requests to. With it, natural language like "what's pending?" is automatically directed to Anvil, and "how does X work?" is directed to Vault.

---

## MCP (Model Context Protocol)

MCP is the protocol that connects Claude to external tools. Each Horus service runs an MCP server:

| Service | MCP Endpoint | Tools Provided |
|---------|-------------|----------------|
| Anvil | `http://localhost:8100` | 7 tools -- search, create, update, get, query, sync, list types |
| Vault | `http://localhost:8300` | 10 tools -- search, resolve context, read/write pages, check duplicates, validate |
| Forge | `http://localhost:8200` | 9 tools -- workspace CRUD, repo operations, skill/plugin management |

When Claude needs to perform an action, it calls the appropriate MCP tool. The tool call is sent as an HTTP request to the service, which processes it and returns the result. Claude then uses that result to formulate its response to you.

> **Note:** Vault has two services internally. The Vault REST API (port 8000) handles the actual data operations. The Vault MCP adapter (port 8300) translates MCP tool calls into REST API calls. Claude only connects to port 8300 -- the REST API is internal to the Docker network.

---

## How They Connect

Here is how a request flows through the Horus system:

```
You: "What's pending?"
         |
         v
   +-----------+
   |   Claude   |   Claude reads horus-core routing rules
   +-----------+   and decides this is an Anvil query
         |
         | MCP tool call: anvil_search({ query: "pending tasks" })
         v
   +-----------+         +-------------+
   |   Anvil    | -----> | QMD Daemon  |  semantic search
   |  (8100)    | <----- |   (8181)    |  over notes index
   +-----------+         +-------------+
         |
         | Returns matching notes with status, titles, tags
         v
   +-----------+
   |   Claude   |   Formats results into a natural response
   +-----------+
         |
         v
You: "You have 3 pending tasks: ..."
```

### Architecture Diagram

```
+-------------------------------------------------------------------+
|  Your Machine                                                     |
|                                                                   |
|  +-------------------+                                            |
|  | Claude Desktop /  |                                            |
|  | Claude Code /     |                                            |
|  | Cursor            |                                            |
|  +--------+----------+                                            |
|           | MCP (HTTP)                                            |
|           v                                                       |
|  +-------------------------------------------------------------------+
|  | Docker Network (horus-net)                                        |
|  |                                                                   |
|  |  +----------+    +----------+    +-----------+                    |
|  |  |  Anvil   |    |Vault MCP |    |   Forge   |                    |
|  |  |  :8100   |    |  :8300   |    |   :8200   |                    |
|  |  +----+-----+    +----+-----+    +-----+-----+                   |
|  |       |               |                |                          |
|  |       |          +----+-----+          |                          |
|  |       |          |Vault REST|          |                          |
|  |       |          |  :8000   |          |                          |
|  |       |          +----+-----+          |                          |
|  |       |               |                |                          |
|  |       +-------+-------+-------+--------+                         |
|  |               |                                                   |
|  |         +-----+------+                                            |
|  |         |QMD Daemon  |                                            |
|  |         |  :8181     |                                            |
|  |         +------------+                                            |
|  +-------------------------------------------------------------------+
|                                                                   |
|  ~/.horus/data/                                                   |
|    notes/           <-- Anvil data (git repo)                     |
|    knowledge-base/  <-- Vault data (git repo)                     |
|    registry/        <-- Forge plugin registry (git repo)          |
|    workspaces/      <-- Forge workspace directories               |
+-------------------------------------------------------------------+
```

### Data Flow Summary

| You say... | Claude routes to... | System does... |
|-----------|-------------------|---------------|
| "What's pending?" | Anvil | Searches notes index for open tasks |
| "Create a task for X" | Anvil | Creates a typed markdown note |
| "How does auth work?" | Vault | Semantic search over knowledge base |
| "Document this decision" | Vault | Creates a new knowledge page (with validation pipeline) |
| "Set me up to work on X" | Forge | Creates an isolated workspace with git worktree |
| "What repos do I have?" | Forge | Returns the indexed repository list |

---

## Key Principles

1. **Everything is local.** All data stays on your machine. Semantic search runs locally via GGUF models. No data is sent to external servers (except your prompts to Anthropic via your API key).

2. **Data is durable.** Notes, knowledge, and workspaces are stored as files on disk and backed by git repositories. Stopping or removing Docker containers does not delete your data.

3. **Sessions are persistent.** Unlike vanilla Claude, Horus gives Claude memory that survives across sessions. What you documented last week is still searchable today.

4. **Routing is automatic.** You do not need to specify which system to use. The horus-core plugin teaches Claude to route requests to the right service based on your intent.

5. **Types are dynamic.** Anvil's type system is not hardcoded. New note types and fields can be added without changing code. Claude always checks the current schema before creating notes.
