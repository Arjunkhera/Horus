---
name: horus-anvil
description: >
  Anvil V2 MCP reference. Use when creating, reading, updating, searching, or
  querying entities in Anvil. Covers the V2 entity API, dynamic type system,
  graph layer (edges, relationships, hierarchy), PKM bootstrap, views,
  dashboards, sync, and cross-system search. Trigger phrases: "create a task",
  "add a note", "search anvil", "link these", "show my dashboard", "what's
  related", "sync vault", "set up personal tasks".
---

# Horus Anvil V2 — MCP Tool Reference

Anvil is the **local state plane**. All structured data (tasks, notes, journals,
stories, projects, areas, etc.) lives here. Anvil runs locally as the `anvil`
container (port 8100) inside the 4-container client stack; notes and agent
execution are local and git-backed. Vault and the Forge registry are remote —
Anvil is deliberately kept offline-capable.

V2 introduces the entity API, graph layer, views/dashboards, PKM automation,
and cross-system search.

<!-- PATCH: overview -->

## Bundled Guides — Read Before Acting (Grounding)

The Horus CLI ships user-facing getting-started guides. When working with a user who is new to Horus, or when the context is unclear, **read the relevant guide before calling MCP tools**. The guides are ground-truth for user-facing behavior; if they disagree with this reference, the guide wins and this file needs an update.

Relevant guides for Anvil work:

- **`first-note`** — Anvil's dynamic type system, the `anvil_list_types` → `anvil_create_entity` flow, PATCH-semantics updates, append-only journal behavior, and where notes live on disk.
- **`core-concepts`** — the Anvil / Vault / Forge split and where Anvil fits in the larger picture.

To read a guide directly (works regardless of how Horus was installed):

```bash
horus guide first-note           # print the body
horus guide first-note --path    # print the absolute path so you can Read it
horus help <natural query>       # query-based retrieval if you don't know the slug
horus guide --path               # print the bundled guides directory root
```

## Tool Summary (28 tools)

### V2 Entity CRUD (preferred)

| Tool | Purpose |
|------|---------|
| `anvil_create_entity` | Create any entity (V2, preferred over anvil_create_note) |
| `anvil_update_entity` | Update any entity (V2, preferred over anvil_update_note) |
| `anvil_delete_entity` | Delete any entity (V2, preferred over anvil_delete_note) |

### Read

| Tool | Purpose |
|------|---------|
| `anvil_get_note` | Retrieve a single entity by UUID |
| `anvil_search` | Full-text + semantic + filtered search |
| `anvil_query_view` | Structured query with list/table/board rendering |
| `anvil_list_types` | List all available entity types and field definitions |

### Graph

| Tool | Purpose |
|------|---------|
| `anvil_create_edge` | Create a directed edge between two entities |
| `anvil_delete_edge` | Remove an edge |
| `anvil_get_edges` | List edges for an entity (in, out, or both) |
| `anvil_get_related` | Get links and backlinks (forward + inverse) |
| `anvil_get_children` | Get immediate children via parent_of edges |
| `anvil_get_subtree` | Get all descendants recursively |

### Type Management

| Tool | Purpose |
|------|---------|
| `anvil_create_type` | Define a new entity type |
| `anvil_update_type` | Modify an existing entity type |

### Views and Dashboards

| Tool | Purpose |
|------|---------|
| `anvil_execute_view` | Run a named saved view |
| `anvil_execute_dashboard` | Run a named saved dashboard |

### PKM / Automation

| Tool | Purpose |
|------|---------|
| `anvil_setup_personal_tasks` | Bootstrap personal task system (areas, views, dashboard) |
| `anvil_recurrence_sweep` | Process recurring tasks, create due instances |

### Sync

| Tool | Purpose |
|------|---------|
| `anvil_sync_pull` | Pull latest from remote |
| `anvil_sync_push` | Commit and push changes |

### Cross-System Search

| Tool | Purpose |
|------|---------|
| `horus_search` | Search across Anvil, Vault, and other Horus systems |

### Legacy V1 (document for reference — prefer V2)

| Tool | Purpose |
|------|---------|
| `anvil_create_note` | **Legacy.** Use `anvil_create_entity` instead |
| `anvil_update_note` | **Legacy.** Use `anvil_update_entity` instead |
| `anvil_delete_note` | **Legacy.** Use `anvil_delete_entity` instead |

<!-- PATCH: tool-summary -->

## V2 Entity API

### Creating Entities

`anvil_create_entity` requires `type` both as a top-level parameter and inside
`fields`. Always call `anvil_list_types` first to confirm field names and
enum values.

```json
{
  "type": "task",
  "title": "Implement auth flow",
  "fields": {
    "type": "task",
    "status": "open",
    "priority": "P2-medium",
    "tags": ["backend"]
  }
}
```

### Updating Entities

`anvil_update_entity` uses PATCH semantics — only include fields to change.

```json
{
  "noteId": "uuid-here",
  "fields": { "status": "in-progress" }
}
```

Journals are **append-only** — `content` is appended, never replaced.

### Deleting Entities

```json
{ "noteId": "uuid-here" }
```

<!-- PATCH: entity-api -->

## Type System

**Always call `anvil_list_types` before creating entities.** Status enums,
field names, and available types are vault-owner-defined and vary per
installation. Never guess them.

Each type has: `name`, `parent` (usually `_core`), `fields`, `template`.

### Field Types

| Type | Description |
|------|-------------|
| `string` | Free text |
| `enum` | One of fixed values (type-specific — check `anvil_list_types`) |
| `boolean` | True/false |
| `number` | Numeric |
| `date` | ISO date string |
| `datetime` | ISO datetime |
| `reference` | UUID or `[[Title]]` / `[[uuid]]` wiki-link |
| `tags` | Array of strings (AND semantics in search) |
| `array` | Array of values |
| `object` | Nested object |
| `markdown` | Markdown body |
| `url` | URL string |

References accept wiki-link format: `[[Note Title]]` or `[[uuid]]`.

<!-- PATCH: type-system -->

## Search

### `anvil_search` — Full-text + semantic + filtered

Best for: finding entities by keyword, type, status, tags.

- Supports FTS (full-text) and semantic (embedding) search
- **Omit `query` for unfiltered results** — passing `"*"` is invalid and errors
- `tags` use AND semantics (entity must have ALL specified tags)
- `anvil_search` takes **flat top-level params**, not a nested `filters` object

```json
{
  "query": "authentication bug",
  "type": "task",
  "status": "in-progress",
  "tags": ["backend"],
  "limit": 20
}
```

### `anvil_query_view` — Structured views

Best for: dashboards, kanban boards, sorted lists, tabular reports.

- `view` is required (`list`, `table`, or `board`)
- Use `filters` (not `filter`) and `orderBy` (not `sort`)
- Board view requires `groupBy`

```json
{
  "view": "board",
  "filters": { "type": "task" },
  "groupBy": "status"
}
```

### `horus_search` — Cross-system

Searches Anvil, Vault, and other Horus systems in one call. Use when the
user's query isn't clearly scoped to Anvil alone.

<!-- PATCH: search -->

## Graph Layer

Entities are connected via typed, directed edges. Use the graph to model
hierarchy, dependencies, and semantic links.

### Edge Intents

| Intent | Direction | Meaning | Example |
|--------|-----------|---------|---------|
| `parent_of` | parent → child | Hierarchical ownership | project → story, area → task |
| `belongs_to` | child → parent | Inverse of parent_of; use when creating from child side | task → project |
| `blocks` | A → B | A must complete before B | story → story, task → task |
| `references` | A → B | A cites or links to B | design note → story, journal → design doc |
| `mentions` | A → B | A loosely mentions B | journal → person, task → meeting note |

**`parent_of` vs `belongs_to`:** Use `parent_of` when creating from the
parent. Use `belongs_to` when creating from the child (equivalent semantics,
inverse direction).

### Hierarchy Tools

- **`anvil_get_children`** — immediate children only (one level). Use when
  rendering a project's direct stories or a task list.
- **`anvil_get_subtree`** — all descendants recursively. Use when you need the
  full hierarchy (e.g., exporting a project with all nested work).

### Creating / Removing Edges

```json
// anvil_create_edge
{
  "fromId": "project-uuid",
  "toId": "story-uuid",
  "intent": "parent_of"
}

// anvil_delete_edge
{
  "fromId": "project-uuid",
  "toId": "story-uuid",
  "intent": "parent_of"
}
```

### Querying Edges

```json
// anvil_get_edges — list edges on an entity
{
  "noteId": "uuid-here",
  "direction": "out",   // "in" | "out" | "both"
  "intent": "blocks"    // optional filter
}
```

<!-- PATCH: graph-layer -->

## Relationship Suggestions

After creating an entity, proactively suggest one relationship if it makes
sense for the type:

| Entity type | Suggestion |
|-------------|-----------|
| `story` | "Should this belong to a project? Any design notes to link?" |
| `task` | "Does this belong to an area or project?" |
| `design_note` | "Does this reference a story or service?" |
| `journal` | "Does this mention a task or person?" |
| `project` / `area` | No suggestion (root nodes) |

**Fatigue rules:** offer at most one suggestion per entity type per session.
After two declines for the same type, mute suggestions for that type.

<!-- PATCH: relationship-suggestions -->

## PKM System

### Bootstrap Guard

Before using personal task features, confirm `anvil_setup_personal_tasks` has
run. Call it if the default areas, views, or dashboard are missing. It is
idempotent — safe to call more than once.

`anvil_setup_personal_tasks` creates:
- Default **areas** (e.g., Work, Personal, Admin)
- Default **views** (e.g., Today, This Week, Inbox)
- Default **dashboard**

### Recurrence Sweep

`anvil_recurrence_sweep` processes recurring task definitions and creates
due instances. Run on session start or when the user asks about today's tasks.

<!-- PATCH: pkm-system -->

## Views and Dashboards

- **`anvil_execute_view`** — run a named saved view (e.g., `"today"`,
  `"inbox"`). Returns rendered results per the view's config.
- **`anvil_execute_dashboard`** — run a named saved dashboard. Returns multiple
  panels in one response.

Use these over manual `anvil_query_view` calls when named views exist.

<!-- PATCH: views-dashboards -->

## Sync

```json
// anvil_sync_pull — pull latest
{ "remote": "origin", "branch": "main" }

// anvil_sync_push — commit and push
{ "message": "feat: add Q2 planning stories" }
```

<!-- PATCH: sync -->

## Error Recovery

| Error | Cause | Fix |
|-------|-------|-----|
| `TYPE_NOT_FOUND` | Used a type that doesn't exist | Call `anvil_list_types`; use a valid type |
| `VALIDATION_ERROR` | Invalid field name or value | Check field definitions from `anvil_list_types` |
| `NOTE_NOT_FOUND` | Invalid noteId | Verify UUID via `anvil_search` |
| `APPEND_ONLY` | Tried to replace journal body | Use append semantics |
| `IMMUTABLE_FIELD` | Tried to change a read-only field | Remove that field from payload |
| `EDGE_EXISTS` | Duplicate edge | Check `anvil_get_edges` before creating |
| `EDGE_NOT_FOUND` | Tried to delete a non-existent edge | Verify with `anvil_get_edges` first |

<!-- PATCH: error-recovery -->

## Known Gotchas

| # | Mistake | Correct behaviour |
|---|---------|------------------|
| 1 | Guessing status values | **Always call `anvil_list_types` first.** Enums are type-specific. |
| 2 | `query: "*"` for unfiltered search | **Omit `query` entirely.** FTS5 rejects bare `*`. |
| 3 | Passing nested `filters` to `anvil_search` | `anvil_search` takes flat top-level params. Only `anvil_query_view` uses `filters` object. |
| 4 | Using `format`, `filter`, or `sort` with `anvil_query_view` | Correct names: `view` (required), `filters`, `orderBy`. |
| 5 | Using V1 `anvil_create_note` / `anvil_update_note` | Prefer V2 `anvil_create_entity` / `anvil_update_entity`. |
| 6 | `anvil_create_entity` missing `type` in fields | `type` is required **both** as top-level param and inside `fields`. |
| 7 | `[[Title]]` refs vs UUID | References accept both `[[Note Title]]` and `[[uuid]]` wiki-link format. |

<!-- PATCH: known-gotchas -->
