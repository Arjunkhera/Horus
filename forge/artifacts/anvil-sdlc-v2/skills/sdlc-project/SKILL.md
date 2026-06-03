---
name: sdlc-project
description: >
  Create and manage software development projects. Runs repo-local with no forge_develop, Forge
  workspaces, or Forge sessions. Use this skill when the user wants to start a new project,
  configure an existing project, check project status, link projects to programs, or archive a
  project. Also use when the user says "new project", "create project", "project status",
  "set up a project", or similar project-management phrases.

  A project is the primary organizational unit. It contains work items, documentation references,
  and configuration. Each project is an Anvil note of type `project`.

  Projects can optionally belong to a program (a group of related projects).
---

# Project Skill

You manage the lifecycle of development projects in the SDLC system. A project is the primary container for development work — it groups work items, references repos, and links to a program.

## Repo-local contract (shared by every sdlc-* skill)

1. **You run inside the user's real repo checkout.** `cwd` is a normal git working tree, so the
   repo's own `CLAUDE.md`, `.claude/skills`, MCP servers, hooks, and settings auto-load.
2. **Isolation = native git worktrees, nothing else.** Parallel work lives at
   `<repo-root>/.worktrees/<slug>/` on a `feature/<slug>` (or `fix/`, `chore/`) branch. No
   `forge_develop`, no Forge workspaces, no Forge sessions, no managed clone pool, no Docker path
   translation. If you reach for a `forge_*` session/workspace tool, stop — that is the old model.
3. **Anvil and Vault are location-independent MCP services.** Use Anvil for work-item state, Vault
   for conventions; they work from any cwd.
4. **Context discipline is mandatory.** Delegate ALL code exploration and ALL Anvil/Vault reads to a
   **Sonnet subagent** (`Agent` tool, `model: sonnet`), briefed with the worktree path. The subagent
   returns a tight summary; raw file dumps never enter the orchestrating context.

All project state lives in Anvil as typed notes (type: `project`). Repo-level information (tech stack, conventions, build commands) comes from Vault repo profiles.

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `anvil_create_entity` | Create project notes with edges to program |
| `anvil_update_entity` | Update project configuration (PATCH semantics) |
| `anvil_get_note` | Read project details |
| `anvil_search` | Find projects, check for duplicates |
| `anvil_create_edge` | Link project to program, repos via edges |
| `anvil_get_edges` | Query project relationships |
| `knowledge_resolve_context` | Load Vault repo profiles for project repos |

## Conversation State

Conversation-state notes store **metadata in frontmatter fields** and **content in the markdown body**. The body uses `## Decided`, `## Open Questions`, and `## Handoff Note` sections. Never write decided, open, or handoff content to frontmatter fields.

On entry, read the current `conversation-state` note for this repo:
- Search: `anvil_search` type=conversation-state, project=`<repo-name>`
- If `status=paused`: parse the `## Handoff Note` section from the note body, present to user, confirm continuation
- If `status=active`: parse `## Decided` and `## Open Questions` sections from the body; read `last_skill`, `work_items` from fields. Use these to inform your work.
- If not found: create new conversation-state (topic inferred, status=active, project=`<repo-name>`, body with empty `## Decided`, `## Open Questions`, `## Handoff Note` sections)

On exit, update conversation-state body via `anvil_update_entity` with `body:` containing the full updated markdown:
- Append decisions under `## Decided`
- Remove resolved items from `## Open Questions`
- Add new work item IDs to `work_items` field
- Set `last_skill` field to `sdlc-project`
- Set `project` field to the repo name (basename of repo root)
- If user pauses: write handoff summary under `## Handoff Note`, set `status` field to `paused`

## Operations

### `create` — Initialize a New Project (Flow 22)

1. **Gather details from user:**
   - Name (slug-friendly: lowercase, hyphens)
   - Description (1-2 sentences)
   - Repos (one or more — each with a role: "Product code", "Data store", etc.)
   - Program membership (optional — which program does this belong to?)

2. **Create project note in Anvil** via `anvil_create_entity`:
   - Type: `project`
   - Title: project name
   - Fields: status=active, program reference if applicable
   - Body content:
     - Overview section
     - Goals section
     - Repository table (repos + roles)
     - Status summary (auto-populated from work item queries)
     - Links section

3. **Query Vault** for existing repo profiles via `knowledge_resolve_context` for each repo (Sonnet subagent). If profiles exist, the project already has context.

4. **If Vault profiles don't exist:** Offer to bootstrap them via the docs skill (→ Flow 4: Codebase Exploration).

5. **Note repo root paths** from `git rev-parse --show-toplevel` in the project overview for reference. Do NOT use `forge_repo_resolve`.

6. **Link to program** if applicable → update program note via `anvil_update_entity`.

7. **Confirm** creation with project ID, repos, and Vault status.

8. **Remind the user** that the `sdlc-keystone-update` skill can reformat this project page at any time to re-sort work items, add phases, or bring the page into the standard keystone layout.

### `configure` — Update Project Settings

Update the project note in Anvil:
- Change description or goals
- Add/remove repos from the repository table
- Update program membership
- Mark as active/paused/archived

Always read the current note via `anvil_get_note` before updating to preserve existing content.

### `status` — Get Project Status

Generate a status report by querying Anvil:

1. Read project note via `anvil_get_note`
2. Query work items: `anvil_query_view` with `filter: { type: "story", project: "{id}" }`, `groupBy: "status"`
3. Check for blocked items specifically
4. Query recent journal entries: `anvil_search` with project tag, last 7 days
5. Present concise dashboard

### `link-program` — Add Project to a Program

1. Check if program exists via `anvil_search` with type `program`
2. If not, create it via `anvil_create_entity` with type `program`
3. Update program note body to include this project
4. Update project note fields to reference the program

### `archive` — Archive a Project

1. Query all work items for the project
2. Verify all are either `done` or `cancelled`
3. If active items remain, warn the user and ask for confirmation
4. Update project status to `archived` via `anvil_update_entity`
5. Log archival in project scratch via `anvil_create_entity` (journal type)

## Project Note Body Template

The project note body follows the Horus keystone format. Use this structure exactly:

```
## What is this?

{description — 2-4 sentences covering the purpose and goals of this project.}

## Repositories

| Repo | Role | Vault Profile | Worktree Root |
|------|------|---------------|---------------|
| {repo} | {role} | ✅/❌ | {path or "unresolved"} |

## Current Phase

**Phase {N} — {Phase Name}** ({status icon} {status label})

{1-2 sentences describing the current focus.}

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | {Phase Name} | ✅ Done |
| 2 | {Phase Name} | 🔄 In Progress |
| 3 | {Phase Name} | ⬜ Not Started |

Status icons: 🔄 In Progress · ✅ Done · ⬜ Not Started · ⏸ Paused

## Work Item Tracker

| ID | Title | Type | Priority | Status |
|----|-------|------|----------|--------|

(Populate from Anvil work items. Sort: in-progress first by priority, then ready, then done last.)

## Resources

- Program: [[{program}]]
- Design docs: (link when available)
- Spec: (link when available)
```

Run `sdlc-keystone-update` to automatically populate and re-sort the Work Item Tracker from live Anvil data.

## Context Resolution

The project note only declares **which repos are involved and their roles.** Everything else is resolved at runtime:
- **Vault** → tech stack, conventions, build commands, architecture docs
- **git rev-parse --show-toplevel** → repo root path from the current working directory

This means the project note stays lightweight and portable. A different developer with the same Vault but a different checkout location can use the same project definition.
