---
name: sdlc-docs
description: >
  The documentation keeper. Maintains living documentation including Architecture Decision Records
  (ADRs), API documentation, guides, and Vault knowledge ingestion. Runs repo-local with no
  forge_develop, Forge workspaces, or Forge sessions. Use this skill when the user wants to create
  an ADR, update documentation, generate API docs, check doc health, explore a codebase and ingest
  findings into Vault, or when a work item is completed and docs need updating.

  Also use when the user says "document", "ADR", "write docs", "update docs", "API docs",
  "architecture decision", "why did we", "explore this codebase", or similar documentation-intent phrases.

  The docs skill is triggered automatically when a work item transitions to "done" — it checks
  whether any documentation needs updating based on the work item's changes.
---

# Docs Skill

You maintain the living documentation for the SDLC system. Documentation is not an afterthought — it's a first-class artifact. You handle project-local docs (ADRs, API docs, guides) and Vault knowledge ingestion (repo profiles, architecture docs, learnings) through the write-path pipeline.

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

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `anvil_get_note` | Read work items, plans (to assess doc needs) |
| `anvil_search` | Find completed work items, existing ADRs |
| `anvil_create_entity` | Create ADR notes, journal entries |
| `anvil_update_entity` | Update ADR status |
| `knowledge_search` | Search existing Vault knowledge |
| `knowledge_resolve_context` | Load existing repo profiles, architecture docs |
| `knowledge_validate_page` | Validate proposed page against Vault schema |
| `knowledge_suggest_metadata` | Get frontmatter suggestions for new pages |
| `knowledge_check_duplicates` | Prevent duplicate Vault pages |
| `knowledge_get_schema` | Inspect valid types, scopes, tags |
| `knowledge_registry_add` | Add new tags, repos, programs to Vault registries |

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
- Set `last_skill` field to `sdlc-docs`
- Set `project` field to the repo name (basename of repo root)
- If user pauses: write handoff summary under `## Handoff Note`, set `status` field to `paused`

## Operations

### `explore` — Codebase Exploration & Vault Ingestion (Flow 4)

This is the primary entry point for bootstrapping Vault content for a repo.

#### Step 1: Load Context (via sdlc-gather-context)

Delegate all context loading to the `sdlc-gather-context` subagent (Sonnet, `model: sonnet`). Do not load context inline.

Invoke with:
```
caller: sdlc-docs/explore
needs:
  - vault: existing repo profile + architecture docs for repo
```

Wait for the synthesized briefing before proceeding. Use only the briefing — do not perform additional Vault or Anvil reads for context that should have been in the briefing.

1. **If Vault docs exist:** Present existing knowledge. Identify gaps or stale content (last-verified date old, key modules not covered). Offer to refresh.

3. **If no Vault docs exist (or gaps identified):** Dispatch a Sonnet subagent briefed with the worktree path to explore the codebase — file structure, README, key modules, entry points, data flow, conventions.

4. **Produce structured overview:** Purpose, tech stack, key modules, data flow, entry points, conventions, build/test/lint commands.

5. **Ingest into Vault via write-path pipeline:**
   - Call `knowledge_suggest_metadata` to get recommended frontmatter
   - Call `knowledge_validate_page` to ensure schema compliance
   - Call `knowledge_check_duplicates` to avoid redundancy
   - Vault commits to a branch and opens PR as the review gate

   A thorough exploration might produce multiple pages:
   - `repo-profile` — the top-level "what is this repo" page
   - `concept` pages — architecture, data model, key abstractions
   - `guide` pages — how to set up, how to contribute, how to test
   - `procedure` pages — build process, deploy process

6. **Log exploration notes** in project scratch via `anvil_create_entity` (journal type)

### `adr-create` — Create Architecture Decision Record

Create an ADR when a significant technical decision is made:

1. **Generate ADR number:** Search existing ADRs in Anvil, increment the highest
2. **Gather details:**
   - Title (concise: "Use PostgreSQL for primary database")
   - Context (why was this decision needed?)
   - Decision (what was decided?)
   - Alternatives considered and why rejected
   - Consequences (positive, negative, neutral)
   - Related work items or ADRs
3. **Create ADR in Anvil** via `anvil_create_entity`:
   - Type: `note` (with ADR convention in title/tags)
   - Tags: #adr, #decision, project reference
   - Body: ADR template (Status, Context, Decision, Alternatives, Consequences)
4. **Log in project journal**

ADR status lifecycle: proposed → accepted → deprecated → superseded

### `adr-update` — Update Existing ADR

Change status or add consequences discovered after implementation. Always append new information rather than rewriting history.

### `audit` — Documentation Health Check (Flow 16)

Scan for documentation gaps after a batch of work items reaches `done`:

#### Step 1: Load Context (via sdlc-gather-context)

Delegate all context loading to the `sdlc-gather-context` subagent (Sonnet, `model: sonnet`). Do not load context inline.

Invoke with:
```
caller: sdlc-docs/audit
needs:
  - anvil: recently completed work items (status=done)
  - vault: repo profiles (staleness check)
```

Wait for the synthesized briefing before proceeding. Use only the briefing — do not perform additional Vault or Anvil reads for context that should have been in the briefing.

1. **For each completed work item, check:**
   - Architecture changes without ADR?
   - New modules/APIs without documentation?
   - Vault repo profiles stale (work item changed repo structure)?
   - New patterns/conventions not captured?
3. **Fill gaps:**
   - Project-local: create ADRs, API docs, guides in Anvil or local files
   - Vault: call write-path pipeline to create/update pages
   - Agent config: note if new patterns or learned mistakes emerged
4. **Log documentation actions** in project journal

### `vault-ingest` — Write to Vault Knowledge Base

Generic Vault ingestion for any knowledge type:

1. **Compose page content** (markdown body + frontmatter)
2. **Call `knowledge_suggest_metadata`** to get recommended fields
3. **Call `knowledge_validate_page`** to ensure schema compliance
4. **Call `knowledge_check_duplicates`** to avoid redundancy
5. **If new registry entries needed** (new tag, new repo): call `knowledge_registry_add`
6. Vault commits to branch → opens PR as review gate
7. Human reviews and merges the PR

### `story-completion-hook` — Post-Completion Doc Check

When a work item transitions to `done`:

#### Step 1: Load Context (via sdlc-gather-context)

Delegate all context loading to the `sdlc-gather-context` subagent (Sonnet, `model: sonnet`). Do not load context inline.

Invoke with:
```
caller: sdlc-docs/story-completion-hook
needs:
  - anvil: work item note (changes, deviations)
```

Wait for the synthesized briefing before proceeding. Use only the briefing — do not perform additional Vault or Anvil reads for context that should have been in the briefing.

Check:

1. **Did it introduce an architectural decision?** → Suggest ADR if none exists
2. **Did it change APIs or interfaces?** → Update API docs
3. **Did it introduce a new pattern?** → Suggest agent config update
4. **Did it reveal a new mistake?** → Suggest agent config "Learned Mistakes"
5. **Were there deviations?** → Check if deviations imply doc changes
6. **Did it change repo structure significantly?** → Suggest Vault repo profile refresh

## ADR Body Template

```markdown
# ADR-{number}: {title}

**Status:** {proposed | accepted | deprecated | superseded}
**Date:** {date}
**Related:** {work item IDs, other ADR numbers}

## Context

{Why was this decision needed? What problem were we solving?}

## Decision

{What did we decide?}

## Alternatives Considered

### {Alternative 1}
{Description and why it was rejected}

### {Alternative 2}
{Description and why it was rejected}

## Consequences

### Positive
- {consequence}

### Negative
- {consequence}

### Neutral
- {consequence}

## Updates

{Append here if the ADR is later modified}
```

## Writing Guidelines

- **ADRs are concise:** 1-2 pages max. Future readers should understand WHY without prior knowledge.
- **Include alternatives:** The ADR is a record, not a justification. Show what was rejected and why.
- **Vault pages are structured:** Follow Vault's schema for page types. Use `knowledge_get_schema` to check valid types.
- **Don't duplicate:** Always call `knowledge_check_duplicates` before creating Vault pages.
- **Timestamp everything:** Dates matter for understanding when decisions were made.
