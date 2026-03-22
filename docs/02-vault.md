# Vault — Knowledge Layer

Vault is the knowledge base. It stores long-lived, structured documentation about codebases, conventions, procedures, and decisions. It has a two-tier architecture: a Python REST API for search and knowledge logic, and a thin TypeScript MCP adapter.

## Architecture

```
Claude Code / Cursor
       |
       | MCP Protocol (stdio or HTTP)
       v
+---------------------+
|  Vault MCP Adapter  |     Thin TypeScript client
|  (Node.js, :8300)   |     Translates MCP calls to HTTP
+----------+----------+
           |
           | HTTP POST (JSON)
           v
+---------------------+
|  Vault REST API     |     Python FastAPI service
|  (Python, :8000)    |
+----------+----------+
           |
   +-------+-------+
   |               |
   v               v
Layer 2         Layer 1
(Knowledge      (Search
 Logic)          Engine)
   |               |
   v               v
Git-backed      SQLite FTS5
Markdown        (or QMD adapter)
Files
```

### Two-Tier Design

1. **MCP Adapter** (`vault-mcp`, TypeScript): Stateless translation layer. Exposes 11 MCP tools, each mapping 1:1 to an HTTP endpoint on the REST API. No knowledge logic here.

2. **REST API** (`services/vault`, Python/FastAPI): All knowledge logic lives here — scope resolution, validation, suggestion, duplicate detection, search.

### Multi-Vault Support

Horus supports multiple vault instances (e.g., `personal` and `work`). All tools accept an optional `vault` parameter:

- **Read tools** (search, resolve-context, list-by-scope, check-duplicates, suggest-metadata): **Fan out** to all vaults and merge results. Pass `vault=` to restrict to one.
- **Write/routed tools** (get-page, get-related, write-page, validate-page, registry-add, schema): **Route to a specific vault** — by explicit `vault=` param, UUID registry lookup, or default vault.

## Core Concepts

### Knowledge Pages

A page is a markdown file with YAML frontmatter stored in the knowledge-base git repository:

```yaml
---
title: Deployment Guide
type: guide
mode: operational
scope:
  program: horus
  repo: anvil
tags: [deployment, ci-cd]
owner: platform-team
last-verified: "2026-03-01"
related: [guides/rollback.md]
depends-on: ["services/api.md"]
consumed-by: ["services/monitoring.md"]
applies-to: [anvil, forge]
---

# Deployment Guide

Step-by-step instructions for deploying Anvil to production...
```

### Page Types

| Type | Purpose | Example |
|------|---------|---------|
| `repo-profile` | Describes a repository — tech stack, conventions, test commands | `repos/anvil.md` |
| `guide` | How-to guide for a specific workflow | `guides/onboarding.md` |
| `procedure` | Step-by-step operational procedure | `procedures/deploy.md` |
| `concept` | Explains an architectural concept or pattern | `concepts/event-sourcing.md` |
| `keystone` | Program-level overview and architecture | `programs/horus.md` |
| `learning` | Captured learnings, post-mortems, discoveries | `learnings/caching-gotcha.md` |

### Page Modes

| Mode | Description | Typical Types |
|------|-------------|---------------|
| `reference` | Long-lived reference material | concepts, repo-profiles |
| `operational` | Active procedures and guides used during work | guides, procedures |
| `keystone` | Top-level architectural overviews | keystone |

### Scope System

Pages are scoped at two levels:

```
Program Level (e.g., program: horus)
  └── Repo Level (e.g., repo: anvil)
```

- **Program-level pages**: Apply to all repos in the program
- **Repo-level pages**: Apply to a specific repo (higher specificity)
- **`applies-to`**: Cross-references pages to multiple repos

When resolving context for a repo, Vault:
1. Finds the repo-profile page
2. Extracts the program from scope
3. Collects all operational pages at repo-level (specificity 2) and program-level (specificity 1)
4. Returns sorted by specificity (repo-level first)

### Relationships

Pages can reference each other through several fields:

| Field | Direction | Description |
|-------|-----------|-------------|
| `related` | Bidirectional | General relationship |
| `depends-on` | This page depends on... | Dependency |
| `consumed-by` | This page is consumed by... | Consumer |
| `applies-to` | This page applies to repos... | Cross-repo reference |

Relationship formats: wiki-links (`[[Page Title]]`), dict refs (`{"repo": "name"}`), or plain strings.

### Progressive Disclosure

Search results return **PageSummary** (description only). Use `get_page` to fetch **PageFull** (with body + relationships). Use `include_full: true` on `resolve_context` to get full pages in one call.

## REST API Layers

### Layer 2 — Knowledge Logic

| Module | Purpose |
|--------|---------|
| `frontmatter.py` | Parse YAML frontmatter + body into PageSummary/PageFull |
| `scope.py` | Resolve scope chain (repo -> program), collect operational pages |
| `schema.py` | Load schema + registries, validate pages |
| `mode_filter.py` | Filter pages by mode, type, scope, tags |
| `suggester.py` | Analyze content and suggest metadata (type, mode, tags, scope) |
| `dedup.py` | Detect duplicate/overlapping pages via hybrid search |
| `git_writer.py` | Create branch, write file, commit, push, open PR |
| `link_navigator.py` | Traverse relationship fields to find related pages |

### Layer 1 — Search Interface

Abstract `SearchStore` interface with implementations:

| Implementation | Description |
|----------------|-------------|
| `QMDAdapter` | Wrapper around QMD subprocess (primary) |
| `FtsSearchEngine` | SQLite FTS5 fallback |
| `FallbackSearchStore` | Try QMD first, fall back to FTS5 |

**Search capabilities:** keyword search, semantic search, hybrid search (keyword + semantic + reranking).

## MCP Tools

### knowledge_resolve_context

Primary entry point for getting context about a codebase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | yes | Repository name |
| `include_full` | boolean | no | Return full page content (default: false) |
| `vault` | string | no | Restrict to specific vault |

**Process:**
1. Find repo-profile page
2. Resolve program from scope
3. Collect all operational pages for this scope
4. Sort by specificity (repo-level first)

**Returns:** `{ entry_point, operational_pages[], scope }`

### knowledge_search

Hybrid search across knowledge base.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `scope` | object | no | `{ program?, repo? }` |
| `type` | string | no | Page type filter |
| `mode` | string | no | Page mode filter |
| `limit` | number | no | Max results (default: 10) |
| `vault` | string | no | Restrict to specific vault |

**Returns:** `{ results: PageSummary[], total }`

### knowledge_get_page

Read a full page by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Page ID (file path, e.g., `repos/anvil.md`) |
| `vault` | string | no | Target vault |

**Returns:** PageFull (frontmatter + body + relationships)

### knowledge_get_related

Follow links from a page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Page ID |
| `vault` | string | no | Target vault |

**Returns:** `{ source: PageSummary, related: PageSummary[] }`

### knowledge_list_by_scope

Browse/filter pages by scope, mode, type, tags.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | object | no | `{ program?, repo? }` |
| `type` | string | no | Page type filter |
| `mode` | string | no | Page mode filter |
| `tags` | string[] | no | Tag filter (AND logic) |
| `limit` | number | no | Max results |
| `vault` | string | no | Restrict to specific vault |

**Returns:** `{ pages: PageSummary[], total }`

### knowledge_check_duplicates

Detect overlap with existing knowledge base. **Always call before writing new pages.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Page title |
| `content` | string | yes | Page content |
| `threshold` | number | no | Similarity threshold 0-1 (default: 0.75) |
| `vault` | string | no | Check within specific vault |

**Returns:** `{ matches: DuplicateMatch[], has_conflicts }`

- Score >= threshold: novel content, safe to create
- Score < threshold: overlap exists, merge into existing page instead

### knowledge_suggest_metadata

Auto-suggest frontmatter fields from content analysis.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Page content (markdown) |
| `hints` | object | no | Pre-filled hints (e.g., `{ "scope.program": "horus" }`) |
| `vault` | string | no | Target vault for registry lookups |

**Returns:** Per-field suggestions with confidence levels (high/medium/low/none).

**Analysis includes:** type signals, mode signals, keyword extraction, registry fuzzy matching, repo mention extraction.

### knowledge_validate_page

Validate page against schema and registries.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Full markdown with YAML frontmatter |
| `vault` | string | no | Target vault for schema |

**Validation order:**
1. Type is known
2. Required fields present
3. Field constraints (length, min_items, date format)
4. Registry-backed field checks (tags, scope.program, scope.repo)
5. Mode in allowed_modes
6. Required scope fields
7. Recommended fields (warnings only)

**Returns:** `{ valid, errors[], warnings[] }` — errors include fuzzy-match suggestions for invalid values

### knowledge_get_schema

Returns full schema definition and registry contents.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vault` | string | no | Target vault (defaults to default vault) |

**Returns:** `{ version, page_types[], field_constraints[], registries: { tags, programs, repos } }`

### knowledge_write_page

Write page via git workflow (branch -> commit -> push -> PR).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path within knowledge-base |
| `content` | string | yes | Full markdown with frontmatter |
| `pr_title` | string | no | Pull request title |
| `pr_body` | string | no | Pull request description |
| `commit_message` | string | no | Git commit message |
| `vault` | string | no | Target vault |

**Returns:** PR URL + commit SHA (human review gate)

### knowledge_registry_add

Add new entry to a registry (tags, repos, programs).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `registry` | string | yes | `tags`, `repos`, or `programs` |
| `entry` | object | yes | `{ id, description?, aliases? }` |
| `vault` | string | no | Target vault |

## Write Path Pipeline

**Never skip steps.** Always follow this sequence:

```
1. knowledge_check_duplicates(title, content)
   │
   ├── Score >= threshold → Novel, proceed to create
   └── Score < threshold → Overlap, merge into existing page
   │
2. knowledge_suggest_metadata(content, hints?)
   │ Returns per-field suggestions with confidence
   │
3. knowledge_validate_page(full_page_content)
   │ Fix any errors before writing
   │
4. knowledge_write_page(path, content, pr_title?, pr_body?)
   │ Creates branch, commits, opens PR
   │
   └── Returns PR URL for human review
```

## Error Codes

| Code | HTTP | Cause |
|------|------|-------|
| `VALIDATION_FAILED` | 400 | Schema/registry validation errors |
| `PARSE_ERROR` | 400 | YAML frontmatter parsing failure |
| `PAGE_NOT_FOUND` | 404 | Page ID doesn't exist |
| `REGISTRY_NOT_FOUND` | 404 | Invalid registry name |
| `DUPLICATE_ENTRY` | 409 | Registry entry already exists |
| `SCHEMA_NOT_LOADED` | 503 | Schema not yet loaded on startup |
| `GIT_ERROR` | 500 | Git operation failure |
| `GITHUB_API_ERROR` | 500 | GitHub API call failure |

## Configuration

| Setting | Env Var | Default |
|---------|---------|---------|
| Knowledge repo path | `KNOWLEDGE_REPO_PATH` | `/data/knowledge-repo` |
| Workspace path | `WORKSPACE_PATH` | `/workspace` |
| QMD index name | `QMD_INDEX_NAME` | `knowledge` |
| Git sync interval | `SYNC_INTERVAL` | `300` (seconds) |
| REST API port | `VAULT_PORT` | `8000` |
| REST API host | `VAULT_HOST` | `0.0.0.0` |
| Log level | `VAULT_LOG_LEVEL` | `info` |
| GitHub token | `GITHUB_TOKEN` | — (required for writes) |
| GitHub repo | `GITHUB_REPO` | — (owner/repo format) |
| GitHub base branch | `GITHUB_BASE_BRANCH` | `master` |

## Knowledge-Base Directory Structure

```
knowledge-base/
├── repos/                      # Repo-profile pages
│   ├── anvil.md
│   ├── forge.md
│   └── vault.md
├── programs/                   # Keystone pages
│   └── horus.md
├── concepts/                   # Concept pages
│   └── event-sourcing.md
├── guides/                     # Guide pages
│   └── onboarding.md
├── procedures/                 # Procedure pages
│   └── deploy.md
├── learnings/                  # Learning pages
│   └── caching-gotcha.md
├── shared/                     # Cross-cutting pages
├── _schema/
│   ├── schema.yaml             # Page type definitions + field constraints
│   └── registries/
│       ├── tags.yaml           # Valid tags
│       ├── programs.yaml       # Valid programs
│       └── repos.yaml          # Valid repos
└── .git/
```
