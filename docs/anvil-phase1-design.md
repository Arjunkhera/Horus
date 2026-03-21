# Anvil Phase 1 — Full Design Plan

## Context

Anvil is the data layer of the Anvil · Forge · Vault system — a personal notes and task management system where **everything is a markdown file with YAML frontmatter**. Phase 1 delivers Anvil as a standalone system with no desktop app. Consumers are MCP clients (Claude Desktop, Cursor, CLI tools, and eventually Forge agents).

The user has an existing Obsidian vault (~2700 files) that will eventually migrate into Anvil. The repo lives at `/Users/arkhera/Desktop/Repositories/Anvil`.

**Key principle:** The filesystem is the source of truth. SQLite index and vector store are derived artifacts that can always be rebuilt from the files.

---

## 1. Type Registry & Templates (Tana-inspired)

### Core Concept

Every note has a **type**. Each type is defined by a **template** — a schema that declares what fields exist, what values are valid, and what defaults apply. This is Anvil's equivalent of Tana's supertag system.

Templates live as YAML files in a `.anvil/types/` directory at the notes root. They are themselves version-controlled and queryable.

### Single Inheritance

Types support **single inheritance**. A child type inherits all fields from its parent and can add its own. This avoids field duplication across similar types.

```yaml
# .anvil/types/bug.yaml
id: bug
name: Bug Report
extends: task                     # Inherits all task fields (status, priority, due, etc.)
description: "A defect to be fixed"

fields:
  severity:                       # Bug-specific field (added on top of task fields)
    type: enum
    values: [blocker, critical, major, minor, cosmetic]
    required: true

  reproduction_steps:
    type: text
    required: false

  affected_version:
    type: string
    required: false
```

Inheritance rules:
- A type can extend exactly one parent via `extends: <parent_type_id>`
- Child inherits all parent fields; child fields override parent fields of the same name
- Chain depth: max 3 levels (core → parent → child) to keep it simple
- The `_core` type is always the implicit root — even types without `extends` inherit core fields

### Template Definition Format

```yaml
# .anvil/types/task.yaml
id: task
name: Task
description: "An actionable work item with status tracking"
icon: "checkbox"

# Fields this type adds (on top of core fields every note has)
fields:
  status:
    type: enum
    values: [open, in-progress, blocked, done, archived, cancelled]
    default: open
    required: true

  priority:
    type: enum
    values: [P0-critical, P1-high, P2-medium, P3-low]
    default: P2-medium
    required: false

  due:
    type: date
    required: false

  effort:
    type: number
    min: 1
    max: 21
    required: false

  assignee:
    type: reference
    ref_type: person    # Must link to a note of type "person"
    required: false

  project:
    type: reference
    ref_type: project
    required: false

# Template for new notes of this type (default frontmatter + body)
# Applied when use_template=true (caller chooses)
template:
  frontmatter:
    status: open
    priority: P2-medium
    tags: []
  body: |
    ## Context

    ## Acceptance Criteria

    - [ ]

    ## Notes
```

### Field Types & Validation Rules

| Field Type | Validation | Example |
|-----------|-----------|---------|
| `string` | min/max length, pattern (regex) | `title` (required, max 200 chars) |
| `enum` | value must be in `values` list | `status` must be one of [open, in-progress, ...] |
| `date` | valid ISO date, optional min/max | `due` must be a valid date |
| `datetime` | valid ISO datetime | `created`, `modified` |
| `number` | min/max, integer vs float | `effort` between 1-21 |
| `boolean` | true/false only | `pinned`, `archived` |
| `tags` | array of strings, **no duplicates**, optional `allowed_values` | `tags: [work, urgent]` |
| `reference` | wiki-link to a note, optionally constrained to a `ref_type` | `assignee` must link to a `person` note |
| `reference_list` | array of references, no duplicates | `related: [...]` |
| `text` | free-form string (for description, etc.) | `description` |
| `url` | valid URL format | `source_url` |

### Validation Behavior

- **On create/update via MCP tools:** Validation runs automatically. **Strict rejection** — invalid values return a structured error with the field name, expected values, and the value that was rejected. The write does not proceed.
- **Enum validation is strict:** If `status: "banana"` is passed for a task, the tool returns an error: `"Invalid value 'banana' for field 'status'. Allowed: [open, in-progress, blocked, done, archived, cancelled]"`. To add a new status, the user must update the type definition YAML first.
- **On index rebuild (scanning existing files):** Validation runs in "warn" mode — logs issues but still indexes the note. This allows gracefully handling legacy/migrated content that predates the type schema.
- **Duplicate detection (tags):** Tags array is deduplicated automatically on write. If a user passes `["work", "work", "urgent"]`, it becomes `["work", "urgent"]`.
- **Reference validation:** If `assignee: "[[Nonexistent Person]]"` is set, and no note of type `person` matches, warn but allow (the person note may not exist yet — forward references are valid).

### Type-Level Behaviors

Beyond field validation, types can declare **behavioral constraints** that MCP tools enforce:

| Behavior | Effect | Used By |
|----------|--------|---------|
| `append_only: true` | `anvil_update_note` only allows appending to the body — never replacing or editing existing content. Frontmatter fields can still be updated normally. | `journal` |

These are declared at the top level of the type YAML (alongside `id`, `name`, `fields`).

### Template Application on Create

When `anvil_create_note` is called, the caller chooses whether to apply the type's body template:

- `anvil_create_note({ type: "task", title: "Fix bug", use_template: true })` → Frontmatter defaults populated AND body template inserted (e.g., ## Context, ## Acceptance Criteria sections)
- `anvil_create_note({ type: "task", title: "Fix bug", use_template: false })` → Frontmatter defaults populated, body is empty (or whatever the caller provides)
- `anvil_create_note({ type: "task", title: "Fix bug" })` → Default: `use_template: true`
- Frontmatter defaults (from the template's `template.frontmatter`) are **always applied** regardless of `use_template`. The flag only controls the body template.

### Core Fields (Every Note Has These)

These are defined in a special `_core.yaml` template that all types inherit:

```yaml
# .anvil/types/_core.yaml
id: _core
name: Core Fields
description: "Fields present on every note regardless of type"

fields:
  noteId:
    type: string
    required: true
    immutable: true       # Cannot be changed after creation
    auto: uuid            # Auto-generated on create

  type:
    type: enum
    values: []            # Populated dynamically from registered types
    required: true

  title:
    type: string
    required: true
    min_length: 1
    max_length: 300

  created:
    type: datetime
    required: true
    auto: now             # Auto-set on creation
    immutable: true

  modified:
    type: datetime
    required: true
    auto: now             # Auto-updated on every save

  tags:
    type: tags
    required: false
    no_duplicates: true

  related:
    type: reference_list
    required: false
    no_duplicates: true

  scope:
    type: object
    required: false
    fields:
      context:
        type: enum
        values: [personal, work]
      team:
        type: string
      service:
        type: string
```

### Built-in Type Templates (Shipped with Anvil)

| Type | Key Fields | Description |
|------|-----------|-------------|
| `note` | (core only) | Generic note, no extra fields |
| `task` | status, priority, due, effort, assignee, project | Actionable work item |
| `project` | status, priority, goal, stories | Container for related work |
| `story` | status, priority, acceptance_criteria, story_points, project | SDLC work item |
| `person` | email, team, role | Contact / team member |
| `service` | owner, repo, dependencies | Software service |
| `meeting` | date, attendees, agenda, action_items | Meeting note |
| `journal` | append_only, (core + tags) | Append-only chronological record — thinking logs, decision journals, session diaries. Entries are timestamped and never edited. |

Users can create custom types by adding new YAML files to `.anvil/types/`.

### Type Registry in SQLite

The index stores a `types` table so validation can happen without reading YAML files on every operation:

```sql
CREATE TABLE types (
  type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,     -- Full field definitions as JSON
  template_json TEXT,            -- Default frontmatter + body template
  updated_at TEXT NOT NULL
);
```

On startup, Anvil reads `.anvil/types/*.yaml`, validates them, and loads into the `types` table. Field validation uses this cached schema.

---

## 2. Data Model & Note Schema

### Note Identity

- **ID:** UUID v4 stored in frontmatter as `noteId`. Generated on creation, immutable forever.
- **File naming:** Human-readable, user-controlled. The noteId is the canonical identity — files can be renamed/moved freely.
- **Why UUID over slug:** Slugs change when titles change. Content hashes change when content changes. UUIDs are stable through all transformations.

### Relationship Model

Anvil has three distinct ways notes can reference each other. Each serves a different purpose and is stored/queried differently.

#### 1. Typed References (Frontmatter Fields)

These are **structured, schema-enforced** links defined by the type registry. A field with `type: reference` or `type: reference_list` creates a typed relationship that is constrained to a specific note type.

**Example — Task with typed references:**

```yaml
---
noteId: "a1b2c3d4-..."
type: task
title: "Implement user authentication"
status: in-progress
assignee: "[[Arjun Khera]]"       # reference field → must point to a person note
project: "[[anvil]]"          # reference field → must point to a project note
---
```

The type definition for `task` declares these constraints:

```yaml
# .anvil/types/task.yaml (excerpt)
fields:
  assignee:
    type: reference
    ref_type: person        # Only notes of type "person" are valid targets
  project:
    type: reference
    ref_type: project       # Only notes of type "project" are valid targets
```

**What happens in the index:** When this task is indexed, the relationships table gets two entries:

| source_id | target_id | target_title | relation_type |
|-----------|-----------|-------------|---------------|
| a1b2c3d4-... | f5e6d7c8-... | Arjun Khera | assignee |
| a1b2c3d4-... | b9a8c7d6-... | anvil | project |

**Validation:** On create/update via MCP tools, if `assignee: "[[Nonexistent Person]]"` is set and no `person`-type note matches, the system **warns but allows** the write. The target note may not exist yet (forward references are valid — you might create the person note later). The `target_id` is set to NULL and `target_title` stores the unresolved text. When the target note is eventually created, a background reconciliation pass resolves the reference.

**Querying typed references:** These are the most powerful relationships for querying because they're structured. You can ask things like "all tasks assigned to Arjun" or "all stories in project anvil" and get precise results via index lookups.

#### 2. Explicit Related Links (Frontmatter `related`)

The `related` field is a **general-purpose reference list** available on every note (defined in `_core.yaml`). Unlike typed references, `related` is not constrained to any specific note type — any note can link to any other note.

**Example — A meeting note linking to related items:**

```yaml
---
noteId: "m1n2o3p4-..."
type: meeting
title: "Sprint Planning — Feb 24"
date: 2026-02-24
attendees: ["[[Arjun Khera]]", "[[Sarah Chen]]"]
related:
  - "[[Implement user authentication]]"    # a task
  - "[[anvil]]"                       # a project
  - "[[Auth Provider Comparison]]"         # a plain note
---
```

**What happens in the index:** Each entry in `related` becomes a row in the relationships table with `relation_type: "related"`:

| source_id | target_id | target_title | relation_type |
|-----------|-----------|-------------|---------------|
| m1n2o3p4-... | a1b2c3d4-... | Implement user authentication | related |
| m1n2o3p4-... | b9a8c7d6-... | anvil | related |
| m1n2o3p4-... | x7y8z9a0-... | Auth Provider Comparison | related |

**When to use `related` vs typed references:** Use `related` for ad-hoc connections that don't fit a schema field. A meeting might reference tasks, projects, and research notes — `related` handles all of those without needing dedicated fields for each. Typed references (`assignee`, `project`) are for structured, queryable relationships that the type system enforces.

#### 3. Body Wiki-Links (Inline Mentions)

These are `[[wiki-links]]` that appear **in the markdown body** of a note, not in frontmatter. They represent casual, contextual mentions — similar to how you'd mention a colleague or project in running text.

**Example — A journal entry with body wiki-links:**

```markdown
---
noteId: "j5k6l7m8-..."
type: journal
title: "Dev Journal"
---

## 2026-02-23 — Auth research

Spent the morning looking into OAuth providers for [[anvil]].
[[Arjun Khera]] suggested we use [[Auth0]] since [[Document Service]]
already has an integration. Need to check with [[Sarah Chen]] about
the security requirements from the [[Q1 Security Audit]] findings.

Related task: [[Implement user authentication]]
```

**What happens during indexing:** The indexer scans the body for `[[...]]` patterns and creates relationship entries with `relation_type: "mentions"`:

| source_id | target_id | target_title | relation_type |
|-----------|-----------|-------------|---------------|
| j5k6l7m8-... | b9a8c7d6-... | anvil | mentions |
| j5k6l7m8-... | f5e6d7c8-... | Arjun Khera | mentions |
| j5k6l7m8-... | NULL | Auth0 | mentions |
| j5k6l7m8-... | NULL | Document Service | mentions |
| j5k6l7m8-... | NULL | Sarah Chen | mentions |
| j5k6l7m8-... | NULL | Q1 Security Audit | mentions |
| j5k6l7m8-... | a1b2c3d4-... | Implement user authentication | mentions |

Notice that some targets resolve to existing notes (where `target_id` is populated) and others don't yet exist (`target_id` is NULL, but `target_title` is preserved). As new notes are created, these forward references are resolved.

**Key difference from frontmatter references:** Body wiki-links are discovered by parsing markdown, not by reading structured YAML fields. They're less precise (no type constraint, no validation) but more natural — you just type `[[something]]` in your writing and Anvil picks it up.

#### Bidirectional Resolution

All three relationship types are stored **bidirectionally** in the index. When note A references note B, you can query in both directions:

- **Forward:** "What does this note link to?" → `SELECT * FROM relationships WHERE source_id = A`
- **Reverse:** "What links to this note?" → `SELECT * FROM relationships WHERE target_id = B`

**Example — Querying `anvil_get_related` for a person note:**

If you call `anvil_get_related({ noteId: "f5e6d7c8-..." })` for Arjun Khera, you get back:

```json
{
  "noteId": "f5e6d7c8-...",
  "title": "Arjun Khera",
  "forward": [],
  "reverse": [
    { "noteId": "a1b2c3d4-...", "title": "Implement user authentication", "relation": "assignee" },
    { "noteId": "m1n2o3p4-...", "title": "Sprint Planning — Feb 24", "relation": "related" },
    { "noteId": "j5k6l7m8-...", "title": "Dev Journal", "relation": "mentions" }
  ]
}
```

This tells you: Arjun is assigned to one task, is referenced in a meeting's `related` list, and is mentioned in a journal entry. The `relation` field tells you _how_ the link was made, which is important context — being an `assignee` is very different from being casually `mentioned`.

#### Relationship Type Summary

| Mechanism | Where it lives | Validated? | Constrained to type? | Relation type in index |
|-----------|---------------|-----------|---------------------|----------------------|
| Typed reference | Frontmatter field (e.g., `assignee`) | Yes — warns if target missing | Yes — `ref_type` enforced | Field name (e.g., `"assignee"`, `"project"`) |
| Explicit related | Frontmatter `related` array | Resolved if possible | No — any note | `"related"` |
| Body wiki-link | Markdown body `[[...]]` | Resolved if possible | No — any note | `"mentions"` |

#### Forward References and Reconciliation

A key design choice: **references to non-existent notes are always allowed.** You should be able to write `[[Future Project]]` before that project note exists. The reference is stored with `target_id: NULL` and `target_title: "Future Project"`. When a note titled "Future Project" is later created, the file watcher triggers re-indexing, and a reconciliation pass resolves all dangling references that match the new note's title.

Reconciliation runs:
- On note creation (check if any NULL-target references match the new title)
- On full index rebuild
- Not on every write (would be too expensive)

#### Deduplication

References are deduplicated per (source, target_title, relation_type) triple. If a body mentions `[[Arjun Khera]]` five times, it produces one relationship row, not five. The `related` frontmatter array is also deduplicated automatically on write (same as tags).

### Handling Existing Obsidian Conventions

- `[[PE Name]]` → Mapped to `type: person` notes. During migration, person notes are created and references updated.
- `[[SV Name]]` → Mapped to `type: service` notes. Same migration approach.
- Dataview inline fields (e.g., `field:: value`) → Parsed and migrated to frontmatter during import.

---

## 3. File Storage & Organization

### Key Principle: Code and Data are Fully Decoupled

The Anvil MCP server (the code) and the notes vault (the data) are **completely separate**. Just like Obsidian is installed independently of any vault, Anvil is a server that's pointed at a directory.

- **Anvil repo** (`/Users/arkhera/Desktop/Repositories/Anvil`) — Contains only the MCP server source code. No user data.
- **Notes vault** (user-chosen path, e.g., `~/Documents/Notes/`, `~/Obsidian/MyVault/`, anywhere) — Contains the user's markdown files, type definitions, and vault config. This is its own Git repo for sync.

On first run, `anvil init` or a setup prompt asks: **"Where is your notes vault?"** — the user points it at an existing directory or creates a new one. This path is stored in the server's config.

### Deployment Model

**Phase 1: stdio (MCP client spawns the process on demand)**

The MCP client (Cursor, Claude Desktop, CLI) starts Anvil as a child process and communicates over stdin/stdout. There is no long-running background service. When the client closes, the process dies. SQLite index, file watcher, and FTS all live inside this process. The index persists on disk (`.anvil/.local/index.db`), so subsequent startups are fast — only changed files need re-indexing.

```
┌──────────────────────────────┐     ┌───────────────────────────────────┐
│  MCP Client                  │     │  Notes Vault (user's folder)      │
│  (Cursor / Claude Desktop)   │     │  ~/Documents/Notes/               │
│                              │     │                                   │
│  Spawns Anvil via stdio ─────│────▶│  ├── .anvil/                      │
│  Process lives while client  │     │  │   ├── config.yaml              │
│  is open, dies on close      │     │  │   └── types/                   │
│                              │     │  │       ├── _core.yaml           │
│                              │     │  │       ├── task.yaml            │
│                              │     │  │       └── ...                  │
│                              │     │  ├── .anvil/.local/               │
│                              │     │  │   ├── index.db                 │
│                              │     │  │   └── state.json               │
│                              │     │  ├── projects/                    │
│                              │     │  ├── tasks/                       │
│                              │     │  ├── people/                      │
│                              │     │  └── (any user-organized dirs)    │
└──────────────────────────────┘     └───────────────────────────────────┘
```

**What this means for Phase 1:**

- **Git sync:** Manual only — user triggers `anvil_sync_pull` / `anvil_sync_push` during an active session. No background auto-sync.
- **File watcher:** Runs while the session is active. On startup, catches up on changes since last session by diffing file mtimes against the index.
- **Index rebuild:** Full rebuild takes ~2-3 seconds for 2700 files. Incremental updates are near-instant. Index persists between sessions.
- **No embeddings:** Vector search is deferred. FTS5 handles all search in Phase 1.

This evolves into a persistent background service in Phase 3 (see §13).

**Vault structure:**

```
~/Documents/Notes/              # User-chosen path (its own Git repo)
├── .anvil/                     # Anvil vault config & type registry
│   ├── config.yaml             # Vault settings (git remote, sync interval, etc.)
│   ├── types/                  # Type templates (version-controlled with notes)
│   │   ├── _core.yaml
│   │   ├── task.yaml
│   │   ├── project.yaml
│   │   ├── story.yaml
│   │   ├── person.yaml
│   │   ├── service.yaml
│   │   ├── meeting.yaml
│   │   └── journal.yaml
│   └── .local/                 # Derived artifacts (gitignored)
│       ├── index.db            # SQLite frontmatter index + FTS
│       └── state.json          # File watcher state
├── (user-organized notes)      # Any directory structure the user wants
└── .gitignore                  # Ignores .anvil/.local/
```

- **`.anvil/types/`** travels with the vault (Git-synced). Type definitions are part of the data, not the server.
- **`.anvil/.local/`** is gitignored — derived index rebuilt on any machine.
- **`.anvil/config.yaml`** stores vault-specific settings (not server connection details — those live on the server side).
- **Hierarchical:** Users organize notes into any directory structure. Folders are organizational aids — the query/search system is metadata-driven.

---

## 4. SQLite Frontmatter Index

### Schema

```sql
-- Type registry (cached from .anvil/types/*.yaml)
CREATE TABLE types (
  type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  template_json TEXT,
  updated_at TEXT NOT NULL
);

-- Core notes table
CREATE TABLE notes (
  note_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT UNIQUE NOT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  archived INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  scope_context TEXT,
  scope_team TEXT,
  scope_service TEXT,

  -- Task/story fields (nullable, present when type warrants)
  status TEXT,
  priority TEXT,
  due TEXT,
  effort INTEGER,

  -- For FTS content
  body_text TEXT,

  FOREIGN KEY (type) REFERENCES types(type_id)
);

-- Full-text search
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, description, body_text,
  content=notes, content_rowid=rowid
);

-- Tags (normalized, enforces no duplicates per note)
CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag),
  FOREIGN KEY (note_id) REFERENCES notes(note_id)
);

-- Relationships (bidirectional)
CREATE TABLE relationships (
  source_id TEXT NOT NULL,
  target_id TEXT,               -- NULL if target note doesn't exist yet
  target_title TEXT,            -- Original wiki-link text for unresolved refs
  relation_type TEXT NOT NULL,  -- "related", "assignee", "project", "mentions", etc.
  PRIMARY KEY (source_id, target_title, relation_type),
  FOREIGN KEY (source_id) REFERENCES notes(note_id)
);

-- Indexes
CREATE INDEX idx_notes_type ON notes(type);
CREATE INDEX idx_notes_status ON notes(status);
CREATE INDEX idx_notes_due ON notes(due);
CREATE INDEX idx_notes_modified ON notes(modified);
CREATE INDEX idx_note_tags_tag ON note_tags(tag);
CREATE INDEX idx_relationships_target ON relationships(target_id);
```

### Rebuild Strategy

- **Incremental:** File watcher detects changes → re-parse single file → update index within a transaction
- **Full rebuild:** On first startup, schema version change, or user request. For 2700 files, expected ~2-3 seconds.
- **Type validation during indexing:** Validate frontmatter against type schema. In rebuild mode, log warnings but still index. In live mode (MCP tool writes), reject invalid values.

---

## 5. File Watcher

- **Technology:** `chokidar` (mature, handles edge cases across OS). Falls back to `fs.watch` if needed.
- **Debounce:** 500ms after last change before triggering re-index batch.
- **Startup:** If index exists and schema version matches, do incremental diff (compare file mtimes vs index `modified`). If no index, full rebuild in background (non-blocking — MCP server starts immediately, search returns partial results until rebuild completes).
- **Git pull handling:** After sync-pull, file watcher detects all changed files and processes as one batch.
- **Ignores:** `.local/`, `.git/`, `node_modules/`, temp files (`.*~`, `.#*`, `*.tmp`).

---

## 6. Search Architecture

### Phase 1: FTS5 + Structured Filters (No Vectors)

Full-text search via SQLite FTS5 combined with structured metadata filters. This covers 80%+ of use cases without any external dependencies.

**How search works:**
1. Parse query for recognized filter keywords (type:task, status:open, tag:urgent, due:this-week)
2. Extract remaining free-text
3. Run FTS5 on free-text portion
4. Apply structured filters on metadata columns
5. Combine and rank results (FTS rank + recency boost)

### Phase 1.5 (Deferred): Vector Embeddings

Add `sqlite-vec` extension for semantic search. Lightweight embedding model via `transformers.js` (runs in-process, no Python service needed). Hybrid ranking: FTS5 score + vector similarity score.

---

## 7. Conversational Query Resolution

### Phase 1: Pattern-Based Filter Builder

A rule-based parser that recognizes common query patterns:

| Natural Language | Resolved Filter |
|-----------------|----------------|
| "show me blocked stories" | `{type: "story", status: "blocked"}` |
| "what's due this week" | `{due: {gte: monday, lte: sunday}, status: {not: "done"}}` |
| "tasks tagged urgent" | `{type: "task", tags: {includes: "urgent"}}` |
| "everything about Document Service" | FTS: "Document Service" + `{scope_service: "Document Service"}` |
| "open tasks assigned to me" | `{type: "task", status: "open", assignee: "self"}` |

The filter builder returns a structured `QueryFilter` object that is:
- **Inspectable:** The MCP tool returns both the parsed filter and the results
- **Editable:** Clients can modify the filter and re-query
- **Composable:** Filters can be AND/OR combined

### Phase 2 (Deferred): LLM-Powered Resolution

Use Claude to parse complex natural language into QueryFilter objects. Useful for ambiguous or multi-clause queries.

---

## 8. View Rendering

Since Phase 1 has no desktop app, `anvil_query_view` returns **structured JSON** that MCP clients render however they want.

### View Types

**List:** Flat array of note summaries, sorted.
```json
{ "view": "list", "items": [{ "noteId": "...", "title": "...", "status": "...", "due": "..." }] }
```

**Table:** Column definitions + row data.
```json
{ "view": "table", "columns": ["title", "status", "due", "priority"], "rows": [[...], [...]] }
```

**Board (Kanban):** Grouped by a field (typically status).
```json
{ "view": "board", "groupBy": "status", "columns": [
  { "id": "open", "title": "Open", "items": [...] },
  { "id": "in-progress", "title": "In Progress", "items": [...] }
]}
```

The client (Claude, Cursor, CLI) decides how to render the JSON — as markdown tables, interactive UI, or plain text.

---

## 9. MCP Server — 7 Tools

| Tool | Purpose | Key Inputs | Key Outputs |
|------|---------|-----------|-------------|
| `anvil_create_note` | Create a new note | type, title, content, fields | noteId, filePath |
| `anvil_update_note` | Update existing note | noteId, fields to update | updated fields list |
| `anvil_get_note` | Get full note | noteId | frontmatter + body + relationships |
| `anvil_search` | Free-text + filter search | query, type?, tags?, limit? | ranked results with snippets |
| `anvil_query_view` | Structured view query | viewType, filters, groupBy, orderBy | list/table/board JSON |
| `anvil_list_types` | List registered types | (none) | type definitions with field schemas |
| `anvil_get_related` | Get linked notes | noteId | notes linked to/from this note |

**Bonus tools to consider:**
- `anvil_delete_note` — Archive (soft-delete) or hard-delete a note
- `anvil_validate` — Validate a note's frontmatter against its type schema without saving
- `anvil_sync` — Combined pull + push (convenience wrapper)

**Error handling:** All tools return structured errors: `{ error: true, code: "VALIDATION_ERROR", field: "status", message: "...", allowed_values: [...] }`

**Pagination:** `limit` (default 20, max 100) + `offset` for search/query results.

---

## 10. Git Sync

- **Library:** `simple-git` (lightweight, well-maintained Node.js wrapper)
- **`anvil_sync_pull`:** fetch → merge (fast-forward preferred) → detect conflicts → re-index changed files
- **`anvil_sync_push`:** stage changed .md files → commit (with message) → push
- **Conflict resolution:** Return list of conflicted files. User resolves manually. Re-run pull when ready.
- **Auto-sync:** Deferred to Phase 1.5. Phase 1 is manual trigger only via MCP tools.

---

## 11. Repo Structure

The source code repo and the notes vault are **completely separate Git repos**.

### Source Code Repo (`/Users/arkhera/Desktop/Repositories/Anvil`)

```
Anvil/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── Dockerfile                      # For Docker deployment
├── docker-compose.yaml             # Mount vault dir as volume
├── .gitignore
├── src/
│   ├── index.ts                    # MCP server entry point
│   ├── config.ts                   # Configuration loader (reads vault path)
│   ├── setup.ts                    # `anvil init` — prompts for vault path, creates .anvil/ in vault
│   ├── types/
│   │   ├── note.ts                 # Note, QueryFilter, ViewData TypeScript types
│   │   └── schema.ts              # Type registry types, field validator types
│   ├── registry/
│   │   ├── type-registry.ts       # Load & cache type definitions from vault's .anvil/types/
│   │   └── validator.ts           # Field validation engine
│   ├── storage/
│   │   ├── file-store.ts          # Read/write markdown files in vault
│   │   └── watcher.ts             # File watcher + debounce on vault dir
│   ├── index/
│   │   ├── sqlite.ts              # SQLite adapter (schema, CRUD, queries)
│   │   ├── fts.ts                 # Full-text search via FTS5
│   │   ├── indexer.ts             # Parse file → index entry pipeline
│   │   └── migrations/            # Numbered schema migrations
│   │       └── 001_initial.sql
│   ├── search/
│   │   ├── filter-builder.ts      # Query string → structured filter
│   │   └── query-engine.ts        # Execute filters against index
│   ├── views/
│   │   └── renderer.ts            # Query results → list/table/board JSON
│   ├── sync/
│   │   └── git-sync.ts            # Git pull/push on the vault repo
│   └── tools/
│       ├── create-note.ts
│       ├── update-note.ts
│       ├── get-note.ts
│       ├── search.ts
│       ├── query-view.ts
│       ├── list-types.ts
│       └── get-related.ts
├── defaults/                       # Default type templates (copied to vault on init)
│   ├── _core.yaml
│   ├── note.yaml
│   ├── task.yaml
│   ├── project.yaml
│   ├── story.yaml
│   ├── person.yaml
│   ├── service.yaml
│   ├── meeting.yaml
│   └── journal.yaml
└── tests/
    ├── unit/
    │   ├── validator.test.ts
    │   ├── filter-builder.test.ts
    │   ├── indexer.test.ts
    │   └── renderer.test.ts
    ├── integration/
    │   ├── crud.test.ts
    │   ├── search.test.ts
    │   ├── query-view.test.ts
    │   └── sync.test.ts
    └── fixtures/                   # Test vault with sample notes
        └── test-vault/
```

### Server Configuration

The server needs to know where the vault lives. Stored in `~/.anvil/server.yaml` (or env var):

```yaml
# ~/.anvil/server.yaml
vault_path: "/Users/arkhera/Documents/Notes"   # Set by `anvil init`
transport: stdio                                 # stdio (for MCP clients) or http
port: 3100                                       # If transport is http
log_level: info
```

For Docker deployment, the vault is mounted as a volume:
```yaml
# docker-compose.yaml
services:
  anvil:
    build: .
    volumes:
      - /Users/arkhera/Documents/Notes:/vault
    environment:
      - ANVIL_VAULT_PATH=/vault
    ports:
      - "3100:3100"
```

**Dependencies:**
- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — SQLite (synchronous, fast)
- `gray-matter` — YAML frontmatter parsing
- `chokidar` — File watching
- `simple-git` — Git operations
- `uuid` — Note ID generation
- `zod` — Schema validation (for MCP tool inputs AND note field validation)
- `vitest` — Testing
- `js-yaml` — For parsing type definition YAML files

---

## 12. Build Order

```
Phase 1a — Foundation (stories 001-004)
  ├── 001: Type registry & validation engine
  ├── 002: Core data model & TypeScript types
  ├── 003: File storage layer (read/write markdown)
  └── 004: SQLite index (schema, CRUD, FTS5)

Phase 1b — MCP Tools (stories 005-008)
  ├── 005: anvil_create_note + anvil_get_note + anvil_update_note
  ├── 006: anvil_search (FTS + structured filters)
  ├── 007: anvil_query_view (list, table, board)
  └── 008: anvil_list_types + anvil_get_related

Phase 1c — Operational (stories 009-011)
  ├── 009: File watcher (live re-indexing)
  ├── 010: Git sync (pull + push)
  └── 011: Filter builder (conversational query → structured filter)

Phase 1d — Polish (stories 012-013)
  ├── 012: Migration tooling (Obsidian vault → Anvil)
  └── 013: Integration tests + documentation
```

---

## 13. Distribution & Getting Started

### Target User

Phase 1 targets developers and power users who already use MCP clients (Cursor, Claude Desktop, CLI tools). They are comfortable installing an npm package and adding a JSON config entry. Phase 1 is not an Obsidian replacement for general audiences — that comes with the desktop app in Phase 3.

### Install & Setup

```bash
# 1. Install
npm install -g anvil-mcp

# 2. Initialize — point at an existing folder or create a new vault
anvil init --vault ~/Documents/Notes

# This creates:
#   ~/Documents/Notes/.anvil/config.yaml
#   ~/Documents/Notes/.anvil/types/_core.yaml, task.yaml, ...
#   ~/Documents/Notes/.anvil/.local/index.db  (initial build)
#   ~/Documents/Notes/.gitignore              (ignores .anvil/.local/)
```

If the vault already has markdown files (e.g., an existing Obsidian vault), `anvil init` runs a full index build on first setup. Existing files without `noteId` in frontmatter are indexed in warn mode — they're searchable but won't have UUIDs until explicitly migrated (Phase 1d, story 012).

### MCP Client Configuration

The user adds Anvil to their MCP client config. This is the only configuration step — no Docker, no background service, no port.

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "anvil": {
      "command": "anvil-mcp",
      "args": ["--vault", "~/Documents/Notes"]
    }
  }
}
```

**Cursor (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "anvil": {
      "command": "anvil-mcp",
      "args": ["--vault", "~/Documents/Notes"]
    }
  }
}
```

Once configured, the user opens their MCP client and interacts naturally: "create a task called Fix auth bug with priority P1-high," "show me all blocked stories," "what's due this week."

### Cold Start Behavior

When the MCP client spawns Anvil:

1. **Load config** — read vault path from args or `~/.anvil/server.yaml`
2. **Load type registry** — parse `.anvil/types/*.yaml` into memory, cache in SQLite `types` table
3. **Index catchup** — compare file mtimes against index. Re-index changed files. If no index exists, full rebuild (~2-3 seconds for 2700 files). Server is ready for tool calls immediately; rebuild runs in background if needed.
4. **Start file watcher** — monitor vault for changes during the session
5. **Ready** — MCP tools are available

### Phase Evolution

| Phase | How it runs | What changes |
|-------|------------|--------------|
| Phase 1 | stdio child process, on-demand | Manual git sync, FTS5 only, no embeddings |
| Phase 1.5 | stdio child process, on-demand | Adds sqlite-vec embeddings (persisted, incremental). Manual `anvil reindex --embeddings` for full re-embed |
| Phase 2 | stdio child process, on-demand | Adds agent skills, LLM query resolution |
| Phase 3 | Persistent desktop app (always-on) | Background sync, continuous embedding, HTTP MCP for multi-client, full UI |

---

## 14. Phase Roadmap

### Phase 1.5: Vector Search

Adds semantic search to the existing stdio deployment. No new infrastructure — embeddings are stored in SQLite via `sqlite-vec` and generated in-process via `transformers.js`.

- **Embedding model:** Small, fast model running in-process (e.g., `all-MiniLM-L6-v2` via `transformers.js`, or `nomic-embed-text` — TBD based on quality/speed testing)
- **Storage:** Vectors stored as blob columns in `.anvil/.local/index.db` alongside the metadata index. One DB file, one derived artifact.
- **Incremental generation:** On file watcher events during active sessions, new/changed notes are embedded automatically. Unchanged notes keep their existing vectors.
- **Full re-embed:** Manual command `anvil reindex --embeddings` for bulk generation (e.g., after initial migration or model change). Expected ~30-60 seconds for 2700 notes with a small model.
- **Hybrid search:** FTS5 keyword results and sqlite-vec ANN results are combined via Reciprocal Rank Fusion (RRF) in application code. The `anvil_search` tool gains a `mode` parameter: `keyword`, `semantic`, or `hybrid` (default).
- **Pre-filtered vector search:** At 2700 notes, brute-force scan of filtered subsets (e.g., all open tasks) is fast enough. HNSW pre-filtering is not needed at this scale.

### Phase 2: Agent Skills & LLM Query Resolution

- Agent skills distribution (see below)
- LLM-powered query resolution — Claude parses complex natural language into QueryFilter objects for ambiguous or multi-clause queries
- Pluggable sync adapters — abstract the git sync layer so non-git backends (iCloud, Dropbox, S3) can be swapped in
- Multi-vault support — Anvil manages multiple vault directories, each with its own type registry and index

### Phase 2: Agent Skills Distribution

#### Problem

When users open an Anvil-managed vault in Cursor or Claude Code and ask the agent to "create a task" or "update this note," the agent has no guidance on how to interact with the system. Without it, agents will default to directly editing markdown files — bypassing validation, type constraints, and index consistency. Skills solve this by telling agents to route all operations through the Anvil MCP tools.

#### Directory Structure & Ownership

```
~/Documents/Notes/                    # The vault
├── .anvil/
│   ├── types/                        # Type registry (Phase 1, already defined)
│   ├── skills/                       # Anvil-managed skills (Phase 2)
│   │   ├── .managed                  # Marker file — signals "owned by Anvil"
│   │   ├── core.md                   # Always-loaded rule: use MCP, never edit files directly
│   │   ├── note-ops.md              # Create, update, get, delete patterns
│   │   ├── search-query.md          # Search and query view patterns
│   │   └── type-reference.md        # Auto-generated from type registry — lists all types, fields, enums
│   ├── skills-custom/                # User-owned skills (Anvil scaffolds dir, never touches contents)
│   │   └── (user adds custom skills here)
│   └── .local/                       # Derived artifacts (Phase 1, already defined)
```

#### Ownership Rules

- **`.anvil/skills/`** — Anvil-managed. Regenerated by `anvil init` and `anvil update`. Every file carries a header: `<!-- Managed by Anvil — do not edit. Changes will be overwritten on update. -->`. Treated as derived artifacts, same as `index.db`.
- **`.anvil/skills-custom/`** — User-owned. Anvil creates the directory on init but never reads, writes, or deletes anything inside it. Users add workflow-specific skills here (e.g., "format standup from in-progress tasks," "weekly review from completed items").

#### Resolution & Precedence

When an agent loads skills from both directories, **user skills take precedence**. If a user-custom skill covers the same operation as an Anvil-managed one, the user's version wins. This gives users an override mechanism without forking managed files.

#### Skill Generation from Type Registry

Anvil-managed skills are **generated from `.anvil/types/`**, not hand-written. When the type registry changes (new type added, field modified, enum values updated), running `anvil init` or `anvil update` regenerates the skills to reflect the current schema. This ensures skills never drift from the actual type definitions.

Example: adding `.anvil/types/bug.yaml` with fields `severity`, `reproduction_steps`, `affected_version` causes the regenerated `type-reference.md` to include `bug` as a valid type with its full field schema, so agents immediately know how to create bug reports with the correct fields.

#### Editor Bridge

The skills live in `.anvil/skills/` (Anvil's territory), but editors look in their own directories. `anvil init` generates thin bridge files:

- **Cursor:** A rule in `.cursor/rules/` that directs agents to read `.anvil/skills/` and `.anvil/skills-custom/` for all Anvil operations.
- **Claude Code:** A section in `CLAUDE.md` (or `.claude/`) with the same directive.

Both bridge files are marked as Anvil-managed and regenerated on update.

#### Phase 1 Implications

No skills are shipped in Phase 1, but the directory structure must not conflict:

- `.anvil/skills/` and `.anvil/skills-custom/` are reserved paths — Phase 1 should not use them for anything else.
- The `anvil init` command in Phase 1 does not need to create these directories yet, but should not create anything at `.anvil/skills` that would need migration later.

### Phase 3: Desktop App & Persistent Server

Phase 3 is the target state. Anvil becomes a **locally-installed desktop application** (Electron or Tauri) that runs as a persistent background service on the user's machine — always on, always watching the vault, always ready.

#### What Changes

The core MCP server, type registry, SQLite index, and vault structure are **identical** to Phase 1. Phase 3 changes *how* the server runs, not *what* it does.

| Concern | Phase 1 (stdio) | Phase 3 (desktop app) |
|---------|-----------------|----------------------|
| **Lifecycle** | Spawned by MCP client, dies on close | Persistent background process, starts on login |
| **Transport** | stdio only (single client) | HTTP + stdio (multiple concurrent clients) |
| **Git sync** | Manual via MCP tool calls | Automatic on configurable interval (e.g., every 5 minutes) |
| **Embeddings** | Phase 1.5: incremental during session | Continuous — re-embeds changed files in background as they're saved |
| **Index health** | Catches up on cold start | Always current — no catchup needed |
| **UI** | None — MCP client renders JSON | Native UI for views (kanban boards, tables, graph, calendar, timeline) |
| **System tray** | N/A | Menu bar / system tray icon with sync status, quick capture |

#### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Anvil Desktop App (Electron / Tauri)               │
│                                                     │
│  ┌────────────────────┐  ┌───────────────────────┐  │
│  │  Background Service │  │  Native UI            │  │
│  │                    │  │                       │  │
│  │  • File watcher    │  │  • Kanban board       │  │
│  │  • Auto git sync   │  │  • Table / list views │  │
│  │  • Embedding gen   │  │  • Graph view         │  │
│  │  • Index maint.    │  │  • Timeline/calendar  │  │
│  │  • HTTP MCP server │  │  • Quick capture      │  │
│  │    (port 3100)     │  │  • Search UI          │  │
│  └────────┬───────────┘  └───────────┬───────────┘  │
│           │                          │              │
│           └──────────┬───────────────┘              │
│                      │                              │
│              ┌───────▼────────┐                     │
│              │  Anvil    │                     │
│              │  (same as P1)  │                     │
│              │                │                     │
│              │  • Type registry                     │
│              │  • SQLite + FTS5 + sqlite-vec        │
│              │  • Validator                         │
│              │  • Query engine                      │
│              │  • MCP tool handlers                 │
│              └───────┬────────┘                     │
│                      │                              │
└──────────────────────│──────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  Notes Vault   │
              │  (filesystem)  │
              └────────────────┘
```

#### Background Service Responsibilities

- **Auto git sync:** Pull on interval (default every 5 min), push after local writes settle (debounced). Conflict detection surfaces as a notification — user resolves manually, same as Phase 1.
- **Continuous embedding:** File watcher events trigger embedding generation in a background queue. New/changed notes are embedded within seconds of saving. No manual `reindex` needed.
- **Index maintenance:** The index is always warm. No cold-start catchup. If the app is restarted, a fast incremental diff brings it current (same logic as Phase 1, but rarely needed).
- **HTTP MCP server:** Exposes the same MCP tools over HTTP on a local port (default 3100). Multiple MCP clients (Cursor, Claude Desktop, CLI scripts) can connect simultaneously. stdio transport is still supported for clients that prefer it.
- **System tray:** Sync status indicator (last sync time, conflict alerts), quick capture (global hotkey to create a note), vault health (index stats, unresolved references).

#### Multi-Client Access

With HTTP transport, multiple agents can use Anvil simultaneously — Cursor for development work, Claude Desktop for personal task management, a CLI script for automation. All hit the same server, same index, same vault. SQLite handles concurrent reads natively; writes are serialized through the server.

#### Migration from Phase 1

No data migration required. The vault, types, index, and git history are unchanged. The user installs the desktop app, points it at their existing vault, and the background service takes over. The MCP client config switches from spawning a child process to connecting via HTTP:

```json
{
  "mcpServers": {
    "anvil": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

Users who prefer the lightweight stdio setup can continue using it — the desktop app is additive. The HTTP server is an option, not a requirement.

#### Advanced Views (UI)

The desktop app introduces a native UI layer that consumes the same `anvil_query_view` JSON output that MCP clients use in Phase 1. View rendering logic is shared — the UI is just a richer renderer for the same data:

- **Kanban board:** Drag-and-drop cards grouped by status (or any enum field). Calls `anvil_update_note` on drop.
- **Table view:** Sortable, filterable columns. Inline editing for quick field updates.
- **Graph view:** Visualizes relationships (typed references, related links, mentions) as a force-directed graph.
- **Timeline / calendar:** Date-based views using `due`, `created`, `modified` fields.
- **Quick capture:** Global hotkey opens a minimal window — type title, select type, save. Creates the note via the same `anvil_create_note` path.

#### Technology Decision (Deferred)

Electron vs Tauri is not decided yet. Key trade-offs:

- **Electron:** Larger bundle, more memory, but mature ecosystem and full Node.js access (easy to share code with the MCP server which is already Node/TypeScript).
- **Tauri:** Smaller bundle, lower memory, Rust backend. Would require the Anvil core to either run as a sidecar Node process or be rewritten in Rust. More work, better end product.

This decision can wait until Phase 2 is complete. The Anvil core (TypeScript, SQLite, MCP tools) is transport-agnostic — it doesn't care whether the host is Electron, Tauri, or a plain Node process.

---

## 15. Resolved Design Decisions

| Decision | Resolution |
|----------|-----------|
| Type inheritance | **Single inheritance** — a type can extend one parent. Max 3 levels deep. |
| Enum extensibility | **Strict reject** — invalid enum values are rejected. User must update the type YAML to add values. |
| Template on create | **Caller chooses** — `use_template` param (default true). Frontmatter defaults always apply; body template is opt-in. |
| Scratch → Journal rename | **`journal`** replaces `scratch` as the type name. Better communicates append-only, chronological record behavior. Type declares `append_only: true` which tools enforce. |

## 16. Remaining Open Questions

1. **File naming on create:** Should `anvil_create_note` auto-generate filenames (from title slug), or let the caller specify a path?
2. **Soft delete vs hard delete:** Should `anvil_delete_note` set `archived: true` (soft) or remove the file (hard)? Or both as options?

---

## Verification Plan

1. **Unit tests:** Validator (field type checks, enum validation, duplicate tag detection), filter builder (query parsing), indexer (frontmatter → SQL)
2. **Integration tests:** Full CRUD cycle (create note → verify index → search → update → verify changes → get related), git sync (commit → pull on fresh clone → verify index)
3. **Migration dry-run:** Run against a subset of the Obsidian vault, verify all notes index without errors
4. **MCP client test:** Connect Claude Desktop to the MCP server, create/search/query notes interactively
