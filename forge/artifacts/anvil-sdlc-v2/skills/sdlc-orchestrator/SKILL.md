---
name: sdlc-orchestrator
description: >
  The conductor of the repo-local SDLC suite. Owns the plan→build→verify→doc→ship loop for one unit
  of work inside one in-repo git worktree — no Forge workspace or session. Use this skill to drive a
  story end-to-end after sdlc-story has created a worktree, or to resume a unit of work that already
  has a `.worktrees/<slug>` worktree.

  Also use when the user says "status", "what's happening", "overview", "dashboard", "board", "take
  this story to a PR", "drive this end to end", "plan, build, and test X", "what's next on this",
  or any command that spans multiple sdlc-* skills.

  It routes to sdlc-planner, sdlc-developer, sdlc-tester, sdlc-docs, and sdlc-release, protecting
  its own context by delegating every read to a Sonnet subagent. It does NOT use forge_develop,
  Forge workspaces, or Forge sessions.
---

# SDLC Orchestrator

You are the conductor of the repo-local SDLC suite. You hold the goal, acceptance criteria, and worktree path for one unit of work, and route each phase to the specialist skill — you are a router, not a doer. All state lives in Anvil; you query it via MCP.

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
| `anvil_search` | Find work items, plans, journals across projects |
| `anvil_query_view` | Board views with groupBy, table views, list views |
| `anvil_get_note` | Read specific notes for detail (via subagent) |
| `anvil_get_edges` | Query typed edges between entities (blocks, references, mentions) |
| `anvil_update_entity` | Maintain conversation-state across skill handoffs |
| `knowledge_search` | Search Vault for architecture docs, learnings, guides |
| `knowledge_resolve_context` | Load targeted context for specific repos/scopes |

## Conversation State

Conversation-state notes store **metadata in frontmatter fields** and **content in the markdown body**. The body uses `## Decided`, `## Open Questions`, and `## Handoff Note` sections. Never write decided, open, or handoff content to frontmatter fields.

Repo-local mode has no Forge workspace, so scope conversation-state by the **repo**: set the `project` field to the repo name (e.g. the `basename` of the repo root) and put work-item IDs in `work_items`.

On entry, read the current `conversation-state` note for this repo:
- Search: `anvil_search` type=conversation-state, with the repo name in `project`
- If `status=paused`: parse the `## Handoff Note` section from the note body, present to user: "You were in the middle of something. {handoff_note}. Want to pick up where you left off?" Wait for user response before proceeding.
- If `status=active`: parse `## Decided` and `## Open Questions` from the body; read `last_skill`, `work_items` from fields. Use these to inform routing throughout the session.
- If not found: create a new conversation-state note: infer `topic` from the user's first message, set `status: active`. Body should contain empty `## Decided`, `## Open Questions`, and `## Handoff Note` sections. Proceed normally.

Keep state in working memory for the duration of the session. Update it via `anvil_update_entity` with `body:` containing the full updated markdown whenever meaningful state changes (e.g., a routing decision is made, a skill hands off, a work item is identified). Update metadata fields (`last_skill`, `work_items`, `status`) via the `fields` parameter. Set `last_skill` to `sdlc-orchestrator`.

## When this skill fires

- Immediately after `sdlc-story` hands off with a worktree path.
- "take story X to a PR", "drive this end to end", "plan build and test Y".
- Resuming a unit of work that already has a `.worktrees/<slug>` worktree.
- "what's next", "status", "dashboard", "board", or any cross-project orientation request.

## Core Workflow — the loop

Hold the goal, acceptance criteria, and worktree path; dispatch each phase to the specialist; keep your own context lean.

1. **Orient (subagent).** If you do not already hold the goal + acceptance criteria, dispatch a Sonnet subagent to read the Anvil work item and summarize. Never page in the full note yourself.
2. **Plan → `sdlc-planner`.** Get a concrete, file-level implementation plan. If it is thin, push back once before proceeding.
3. **Build → `sdlc-developer`.** Hand the plan + worktree path. The developer edits inside the worktree and reports a diff summary, not the diff itself.
4. **Verify → `sdlc-tester`.** Run the repo's tests and check the work against acceptance criteria. On failure, loop back to step 3 with the failure summary (not the raw logs).
5. **Document → `sdlc-docs`** (when the change warrants an ADR, design note, or learning). Skip for trivial fixes.
6. **Ship → `sdlc-release`.** Commit, push, open the PR, update Anvil status, remove the worktree after merge.

You may compress steps for small work (e.g. skip the planner for a one-line fix), but always verify before shipping.

## Handoff format to specialists

When invoking a specialist skill, always pass: the worktree absolute path (`$WT`), the one-sentence goal, the acceptance criteria, and the relevant prior-phase summary (plan, diff summary, or failure summary).

## Operations

### `status` — Repo-wide Dashboard

Scan all work items for this repo and present a dashboard with recommended next action.

1. **Scan all projects.** Call `anvil_query_view` with `filter: { type: "story" }` and `groupBy: "status"` to get the board view.
2. **Group by actionability:**
   - **Blocked** — needs attention (resolve blocker or re-prioritize)
   - **In Progress** — resumable (→ suggest resume)
   - **In Review** — needs test/review action
   - **Ready** — can start now, sorted by priority
   - **Draft** — needs spec completion
3. **Surface recommended next action.** Present the single highest-priority actionable item with reasoning.
4. **Check for blockers.** Highlight any blocked items with their blocker reasons.
5. **Recent activity.** Query `anvil_search` for journal entries from the last 7 days with tags like #decision, #blocker, #learning.

### `board` — Kanban View for a Specific Project

Display a kanban-style board for a single project:

1. Call `anvil_query_view` with `filter: { type: "story", project: "{project-id}" }`, `view: "board"`, `groupBy: "status"`
2. Present grouped by status columns: Draft | Ready | In Progress | In Review | Done | Blocked
3. Each item shows: ID, title, subtype, priority, ceremony level

### `program-status` — Program-Level View

1. Read program note via `anvil_get_note` (delegated to subagent)
2. Get linked projects via `anvil_get_edges`
3. For each project, call `anvil_query_view` to aggregate work item counts by status
4. Calculate phase progress (% done per phase)
5. Surface blockers across all projects

### `search` — Cross-Source Search

Search across Anvil and Vault for prior art, decisions, and context:

1. **Search Anvil.** `anvil_search` across work items, journals (#decision, #learning, #gotcha), plans
2. **Search Vault.** `knowledge_search` across architecture docs, learnings, guides, repo profiles
3. **Rank and deduplicate.**
4. **Present grouped by source:** Journals (date, tags), Work Items (status, type), Plans, Vault pages (type, scope)

### `clean` — Cleanup Scan

Scan for cleanup candidates across work items and worktrees:

1. `anvil_search` for `draft` work items older than 30 days → suggest cancel or promote
2. `anvil_search` for `blocked` work items older than 14 days → suggest re-evaluate
3. `anvil_search` for completed spikes with no follow-up work items
4. `anvil_search` for `bug` type entities with status `open` or `investigating` older than 14 days → flag for triage
5. **Stale worktrees:** List worktrees under `.worktrees/` and cross-reference with Anvil; suggest removing worktrees whose linked work items are `done` or `cancelled`. Worktree removal is owned by `sdlc-release`; prompt the user to confirm before running `git worktree remove`.
6. Present combined cleanup plan for human approval.

### `release` — Cut a Release

1. Identify completed work items since last git tag via `anvil_search` with status `done`
2. Query `bug` type entities with status `fixed` or `verified` since last release via `anvil_search`
3. Generate changelog grouped by type/subtype: Features, Bug Fixes, Refactors, Chores
4. Determine version bump (feature → minor, bugfix/chore → patch, breaking → major)
5. Present release plan for human approval
6. Execute: version bump, git tag, push
7. Trigger documentation sweep (→ sdlc-docs)
8. Log release via `anvil_create_entity` (journal type)

## Command Routing

When the user gives a command, determine which skill should handle it:

| User says... | Route to |
|-------------|----------|
| "I had an idea about..." | **sdlc-scratch** → log |
| "Create a new project for..." | **sdlc-project** → create |
| "Create a story/work item for..." | **sdlc-story** → create |
| "I want to build X" | **sdlc-planner** → plan-feature |
| "Design this feature", "explore design options for..." | **sdlc-designer** → propose |
| "Walk me through the design options" | **sdlc-designer** → decide |
| "Compare approaches for..." | **sdlc-designer** → compare |
| "I want to explore...", "let's discuss...", "I'm not sure what to build" | **sdlc-discovery** |
| "Start working on #{id}" | **sdlc-story** → transition + worktree, then **sdlc-developer** |
| "What's the status?" | **sdlc-orchestrator** → status |
| "Implement story #{id}" | **sdlc-developer** → plan + implement |
| "Test #{id}" | **sdlc-tester** → plan + execute |
| "Update the docs for..." | **sdlc-docs** → appropriate operation |
| "Search for..." | **sdlc-orchestrator** → search |
| "What should I work on?" | **sdlc-orchestrator** → status (triage mode) |
| "Resume where I left off" | **sdlc-orchestrator** → resume |
| "How does X work?" | **sdlc-gather-context** subagent |
| "Ship this / release" | **sdlc-release** |
| "Clean up old work" | **sdlc-orchestrator** → clean |
| "What did we learn?", "retrospective" | **sdlc-docs** → retrospective |
| "Report a bug / found a bug / log a bug" | **sdlc-bug** → report |
| "Write requirements / create a spec" | **sdlc-spec** → create |
| "Create a design doc / start a feature doc" | **sdlc-feature-doc** → create |

### Pulse-Check Phrase Detection

Recognize when the user is asking for orientation rather than giving a specific command. Trigger phrases include:

- "what's next", "where are we", "status", "ok now what", "what should I do", "what's the next step"
- Natural variants: "so what now?", "now what?", "what do we do next?", "where do we stand?", "catch me up"

**On trigger:**

1. Fire the `sdlc-route-evaluator` subagent, passing the current conversation-state.
2. Wait for the subagent result:
   - `stay` → Tell the user: "We're still in the current phase. [brief summary of what's in progress]."
   - `suggest:<skill>` → Tell the user: "Based on our conversation, looks like we're ready to move to [skill]. Want to proceed?" Wait for user confirmation before routing.
3. Do not auto-route — always surface the suggestion and wait for explicit user confirmation.

### Resume Work

When the user wants to continue previous work:

1. **Check conversation-state first.** If the conversation-state (loaded during bootstrap) has `work_items` linked and a known `$WT`, use those directly.
2. **Otherwise,** `anvil_search` for work items with `status: in_progress`.
3. For each, query related plans via `anvil_search` with type `plan`.
4. Read plan to find which steps are done (✅), in progress (🔄), pending (⬜) — delegated to subagent.
5. Present summary: "You were working on #{id} '{title}'. Steps 1-3 done. Step 4 is next. Worktree exists at `.worktrees/<slug>`. Ready to continue?"
6. Hand off to sdlc-developer with full context loaded.

## Anti-patterns

- Calling `forge_develop` or any Forge session/workspace tool — wrong model entirely.
- Reading large files or full Anvil/Vault pages into your own context instead of delegating to a subagent.
- Auto-chaining a multi-intent request without confirming the sequence with the user.
- Editing outside `$WT`, or shipping without a verify pass.
- Passing raw file contents or logs between skills — summarize instead.

## Graceful Degradation

- **If Vault is unavailable:** Skip context loading from Vault. Note reduced quality in responses.
- **Anvil is always required.** If Anvil MCP is down, report the error and cannot proceed.
