# Anvil — Data Layer

Anvil is the live state system. All structured data — tasks, notes, stories, journals, projects — lives here as markdown files with YAML frontmatter, indexed by an embedded SQLite database.

## Architecture

```
Claude Code / Cursor
       |
       | MCP Protocol (stdio or HTTP)
       v
+------------------+
|   Anvil MCP      |
|   Server         |
|   (Node.js)      |
+--------+---------+
         |
    +----+----+----+----+----+
    |         |         |    |
    v         v         v    v
  Tools    Storage   Index  Registry
  (8 MCP   (File     (SQLite (Type
  tools)    I/O)      FTS5)  system)
    |         |         |    |
    +----+----+----+----+----+
         |
         v
  ~/Horus/horus-data/notes/
  (Git-backed markdown files)
```

## Core Concepts

### Notes

The fundamental unit of data. A note is a markdown file with YAML frontmatter:

```yaml
---
noteId: 550e8400-e29b-41d4-a716-446655440000
type: task
title: Fix authentication middleware
created: 2026-03-22T10:00:00Z
modified: 2026-03-22T14:30:00Z
tags: [backend, auth, urgent]
related: [[API Gateway Design]]
status: in-progress
priority: P1-high
due: 2026-03-25
---

## Context
The auth middleware is failing for JWT tokens with...
```

**Key properties:**
- `noteId`: UUID, auto-generated, immutable
- `type`: References a type definition
- `title`: 1-300 characters
- `created` / `modified`: ISO timestamps, auto-managed
- `tags`: String array, no duplicates
- `related`: Wiki-link references to other notes
- `scope`: Optional object with `context` (personal/work), `team`, `service`
- `fields`: Type-specific fields (status, priority, due, etc.)
- `body`: Markdown content after frontmatter

### Type System

Types are defined as YAML files in `.anvil/types/`. The system supports single inheritance (max 3 levels deep). Every type implicitly extends `_core`.

```
_core (implicit base)
  ├── note (generic)
  ├── task (actionable work)
  │   └── story (SDLC item)
  ├── journal (append-only log)
  ├── project (container)
  ├── person (contact)
  ├── service (external service)
  └── meeting (meeting record)
```

**Type definition format** (`.anvil/types/task.yaml`):

```yaml
id: task
name: Task
description: An actionable work item
icon: checkbox
extends: _core
fields:
  status:
    type: enum
    values: [open, in-progress, blocked, done, archived, cancelled]
    required: true
    default: open
  priority:
    type: enum
    values: [P0-critical, P1-high, P2-medium, P3-low]
    required: false
    default: P2-medium
  due:
    type: date
    required: false
  effort:
    type: number
    min: 1
    max: 21
    integer: true
  assignee:
    type: reference
    ref_type: person
  project:
    type: reference
    ref_type: project
behaviors:
  append_only: false
template:
  frontmatter:
    status: open
    tags: []
  body: |
    ## Context

    ## Acceptance Criteria

    ## Notes
```

### Field Types

| Type | Description | Constraints |
|------|-------------|-------------|
| `string` | Free text | `min_length`, `max_length`, `pattern` |
| `text` | Long text | `min_length`, `max_length` |
| `url` | URL string | — |
| `enum` | Fixed choice | `values[]` (required) |
| `date` | ISO date | — |
| `datetime` | ISO datetime | — |
| `number` | Numeric | `min`, `max`, `integer` |
| `boolean` | True/false | — |
| `tags` | String array | `no_duplicates` |
| `reference` | Link to note | `ref_type` (target type) |
| `reference_list` | Multiple links | — |
| `object` | Nested fields | Sub-field definitions |

### Field Behaviors

| Behavior | Description |
|----------|-------------|
| `required` | Must be set on creation |
| `immutable` | Cannot change after creation (`noteId`, `created` are always immutable) |
| `auto` | Auto-populate: `uuid` (generate UUID) or `now` (current timestamp) |
| `default` | Default value if not provided |

## Storage Layer

### File Storage

- **Location**: `~/Horus/horus-data/notes/`
- **Organization**: Flat (`slug.md`) or by-type (`type/slug.md`)
- **Slugification**: `"My Cool Task"` -> `my-cool-task.md` (collision: `-1`, `-2`, etc.)
- **Atomic writes**: Write to `.tmp` file, then rename
- **Ignore patterns**: `.anvil/.local`, `.git`, `node_modules`, temp files

### SQLite Index

Anvil maintains a SQLite database at `.anvil/.local/index.db` for search and relationship queries. The database is rebuilt from the markdown files on startup.

```
+------------------+     +------------------+     +------------------+
|     notes        |     |   note_tags      |     | relationships    |
+------------------+     +------------------+     +------------------+
| note_id (PK)     |<--->| note_id (FK)     |     | source_id (FK)   |
| type (FK->types) |     | tag              |     | target_id (FK?)  |
| title            |     +------------------+     | target_title     |
| file_path (UQ)   |                              | relation_type    |
| created          |     +------------------+     +------------------+
| modified         |     |   notes_fts      |
| status           |     +------------------+     +------------------+
| priority         |     | title            |     |     types        |
| due              |     | description      |     +------------------+
| effort           |     | body_text        |     | type_id (PK)     |
| body_text        |     | (FTS5 virtual)   |     | name             |
| scope_*          |     +------------------+     | schema_json      |
+------------------+                              +------------------+
```

**Key indexing behaviors:**
- Upsert is transactional (notes + tags + relationships + FTS in one transaction)
- Relationships extracted from: `related` field wiki-links, body wiki-links, typed reference fields
- Forward references supported: `target_id` can be NULL if target doesn't exist yet; resolved when target is created
- Full rebuild: clears all tables and re-indexes every markdown file

### Search

**FTS5 full-text search** with BM25 ranking:
- Searches across `title`, `description`, `body_text`
- Query sanitization: strips dangerous FTS operators, joins multi-word with OR
- Combined search mode: FTS candidates -> structured filter -> recency boost (7-day half-life)

### Relationships

Directional links between notes:

```
Note A ---[related]---> Note B
Note A ---[mentions]---> Note C  (from wiki-links in body)
Note A ---[assignee]---> Person D  (from typed reference fields)
```

- **Forward**: Links this note makes (wiki-links + explicit `related` + typed fields)
- **Reverse**: Links pointing to this note (backlinks)
- Unresolved forward references are kept (target_id = NULL) and resolved when the target note is created

## MCP Tools

### anvil_create_note

Creates a new note with type validation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | yes | Type ID (from `anvil_list_types`) |
| `title` | string | yes | Note title (1-300 chars) |
| `fields` | object | no | Type-specific field values |
| `content` | string | no | Markdown body (overrides template) |
| `use_template` | boolean | no | Apply type's body template (default: true) |

**Process:**
1. Validate type exists
2. Generate UUID + timestamps
3. Merge frontmatter (template defaults + caller fields)
4. Validate against type schema (strict mode)
5. Generate file path (slug with collision detection)
6. Write to filesystem (atomic)
7. Index in SQLite

**Returns:** `{ noteId, filePath, title, type }`

### anvil_get_note

Retrieves a note by ID with relationships.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `noteId` | string | yes | Note UUID |

**Returns:** Full note + forward relationships + reverse relationships

### anvil_update_note

PATCH update — only send fields you want to change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `noteId` | string | yes | Note UUID |
| `fields` | object | no | Fields to update (partial) |
| `content` | string | no | New body content |

**Behaviors:**
- Omitted fields are preserved
- `modified` timestamp always updated
- Journals (append_only types): `content` is appended, not replaced
- Immutable fields (`noteId`, `created`, `type`) cannot be changed
- Validates merged result against type schema

### anvil_search

Free-text search with structured filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | no | Free-text search query |
| `type` | string | no | Filter by type |
| `status` | string | no | Filter by status |
| `priority` | string | no | Filter by priority |
| `tags` | string[] | no | Filter by tags (AND logic) |
| `due` | string | no | Filter by due date |
| `assignee` | string | no | Filter by assignee reference |
| `project` | string | no | Filter by project reference |
| `scope` | object | no | Filter by scope |
| `limit` | number | no | Max results (default: 20) |
| `offset` | number | no | Pagination offset |

**Important:** Parameters are flat top-level fields, not nested in a `filters` object. To get unfiltered results, omit `query` entirely (do not pass `"*"`).

**Returns:** `{ results[], total, limit, offset }` where each result has: noteId, type, title, status, priority, due, tags, modified, score, snippet

### anvil_query_view

Structured query with rendered output.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `view` | string | yes | `list`, `table`, or `board` |
| `filters` | object | no | `{ type, status, priority, tags, ... }` |
| `orderBy` | object | no | `{ field, direction }` |
| `columns` | string[] | no | Table columns to include |
| `groupBy` | string | no | Field to group by (required for board view) |
| `limit` | number | no | Max results |
| `offset` | number | no | Pagination offset |

**View types:**
- **list**: Simple array of items with title, status, priority, tags
- **table**: Column-based display (auto-detects columns by type if not specified)
- **board**: Kanban-style grouping by enum field value (requires `groupBy`)

### anvil_list_types

Returns all available note types with full schema. No parameters.

**Always call this before creating notes.** Never guess types or field names.

### anvil_get_related

Returns forward and reverse relationships grouped by relation type.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `noteId` | string | yes | Note UUID |

**Returns:** `{ noteId, title, type, forward: { [relationType]: [...] }, reverse: { [relationType]: [...] } }`

### anvil_sync_pull

Pull latest changes from remote git repo.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `remote` | string | no | Remote name (default: "origin") |
| `branch` | string | no | Branch to pull |

**Returns:** `{ status: ok|no_changes|conflict, filesChanged?, conflicts[] }`

### anvil_sync_push

Stage, commit, and push changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | yes | Commit message |

**Selective staging:** Only stages `.md` files and `.anvil/types/*.yaml`. Never stages `.anvil/.local/` (local state).

**Returns:** `{ status: ok|no_changes|push_failed, filesCommitted?, commitHash? }`

## Error Codes

| Code | Cause | Fix |
|------|-------|-----|
| `TYPE_NOT_FOUND` | Invalid type ID | Call `anvil_list_types` for valid types |
| `VALIDATION_ERROR` | Invalid field name or value | Check type's field definitions |
| `NOT_FOUND` | Invalid noteId | Search for the note first |
| `IMMUTABLE_FIELD` | Tried to change read-only field | Remove field from update |
| `APPEND_ONLY` | Tried to replace journal body | Content is appended for journals |
| `DUPLICATE_ID` | UUID collision | Auto-retry with new UUID |
| `CONFLICT` | Merge conflict on sync | Resolve conflict markers manually |
| `SYNC_ERROR` | Git operation failed | Check remote connectivity |
| `NO_GIT_REPO` | Vault not a git repo | Initialize with `git init` |

## Configuration

**Server config** (CLI args > env vars > `~/.anvil/server.yaml` > defaults):

| Setting | Env Var | Default |
|---------|---------|---------|
| `vault_path` | `ANVIL_VAULT_PATH` | — (required) |
| `transport` | — | `stdio` |
| `port` | — | `8100` |
| `host` | — | `0.0.0.0` |
| `log_level` | — | `info` |
| `additional_type_dirs` | — | — |

## Vault Directory Structure

```
notes/                          # The Anvil vault
├── .anvil/
│   ├── types/                  # Type definitions (YAML)
│   │   ├── _core.yaml
│   │   ├── task.yaml
│   │   ├── story.yaml
│   │   ├── journal.yaml
│   │   └── ...
│   ├── plugins/                # Plugin type directories
│   ├── config.yaml             # Vault-specific config
│   └── .local/                 # Local state (NEVER synced via git)
│       ├── index.db            # SQLite FTS5 index
│       └── state.json          # Runtime state
├── tasks/                      # Notes organized by type
│   ├── fix-auth-middleware.md
│   └── update-api-docs.md
├── stories/
│   └── user-authentication.md
├── journals/
│   └── daily-log.md
└── .git/                       # Git repository for sync
```
