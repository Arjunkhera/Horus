---
name: horus-vault
description: >
  Vault MCP reference. Use when you need to read or write knowledge pages —
  repo profiles, guides, procedures, concepts, and learnings. Covers the
  remote vault architecture (vault-router + reader pool + writer), flat-UUID
  storage, 17 tools (including 6 graph tools), read path, write path pipeline,
  page types, schema management, and wiki-link auto-edges.
---

# Horus Vault — MCP Tool Reference

<!-- PATCH: identity -->

Vault is the **remote knowledge base**. It stores long-lived, structured documentation about codebases, conventions, procedures, and decisions. Vault is fully remote — accessed through the JWT gateway at `https://horus.arjunkhera.io/api/v1/vault`.

## Architecture

Vault runs as a read-scaled cluster behind a `vault-router`:

- **vault-router** — fronts all reads and writes; routes reads to the reader pool, writes to the stateful writer.
- **vault-reader** (x2–3, scaled) — stateless, horizontally scaled read replicas.
- **vault-writer** (x1, stateful) — handles all writes; owns the git-backed store.

**Storage format:** pages live at `pages/<uuid>.md` with **bare-UUID ids** (not path-based ids like `shared/repos/horus.md`). Full-body indexing, wiki-link auto-edges, and typed inverse-labelled edges.

**As of 2026-06-01:** the remote vault has been freshly provisioned. The knowledge-base migration from the previous local instance is pending — reads may return empty results until migration completes. The architecture, tools, and write path are fully operational.

## Bundled Guides — Read Before Acting (Grounding)

The Horus CLI ships user-facing getting-started guides. When working with a user who is new to Horus, or when the context is unclear, **read the relevant guide before calling MCP tools**. Bundled guides are authoritative for user-facing concepts; if they disagree with this reference, the guide wins and this file needs an update.

Relevant guide for Vault work:

- **`core-concepts`** — the three-systems mental model (Anvil / Vault / Forge), where Vault fits, how `vault-router` routes reads and writes, and how Vault relates to the full Horus stack.

```bash
horus guide core-concepts        # print the body
horus guide core-concepts --path # print the absolute path so you can Read it
horus help <natural query>       # query-based retrieval if you don't know the slug
horus guide --path               # print the bundled guides directory root
```

## What Belongs in Vault

Vault stores **only** the following content:

- Repo-generated documentation (repo profiles, guides, procedures, concepts, learnings)
- Content added directly by the user

**What does NOT belong in Vault:**

- Design docs, ADRs, working notes, and scratch content — these stay in Anvil
- Do NOT write in-flight Anvil content to Vault
- Promotion from Anvil to Vault is a future feature — it is not available yet

## Tools

<!-- PATCH: tools-table -->

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `knowledge_resolve_context` | Get all applicable pages for a repo | `repo` (required), `include_full` (default: false) |
| `knowledge_search` | Hybrid search (keyword + semantic + reranking) | `query` (required), `scope` ({program, repo}), `type`, `mode`, `limit` |
| `knowledge_get_page` | Read a page by ID (bare UUID or legacy path) | `id` (e.g., `"3f2a1b4c-..."` or legacy `"repos/anvil.md"`) |
| `knowledge_get_related` | Follow links from a page | `id` (source page) |
| `knowledge_list_by_scope` | Browse pages for a program/repo | `scope` ({program, repo}), `type`, `mode`, `tags`, `limit` |
| `knowledge_validate_page` | Validate page against schema | `content` (full markdown with YAML frontmatter) |
| `knowledge_suggest_metadata` | Auto-suggest frontmatter fields | `content` (markdown), `hints` (optional partial knowledge) |
| `knowledge_check_duplicates` | Check overlap with existing pages | `title`, `content`, `threshold` (0-1, default: 0.75) |
| `knowledge_get_schema` | Get full schema + registry contents | (none) |
| `knowledge_registry_add` | Add tag/repo/program to a registry | `registry` (tags/repos/programs), `entry` ({id, description?, aliases?}) |
| `knowledge_write_page` | Write page, commit to branch, open PR | `path` (required), `content` (required), `pr_title`, `pr_body`, `commit_message` |
| `knowledge_create_edge` | Create a typed edge between two pages | `from_id`, `to_id`, `type`, `metadata?` |
| `knowledge_delete_edge` | Delete an edge between two pages | `from_id`, `to_id`, `type` |
| `knowledge_get_edges` | Get all edges for a page | `id`, `direction?` (in/out/both) |
| `knowledge_traverse_graph` | Walk the graph from a starting page | `id`, `depth?`, `edge_types?` |
| `knowledge_export_graph` | Export the full graph as JSON | (none) |
| `knowledge_import_graph` | Import a graph from JSON | `data` (graph JSON) |

## Page IDs

Pages are identified by **bare UUIDs** (e.g., `"3f2a1b4c-89d2-4e11-b7a3-0c1234567890"`). Legacy path-style IDs like `"shared/repos/horus.md"` may still be accepted for backward compatibility, but new pages are assigned UUIDs at write time. Always use the UUID returned by `knowledge_write_page` or `knowledge_search` when referencing existing pages.

Wiki-link syntax (`[[Page Title]]`) in page content automatically creates graph edges — no manual `knowledge_create_edge` call needed for inline references.

## Read Path

<!-- PATCH: read-path -->

Follow this order when answering knowledge questions:

### 1. Repo-scoped questions ("how does X work in repo Y?")
```
knowledge_resolve_context(repo) → get summaries
  → knowledge_get_page(id) → read full page if needed
```

### 2. General questions ("what's the convention for...?")
```
knowledge_search(query) → find relevant pages
  → knowledge_get_page(id) → read full content
```

### 3. Browsing ("show me all guides for program X")
```
knowledge_list_by_scope(scope, type?) → list pages
  → knowledge_get_page(id) → read specific pages
```

### 4. Relationship exploration
```
knowledge_get_related(id) → follow links (related, depends-on, consumed-by, applies-to)
```

> **Empty results note:** if reads return nothing, the knowledge-base migration may not yet be complete. Inform the user rather than assuming no relevant knowledge exists.

## Page Types

<!-- PATCH: page-types -->

| Type | Purpose | Example |
|------|---------|---------|
| `repo-profile` | Describes a repository — tech stack, conventions, test commands | `repos/anvil.md` |
| `concept` | Explains an architectural concept or pattern | `concepts/event-sourcing.md` |
| `guide` | How-to guide for a specific workflow | `guides/onboarding.md` |
| `procedure` | Step-by-step operational procedure | `procedures/deploy.md` |
| `keystone` | Program-level overview and architecture | `programs/horus.md` |
| `learning` | Captured learnings, post-mortems, discoveries | `learnings/caching-gotcha.md` |

## Page Modes

<!-- PATCH: page-modes -->

| Mode | Description |
|------|-------------|
| `reference` | Long-lived reference material (concepts, repo profiles) |
| `operational` | Active procedures and guides used during work |
| `keystone` | Top-level architectural overviews |

## Write Path Pipeline

<!-- PATCH: write-path -->

**Never skip steps.** Always follow this sequence:

### 1. Check for duplicates
```
knowledge_check_duplicates(title, content, threshold?)
```
- Score >= threshold → novel content, safe to create new page
- Score < threshold → overlap exists, merge into existing page instead

### 2. Suggest metadata
```
knowledge_suggest_metadata(content, hints?)
```
Returns per-field suggestions with confidence. Use to build frontmatter.

### 3. Validate
```
knowledge_validate_page(content)
```
- Pass full markdown with YAML frontmatter
- Returns structured errors with fuzzy-match suggestions for invalid values
- Fix any errors before writing

### 4. Write
```
knowledge_write_page(path, content, pr_title?, pr_body?, commit_message?)
```
- Routes through the `vault-writer` (the stateful, single-writer instance)
- Creates a new branch, commits the page, and opens a GitHub PR
- Does NOT write directly to the vault — the page is not live until the PR is merged
- **Always surface the PR URL to the user after calling this tool**
- The user must merge the PR for the page to go live

## Graph Tools

<!-- PATCH: graph-tools -->

Use graph tools to build and traverse the knowledge graph connecting Vault pages. Wiki-links in page content (`[[Title]]`) auto-create edges — use explicit edge tools for typed relationships not expressible as inline links.

### Edge Types

| Type | Meaning |
|------|---------|
| `PART_OF` | This page is a component or sub-section of another page |
| `DEPENDS_ON` | This page describes something that depends on another |
| `SENDS_TO` | This page describes a system that sends data/events to another |
| `DOCS` | This page documents the entity described by another page |
| `RELATED` | General semantic relationship between two pages |

### Creating and Managing Edges
```
knowledge_create_edge(from_id, to_id, type, metadata?)
knowledge_delete_edge(from_id, to_id, type)
knowledge_get_edges(id, direction?)     → direction: "in" | "out" | "both"
```

### Traversal
```
knowledge_traverse_graph(id, depth?, edge_types?)
```
Walks the graph from a starting page. Use `depth` to limit traversal distance and `edge_types` to filter by relationship type.

### Import / Export
```
knowledge_export_graph()         → full graph as JSON
knowledge_import_graph(data)     → restore or seed a graph from JSON
```

## Schema and Registries

<!-- PATCH: schema -->

### Get schema + registries
```
knowledge_get_schema()
```
Returns all page types, valid field values, and registry contents (tags, repos, programs).

### Add to a registry
If validation rejects a value that should exist:
```
knowledge_registry_add(registry: "tags"|"repos"|"programs", entry: {id, description?, aliases?})
```

## Common Patterns

<!-- PATCH: common-patterns -->

**Finding repo conventions before coding:**
```
knowledge_resolve_context(repo: "horus", include_full: true)
```

**Creating a new learning page after discovering something:**
```
1. knowledge_check_duplicates(title, content)
2. knowledge_suggest_metadata(content)
3. knowledge_validate_page(full_page)
4. knowledge_write_page(path, full_page)
   → surface the returned PR URL to the user
```

**Understanding a program's architecture:**
```
knowledge_search(query: "architecture", scope: {program: "horus"}, type: "keystone")
```

**Exploring graph relationships for a repo:**
```
knowledge_get_edges(id: "<uuid-of-anvil-repo-profile>", direction: "out")
knowledge_traverse_graph(id: "<uuid>", depth: 2, edge_types: ["DEPENDS_ON", "SENDS_TO"])
```

## MCP-over-HTTP Signal

The `/api/v1/vault` endpoint is MCP-over-HTTP (JSON-RPC, not REST). A plain `GET` returns `406 "must accept text/event-stream"` — this is expected and confirms the endpoint is live.
