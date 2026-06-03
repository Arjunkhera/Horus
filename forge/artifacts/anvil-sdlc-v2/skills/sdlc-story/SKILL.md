---
name: sdlc-story
description: >
  Create and manage work items — the atomic unit of work in the SDLC system. Also the repo-local
  worktree CREATOR: when a story transitions to in_progress, this skill carves out a native git
  worktree at `.worktrees/<slug>` and hands off to sdlc-orchestrator. Use this skill when the user
  wants to create a work item, update status, define acceptance criteria, promote a scratch to a work
  item, list work items, view details, block/unblock, or manage lifecycle.

  Also use when the user says "create story", "new story", "new work item", "start story", "move story",
  "story status", "what stories", "promote this to a story", "block story", or similar work-item phrases.

  Work items follow a defined state machine: draft → ready → in_progress → in_review → done, with
  blocked and cancelled as escape states. It does NOT use forge_develop, Forge workspaces, or
  Forge sessions — isolation is a native git worktree.
---

# Story Skill (Work Item Manager)

You manage work items — the atomic units of work in the SDLC system. Every piece of implementable work is a work item stored in Anvil (type: `story`). When a story begins (`in_progress` transition), you create an isolated git worktree for it and hand off to the orchestrator.

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
| `anvil_create_entity` | Create work items, plans, journal entries with optional edges |
| `anvil_get_note` | Read work item details |
| `anvil_update_entity` | Transition status, update fields, modify body (PATCH semantics) |
| `anvil_search` | Find work items by project, status, subtype |
| `anvil_query_view` | Board views, filtered lists |
| `anvil_create_edge` | Create block/reference/parent edges between work items, design docs, specs |
| `anvil_delete_edge` | Remove block or reference edges |
| `anvil_get_edges` | Query blockers, linked docs, and dependencies for a work item |

## Conversation State

Conversation-state notes store **metadata in frontmatter fields** and **content in the markdown body**. The body uses `## Decided`, `## Open Questions`, and `## Handoff Note` sections. Never write decided, open, or handoff content to frontmatter fields.

Repo-local mode has no Forge workspace, so scope conversation-state by the **repo**: set the `project` field to the repo name (e.g. the `basename` of the repo root) and put work-item IDs in `work_items`.

On entry, read the current `conversation-state` note for this repo:
- Search: `anvil_search` type=conversation-state, with the repo name in `project`
- If `status=paused`: parse the `## Handoff Note` section from the note body, present to user, confirm continuation
- If `status=active`: parse `## Decided` and `## Open Questions` sections from the body; read `last_skill`, `work_items` from fields. Use these to inform your work.
- If not found: create new conversation-state (`project`=repo name, topic inferred, status=active, body with empty `## Decided`, `## Open Questions`, `## Handoff Note` sections)

On exit, update conversation-state body via `anvil_update_entity` with `body:` containing the full updated markdown:
- Append decisions under `## Decided`
- Remove resolved items from `## Open Questions`
- Add new work item IDs to `work_items` field
- Set `last_skill` field to `sdlc-story`
- If user pauses: write handoff summary under `## Handoff Note`, set `status` field to `paused`

## Work Item Subtypes

Each subtype has default ceremony and required sections:

| Subtype | Ceremony | Plan? | Tests? | Review? | Key Sections |
|---------|----------|-------|--------|---------|-------------|
| feature | full | yes | yes | yes | Acceptance Criteria, Technical Notes, Dependencies |
| bugfix | standard | yes | yes | yes | Reproduction, Fix Criteria, Root Cause, Technical Notes |
| refactor | standard | yes | yes | yes | Current State, Target State, Invariants |
| spike | light | no | no | no | Question, Time Box, Approach, Findings, Recommendation |
| hotfix | light | no | yes | no | Issue (Symptom/Impact/Urgency), Fix, Verification, Follow-up |
| task | standard | no | no | no | Deliverables, Technical Notes, Dependencies |
| chore | light | no | no | no | Deliverables |

> **`bug` type vs `bugfix` subtype:** The `bug` Anvil type (managed by `sdlc-bug` skill) tracks the *report* — symptoms, root cause investigation, fix record, and verification. The `bugfix` story subtype is the *implementation work item* created once root cause is known and a fix is planned. File a `bug` first; create the `bugfix` story when you're ready to schedule the fix work.

## State Machine

```
                  ┌────────────────────────────────────────────┐
                  │                                            ▼
draft ──→ ready ──→ in_progress ──→ in_review ──→ done
  │                    │    ▲           │
  │                    ▼    │           │
  │                  blocked            │
  │                                     │
  └──────────────→ cancelled ←──────────┘
```

**Valid transitions:**
- `draft` → `ready` (spec approved)
- `draft` → `cancelled` (abandoned)
- `draft` → `in_progress` (ONLY for types with `can_skip_to: in_progress`: spike, hotfix, chore)
- `ready` → `in_progress` (work begins — **triggers worktree creation, see below**)
- `ready` → `cancelled`
- `in_progress` → `in_review` (implementation done)
- `in_progress` → `blocked` (dependency or blocker)
- `in_progress` → `cancelled`
- `blocked` → `in_progress` (blocker resolved)
- `blocked` → `cancelled`
- `in_review` → `done` (accepted)
- `in_review` → `in_progress` (rejected, needs rework)
- `in_review` → `cancelled`

Any other transition is invalid. If the user requests one, explain the valid options.

## Worktree Creation (on `ready → in_progress` transition)

When a story transitions to `in_progress`, create an isolated git worktree for it before handing off to `sdlc-orchestrator`.

### Derive slug and branch

- `slug` = kebab-case of the title, trimmed to ~4 words, plus a short id suffix when an Anvil id exists: e.g. `fix-login-redirect-3a432`.
- `branch` = `feature/<slug>` for features, `fix/<slug>` for bugs, `chore/<slug>` otherwise.

### Create the worktree

```bash
ROOT=$(git rev-parse --show-toplevel)
grep -qxF '.worktrees/' "$ROOT/.gitignore" || printf '\n# repo-local SDLC worktrees\n.worktrees/\n' >> "$ROOT/.gitignore"
DEF=$(git -C "$ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
DEF=${DEF:-$(git -C "$ROOT" remote show origin | sed -n 's/.*HEAD branch: //p')}; DEF=${DEF:-main}
git -C "$ROOT" fetch origin --quiet
WT="$ROOT/.worktrees/<slug>"
[ -d "$WT" ] || git -C "$ROOT" worktree add "$WT" -b "<branch>" "origin/$DEF"
# all edits for this unit of work happen inside $WT
```

If the branch already exists from a prior run, drop the `-b` flag and add the existing branch directly (`git worktree add "$WT" "<branch>"`).

After the worktree is created, state the worktree path and branch to the user, then invoke **sdlc-orchestrator** with the resolved goal + acceptance criteria + worktree path. From here on, every file edit happens inside `$WT`.

## Operations

### `create` — Create a New Work Item

1. **Determine the project:** Which project does this belong to? If ambiguous, ask.

2. **Determine the subtype:** What kind of work is this? Map user intent:
   - "I want to build X" → `feature`
   - "There's a bug..." → **route to `sdlc-bug` first** to file a bug report; the `bugfix` story is the implementation follow-on created after root cause is understood
   - "Clean up / restructure..." → `refactor`
   - "Can we try / is it possible..." → `spike`
   - "Production is broken..." → `hotfix` (immediate patch; file a `bug` report in parallel for root cause tracking)
   - "We need to do X (non-code)" → `task`
   - "Routine maintenance..." → `chore`

3. **Set ceremony level:** Use the subtype's default, or escalate/demote if the user indicates.

4. **Gather work item details based on subtype sections:**
   - Title (concise, action-oriented)
   - Description (what and why)
   - Subtype-specific sections (see table above)
   - Priority (P0-P3, default P2-medium)
   - Dependencies (other work item IDs)
   - **Repo:** Which repository is the primary target for implementation? (optional — populate from `repo` field on the project note, or ask)
   - **Design doc:** Is there a linked `design-doc` entity? (optional — set `design_doc` field)
   - **Spec:** Is there a linked `spec` entity? (optional — set `spec` field)

5. **Create in Anvil** via `anvil_create_entity`:
   - Type: `story`
   - Fields: `subtype`, `ceremony`, `status=draft` (or `in_progress` for can_skip_to types), `priority`, `project` reference, `repo` (if known), `design_doc` (if linked), `spec` (if linked)
   - Body: subtype-specific sections + History table
   - Tags: project name, subtype

6. **Create edges** for linked artifacts (after the entity is created):
   - If a `design_doc` was specified: `anvil_create_edge(sourceId: story_id, targetId: design_doc_id, intent: "references")`
   - If a `spec` was specified: `anvil_create_edge(sourceId: story_id, targetId: spec_id, intent: "references")`
   - If this story blocks another: `anvil_create_edge(sourceId: story_id, targetId: blocked_story_id, intent: "blocks")`

7. **Confirm** creation with ID, title, subtype, ceremony, status, and any linked docs.

### `transition` — Change Work Item Status

1. **Validate the transition** against the state machine
2. **Update via `anvil_update_entity`:** Change status field, append to History table in body
3. **Log in journal:** Create a journal entry via `anvil_create_entity` noting the transition and reason
4. **Trigger downstream actions** based on new state:
   - `in_progress` → **Create worktree** (see Worktree Creation above), then inform user the developer skill can pick this up via sdlc-orchestrator
   - `in_review` → Inform user the tester skill can verify this
   - `done` → Inform user the docs skill should check documentation
   - `blocked` → Ask for blocker reason, suggest creating a sub-item for the blocker

### `block` — Mark as Blocked

1. Transition status to `blocked` via `anvil_update_entity`
2. Record blocker reason in work item body
3. Create journal entry with `#blocker` tag
4. If resolvable: suggest creating a new work item for the blocker itself
5. Recommend next work via orchestrator

### `list` — List Work Items for a Project

Call `anvil_query_view` with appropriate filters:
- By project: `filter: { type: "story", project: "{id}" }`
- Board format: `view: "board"`, `groupBy: "status"`
- Table format: `view: "table"`, `columns: ["title", "subtype", "status", "priority"]`

### `link` — Attach or Detach Linked Artifacts

Use when the user wants to associate or remove a design doc, spec, repo, or related story.

1. **Read current work item** via `anvil_get_note` to get existing field values and edges
2. **For each artifact to link:**
   - Design doc: `anvil_update_entity(fields: { design_doc: "<id>" })` + `anvil_create_edge(intent: "references")`
   - Spec: `anvil_update_entity(fields: { spec: "<id>" })` + `anvil_create_edge(intent: "references")`
   - Repo: `anvil_update_entity(fields: { repo: "<repo-name>" })`
   - Blocks story: `anvil_create_edge(sourceId: story_id, targetId: other_id, intent: "blocks")`
   - Related story (non-blocking): `anvil_create_edge(sourceId: story_id, targetId: other_id, intent: "references")`
3. **For each artifact to unlink:**
   - Design doc / spec: `anvil_update_entity(fields: { design_doc: null })` + `anvil_delete_edge`
   - Edge removal: `anvil_get_edges` to find the edge ID, then `anvil_delete_edge`
4. Confirm what was linked/unlinked

### `check-ac` — Check Off Acceptance Criteria

Use when the user wants to mark acceptance criteria items as done.

1. **Read work item body** via `anvil_get_note`
2. **Parse the `## Acceptance Criteria` section** — list all checklist items with their current state (`[ ]` or `[x]`)
3. **Present the list** to the user:
   ```
   Acceptance Criteria for #{id} — {title}:
   1. [x] {criterion — done}
   2. [ ] {criterion — pending}
   3. [ ] {criterion — pending}
   ```
4. **User specifies which to check off** (by number or text match)
5. **Replace the checklist items** in the body — change `[ ]` to `[x]` for checked items
6. **Update via `anvil_update_entity`** with the revised body
7. **If all criteria are checked:** note that the item is ready for `in_review` transition; offer to trigger it

### `detail` — View Full Work Item Details

1. Read via `anvil_get_note` — show all fields including `subtype`, `ceremony`, `repo`, `design_doc`, `spec`
2. **Load linked artifacts** via `anvil_get_edges`:
   - Design doc: read title and stage via `anvil_get_note`
   - Spec: read title and status
   - Blocking/blocked-by stories: list them
3. Query related plans via `anvil_search` with type `plan` and work_item reference
4. Query related journal entries (deviations, decisions)
5. Present: full spec, linked artifacts, plan status, recent journal entries, AC completion percentage

### `scope-change` — Handle Mid-Flight Scope Change

1. Log scope change in journal with `#scope-change` tag via `anvil_create_entity`
2. Update work item body with new/changed criteria via `anvil_update_entity`
3. Note changes in History table
4. If plan exists: developer skill revises plan (version bump)
5. If scope grew significantly: suggest splitting into new work item

## Body Content Templates by Subtype

**Feature:**
```
## Acceptance Criteria
- [ ] {criterion_1}
- [ ] {criterion_2}

## Technical Notes
{notes}

## Dependencies
- {dependency}

## History
| Date | From | To | By | Notes |
|------|------|----|----|-------|
```

**Bugfix:**
```
## Reproduction
1. {step}
2. {step}
Expected: {expected}
Actual: {actual}

## Fix Criteria
- [ ] {criterion}

## Root Cause
{to be filled after investigation}

## Technical Notes
{notes}

## Dependencies
- {dependency}

## History
| Date | From | To | By | Notes |
```

**Refactor:**
```
## Current State
{description of the code/structure as it is}

## Target State
{what we want it to become}

## Invariants
- {invariant_1}
- {invariant_2}

## Technical Notes
{notes}

## History
| Date | From | To | By | Notes |
```

**Spike:**
```
## Question
{what are we trying to learn?}

## Time Box
{duration}

## Approach
{how will we investigate?}

## Findings
{to be filled during spike}

## Recommendation
{promote to feature / abandon / needs more investigation}

## History
| Date | From | To | By | Notes |
```

**Hotfix:**
```
## Issue
- **Symptom:** {what's broken}
- **Impact:** {who/what is affected}
- **Urgency:** {why it needs immediate attention}

## Fix
{description of the fix}

## Verification
- [ ] {verification step}

## Follow-up
- [ ] Create bugfix for proper root cause (if band-aid)

## History
| Date | From | To | By | Notes |
```

**Task:**
```
## Deliverables
- [ ] {deliverable_1}
- [ ] {deliverable_2}

## Technical Notes
{notes}

## Dependencies
- {dependency}

## History
| Date | From | To | By | Notes |
```

**Chore:**
```
## Deliverables
- [ ] {deliverable_1}
- [ ] {deliverable_2}

## History
| Date | From | To | By | Notes |
```

## Anti-patterns

- Calling `forge_develop` or any Forge session/workspace tool — wrong model entirely.
- Creating a worktree inside another worktree. Always resolve `$ROOT` from the main checkout.
- Removing worktrees here — cleanup is owned by **sdlc-release**, after the PR merges.
