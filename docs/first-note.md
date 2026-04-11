---
title: Your First Anvil Note
description: How Anvil's dynamic type system works and how to create your first entity — project, task, or note.
slug: first-note
tags: [anvil, notes, onboarding, types]
schema_version: 1
keywords: [note, create, anvil, type, project, task, story, journal, list-types, dynamic-types]
related_commands: [horus status]
sidebar_position: 5
---

# Your First Anvil Note

Anvil is Horus's live-state layer. It stores tasks, projects, journals, stories, meeting notes, and every other kind of structured entry you might want to track. Every entity is a markdown file with YAML front-matter, indexed by SQLite for fast search.

The one thing that surprises most first-time users: **types are not hardcoded**. Anvil has a dynamic type system — you (or a plugin) define types as YAML files, and Anvil discovers them at runtime. That's why the first thing any Anvil-aware tool does is call `anvil_list_types` to ask what's currently available.

## Step 1 — See what types exist

Ask Claude:

> "What note types exist in Anvil?"

Claude will call the `anvil_list_types` tool and return a list of types with their fields, required fields, and defaults. On a fresh install you'll see core types like:

- **`project`** — top-level container for related work
- **`story`** — a feature, task, or work item (extends `task`)
- **`task`** — a tracked to-do with status
- **`note`** — a generic unstructured entry
- **`journal`** — append-only chronological record for standups, session logs, decisions
- **`meeting`** — attendees + agenda + action items

Each type has:

- **Required fields** (e.g. every `story` needs a `status`)
- **Optional fields** (`priority`, `due`, `story_points`, etc.)
- **Enum fields** with allowed values (e.g. `status: open | in-progress | blocked | done`)

Don't memorize these — the tool returns them every call.

## Step 2 — Create a project

> "Create a project called 'My First Horus Project' with status `active`."

Claude will pick the right type, populate the required fields, and call `anvil_create_entity`. Under the hood that looks like:

```
anvil_create_entity({
  type: "project",
  title: "My First Horus Project",
  fields: { status: "active" },
  body: "Brief description of what this project is for."
})
```

The response gives you a UUID (`entityId`) and the file path where Anvil wrote the note on disk — something like `~/Horus/data/notes/my-first-horus-project.md`.

## Step 3 — Add a task to the project

Projects are just containers — the actual work lives as `task` or `story` entities that reference them. Ask Claude:

> "Create a task in My First Horus Project called 'Try out `horus help`' with priority P2-medium."

Anvil will create a new task and add the project reference via a typed edge. A lightly-edited version of the tool call:

```
anvil_create_entity({
  type: "task",
  title: "Try out horus help",
  fields: {
    project: "[[My First Horus Project]]",
    priority: "P2-medium",
    status: "open"
  }
})
```

Two things worth noting:

- **References are wiki-links.** Anvil uses `[[Title]]` format for cross-entity references, not UUIDs. The ingestion pipeline resolves the link to a UUID under the hood.
- **Edges are real.** Fields like `project` aren't just strings — they create typed edges in Anvil's graph, visible via `anvil_get_edges` and `anvil_get_related`.

## Step 4 — Search for what you just created

> "What's pending in My First Horus Project?"

Claude calls `anvil_query_view` with a filter on project + status, or `anvil_search` with a free-text query. Both hit Anvil's SQLite index and return the matching entities. You'll see the task you just created.

You can also:

- **Group results as a board:** `anvil_query_view({ type: "task", project: "[[My First Horus Project]]", format: "board", groupBy: "status" })`
- **Filter by tags:** `anvil_search({ query: "onboarding", tags: ["experimental"] })`
- **Get a subtree** starting from a project: `anvil_get_subtree({ rootId: "..." })`

## Step 5 — Update without overwriting

Anvil uses **PATCH semantics** for updates. When you call `anvil_update_entity`, only the fields you pass are changed — everything else is preserved. That means you can safely update a single field without worrying about clobbering unrelated metadata.

> "Mark that task as in-progress."

```
anvil_update_entity({
  noteId: "abc-...",
  fields: { status: "in-progress" }
})
```

**Journals are a special case:** they're append-only. Updating a journal's body *appends* the new content instead of replacing it, which is useful for daily standups and decision logs.

## Common starter flows

A few things you'll probably try in your first week:

- **Daily journal** — create a `journal` type each morning; Claude appends new entries throughout the day
- **Project kanban** — one `project`, many `task`s, `anvil_query_view` with `format: "board"` gives you a live kanban
- **Conversation state** — Claude auto-creates a `conversation-state` entity to track open questions and decisions for a session
- **SDLC workflow** — `project` → `story` → `task` with typed edges, driven by the `sdlc-*` skills

## Where the data lives

All Anvil entities are plain markdown files under `<data_dir>/notes/`, tracked in git. You can browse them, edit them in your text editor, commit them, and push them to your remote — Anvil picks up file-system changes via its file watcher. Anvil also periodically pulls the remote and pushes local changes, so your data sync across machines works the same way as git.

## What's next

- **`horus guide first-workspace`** — set up an isolated agent context so your notes, skills, and MCP configs stay organized
- **`horus guide first-session`** — tie a code session to a story or task you just created
- **`horus guide core-concepts`** — how Anvil relates to Vault and Forge in the bigger picture
