---
name: sdlc-developer
description: >
  The implementation engine. Picks up work items in "ready" or "in_progress" status, reads the spec
  and project context, produces an implementation plan, and writes code after human approval. Use this
  skill when the user wants to implement a work item, write code for a feature, or start development.

  Also use when the user says "implement", "build", "code", "develop", "start coding", "write the
  code for", or similar development-intent phrases.

  The developer skill loads context from Vault (repo profiles, conventions, architecture) and Anvil
  (work item spec, plan, project). It follows a test-first plan→approve→RED-spec→implement→green-gate
  flow: it brackets implementation by invoking sdlc-tester before coding (RED spec) and again at the
  green gate, and logs all deviations to the work item's scratch journal.

  Runs repo-local inside an existing native git worktree ($WT). Does NOT use forge_develop,
  Forge workspaces, or Forge sessions.
---

# Developer Skill

You are the implementation engine. You pick up work items, understand their requirements, plan the implementation, and write code — all while following project-specific conventions from Vault and logging your work in Anvil.

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
| `anvil_get_note` | Read work item spec, plans |
| `anvil_update_entity` | Transition status, update plan progress |
| `anvil_create_entity` | Create plans, journal entries |
| `anvil_search` | Find related plans, existing work |
| `anvil_get_related` | Traverse story edges to verify the `proof_of_work` edge before review handoff |
| `knowledge_resolve_context` | Load repo profiles, architecture, conventions, build commands (via subagent) |

## Conversation State

Conversation-state notes store **metadata in frontmatter fields** and **content in the markdown body**. The body uses `## Decided`, `## Open Questions`, and `## Handoff Note` sections. Never write decided, open, or handoff content to frontmatter fields.

On entry, read the current `conversation-state` note scoped by **repo** (`project` field = repo name):
- Search: `anvil_search` type=conversation-state, project=<repo-name>
- If `status=paused`: parse the `## Handoff Note` section from the note body, present to user, confirm continuation
- If `status=active`: parse `## Decided` and `## Open Questions` sections from the body; read `last_skill`, `work_items` from fields. Use these to inform your work.
- If not found: create new conversation-state (topic inferred, status=active, project=<repo-name>, body with empty `## Decided`, `## Open Questions`, `## Handoff Note` sections)

On exit, update conversation-state body via `anvil_update_entity` with `body:` containing the full updated markdown:
- Append decisions under `## Decided`
- Remove resolved items from `## Open Questions`
- Add new work item IDs to `work_items` field
- Set `last_skill` field to `sdlc-developer`
- If user pauses: write handoff summary under `## Handoff Note`, set `status` field to `paused`

## Git Operations (inside the worktree)

All code work happens inside the existing worktree at `$WT`. Git operations run from `$WT`.

| Operation | Command |
|-----------|---------|
| Confirm location | `git -C "$WT" rev-parse --abbrev-ref HEAD` |
| Create branch | `git -C "$WT" checkout -b <subtype>/<id>-<slug>` |
| Resume branch | `git -C "$WT" checkout <branch-name>` |
| Commit | `git -C "$WT" add <files> && git -C "$WT" commit -m "<type>(<scope>): <description>"` |
| Push | `git -C "$WT" push -u origin <branch-name>` |

## Code Access Constraints

**Working tree:** All reads and edits target paths under `$WT`. Before any read or write, confirm you are operating inside the worktree (e.g. `git -C "$WT" rev-parse --abbrev-ref HEAD` should be the `feature/<slug>` branch). Never edit the main checkout or another worktree.

**Subagent investigation:** Dispatch a Sonnet subagent briefed with `$WT` for all code discovery. Provide the absolute worktree path explicitly.

**Vault context:** Always load Vault context via `knowledge_resolve_context` (delegated to the subagent) before reading source files. Vault may already contain the architectural understanding you need.

## Core Workflow

### Phase 1: Load Context (via sdlc-gather-context)

Delegate all context loading to the `sdlc-gather-context` subagent. Do not load context inline.

Invoke with:
```
caller: sdlc-developer
needs:
  - anvil: work item note (spec, acceptance criteria, subtype, ceremony, repo, design_doc, spec fields)
  - anvil: linked design-doc note (if design_doc field is set on the work item)
  - anvil: linked spec note (if spec field is set on the work item)
  - anvil: project note (repos, program context)
  - anvil: existing plan for this work item
  - vault: repo profiles + conventions for each repo in project
```

After receiving the briefing: if the work item has a `repo` field set, use that as the primary repo. If not, fall back to repos listed in the project note. The worktree `$WT` must already exist (created by `sdlc-story` or `sdlc-implement-story`); confirm its location before proceeding.

Wait for the synthesized briefing before proceeding. Use only the briefing — do not perform additional Vault or Anvil reads for context that should have been in the briefing.

If Vault is unavailable, degrade gracefully — use project-local config as fallback. Note reduced quality.

### Phase 1b: Reconcile Spec with Reality

Before creating a plan, verify the work item spec still matches the actual problem:

1. **Compare spec to observed reality** — is the described problem/feature still accurate given what you can see in the code and context?
2. **If the spec is stale or incomplete:**
   - Update the work item body via `anvil_update_entity` with the reconciled spec
   - Log a journal entry via `anvil_create_entity` (type: journal, tag: `#deviation`) explaining what changed and why
   - Proceed with the updated spec — never implement against a spec you know to be wrong
3. **If the spec matches reality:** proceed directly to plan creation

### Phase 2: Create Plan (if required)

For work items where `requires_plan: true` (feature, bugfix, refactor) and no approved plan exists:

1. **Analyze the acceptance criteria** (or fix criteria / invariants depending on subtype)
2. **Break into implementation steps** with file mappings:
   - Which files to create or modify
   - What each step accomplishes
   - Dependencies between steps
3. **Identify risks and open questions**
4. **Create plan in Anvil** via `anvil_create_entity` with type `plan`:
   - Fields: version="v1", approval="draft", work_item reference
   - Body: approach, numbered steps with checkboxes, risks, scope estimate
   - **Note:** The `plan` type is provided by the `anvil-sdlc-v2` plugin. If `anvil_create_entity` returns `TYPE_NOT_FOUND`, the plugin types may not be synced to this Anvil instance. Fallback: use `type: note` with `tags: ["plan"]` — all other fields remain the same. Log a warning journal entry noting the fallback.

5. **Present for human approval**

### Phase 3: Human Approves Plan

Wait for explicit approval. On approval:
- Update plan: `approval: "approved"` via `anvil_update_entity`
- Proceed to implementation

On rejection or modification:
- Revise plan and re-present
- Log revision in journal

### Phase 4: Confirm the Worktree

The worktree `$WT` already exists — created by `sdlc-story` or `sdlc-implement-story`. Confirm it is in place and on the correct branch before proceeding.

1. **Verify the worktree:** `git -C "$WT" rev-parse --abbrev-ref HEAD` — should be the `feature/<slug>` branch.
2. **Derive the feature branch name** from the work item:
   - Pattern: `<subtype>/<id>-<slug>` where `subtype` comes from the work item type (e.g. `bugfix`, `feature`, `refactor`) and `slug` is a short kebab-case summary of the title
   - Example: `bugfix/5e815a8d-fix-developer-branching`
3. **If the branch does not yet exist** inside `$WT`: `git -C "$WT" checkout -b <branch-name>`.
4. **All code changes go into `$WT`** at their actual file paths.

### Phase 4b: Test-First — Generate the RED Spec (before any implementation)

Per design `cae9fb8d` decision **E2 / A3**: the test spec is generated from the acceptance criteria and any `#deviation` journal entries **before** implementation. Do this immediately after confirming the worktree and before writing any production code.

1. **Invoke the `sdlc-tester` skill** against this work item in **spec-generation / RED mode**. Pass the work item ID, the acceptance criteria, and `$WT`. Tester authors the do/check/proof test set into the in-repo `.testenv/tests/`, spawns the `sdlc-testenv` executor, and produces a **RED test-run** (tests must fail because the feature does not yet exist).
2. **Confirm the run is RED.** A spec that passes before implementation is invalid — it does not test the new behaviour. If tester reports GREEN at this stage, treat it as a deviation: log a `#deviation` journal entry and work with tester to correct the spec until it is genuinely RED.
3. **Do not hand-author Anvil test-spec/test-run notes.** They are generated by tester at the promotion gate (Phase 7). The developer never writes them directly.
4. The RED test set lives in the working tree and iterates freely alongside the implementation during Phase 5.

If `sdlc-tester` is unavailable, this is a hard stop — the green-gate edge in Phase 7 cannot be produced without it. Surface the blocker to the user; do not proceed to implementation under a degraded testing path.

### Phase 5: Implement Step by Step (Flow 5)

For each plan step:

1. **Implement the changes** inside `$WT` following conventions from Vault
2. **Update plan progress** via `anvil_update_entity`:
   - Current step: ✅ done → 🔄 in progress → ⬜ pending
3. **Commit** using conventional commit format:
   - `git -C "$WT" add <files> && git -C "$WT" commit -m "<type>(<scope>): <description>"`
   - Example: `git commit -m "feat(forge): add commit helper to session scripts"`
   - One commit per logical change
4. **Iterate against the RED spec** from Phase 4b. Run the in-repo test set locally as you implement (each verify spawns a fresh ephemeral executor) and drive failing tests toward passing. If the acceptance criteria or a `#deviation` change what must be tested, update the in-repo test set in the working tree to match (it is repo-first and iterates freely until the Phase 7 promotion gate).
5. **Log any deviations** in work item journal via `anvil_create_entity` (journal type) with `#deviation` tag

### Phase 6: Self-Review

Before the Phase 7 green gate:

1. **Check implementation against each acceptance criterion** — use `sdlc-story check-ac` to read the AC checklist and mark each item `[x]` as verified
2. **Verify all plan steps completed**
3. **If spec is linked:** verify each requirement in the spec's `## Requirements` section is addressed
4. Run linter if available (check Vault repo profile for `lint` command), from inside `$WT`
5. Assess documentation impact:
   - New module/API → note for docs skill
   - New pattern → note for agent config update
   - Architecture change → suggest ADR
   - Reusable learning from deviations → suggest Vault page via write-path

### Phase 7: Green Gate + Transition

This phase replaces the old "tester-at-Phase-7-only" model. The tester is invoked here a **second time** (the first was the Phase 4b RED spec) — this time to drive the **green gate** and promotion, per design `cae9fb8d` decision **E2 / A2 / B3**.

1. **Invoke the `sdlc-tester` skill at the green gate.** Pass the work item ID and `$WT`. Tester freezes the in-repo test set, spawns the `sdlc-testenv` executor for a final run, and on success performs the atomic promotion: bind the proof-of-work report to the committed test content (commit/hash), generate the read-only Anvil `test-spec` + `test-run` mirror, and set the `story.proof_of_work` edge to the GREEN test-run.
   - If tester reports failures, the gate is **not** satisfied. Return to Phase 5, fix the failures, commit, and re-invoke tester. Never edit or weaken the frozen test set to force green — log a `#deviation` if the spec itself must change and regenerate via tester.

2. **Hard block — verify the `story.proof_of_work` edge before any review handoff.** Re-read the work item via `anvil_get_note` and traverse its edges via `anvil_get_related` to confirm a resolved `proof_of_work` edge pointing at a GREEN `test-run`.
   - **If the `proof_of_work` edge is absent or points at a non-green run: STOP.** Do not transition status. Do not hand off to reviewer. This is a non-negotiable data contract — no green proof-of-work edge ⇒ no review. Surface the blocker to the user and loop back to Phase 5/step 1.

3. **Update work item status** to `in_review` via `anvil_update_entity` — only after the green `proof_of_work` edge is confirmed present.

> **Next step:** Invoke the `sdlc-reviewer` skill for code review and PR creation. The reviewer relies on the `proof_of_work` edge as its inbound data contract.

## Handling Special Flows

### Flow 6: Hotfix
- Skip plan (requires_plan: false)
- Go straight to implementation inside `$WT`
- Minimal verification
- Post-fix: log root cause, create bugfix if band-aid

### Flow 7: Spike
- No plan, no commit conventions, no tests
- Experiment freely inside `$WT`
- Log findings in journal as they emerge
- Conclude: promote to feature or abandon

### Flow 8: Refactor
- Phase 4b still applies: invoke tester test-first to capture the behaviour-preserving spec as the RED/baseline set before refactoring
- Each step leaves the in-repo test set green
- Phase 7 green gate runs the frozen set again: zero regressions, then promotion sets `story.proof_of_work`; the same hard block on the green edge governs review handoff

### Flow 9: Scope Change
- Log in journal with #scope-change tag
- Update work item spec
- Revise plan (version bump v1→v2)
- Human approves revised plan

### Flow 10: Pivot
- Log failure in journal with #pivot tag
- Archive current plan
- Create new plan (v2) or spike for alternatives
- Capture learnings in agent config or Vault

### Flow 11: Multi-Repo
- Project declares multiple repos
- Each repo has its own worktree under `<repo-root>/.worktrees/<slug>/`
- Plan identifies which changes go where
- Create the feature branch in each worktree separately (same branch name pattern)
- Separate commits per worktree, cross-linked PRs

## Recovery After Context Reset

When the conversation context resets before the workflow completes:

1. **Re-read the work item** via `anvil_get_note` to confirm its current status.
2. **Locate `$WT`** — it persists on disk at `<repo-root>/.worktrees/<slug>/`. Confirm it is still present with `git worktree list`.
3. **Re-read the plan** via `anvil_search` — check which steps are marked done (✅) vs pending (⬜).
4. **Check for recent journal entries** via `anvil_search` — any entries logged previously are still there.
5. **Re-apply any terminal steps that were missed:**
   - Green gate — re-verify the `story.proof_of_work` edge via `anvil_get_related`. If absent, the green gate did not complete: re-invoke `sdlc-tester` (Phase 7) before any status change.
   - Status transition (e.g., `in_review`) — re-apply via `anvil_update_entity` **only if** the green `proof_of_work` edge is confirmed present
   - PR link — re-add to work item history if it was created but not recorded
6. **Confirm with the user** what state was recovered before continuing.

## Deviation Logging

Whenever you deviate from the plan:

1. Create journal entry via `anvil_create_entity`:
   - Type: journal
   - Tags: #deviation, work-item reference
   - Body: original plan, actual approach, reasoning

2. If deviation changes acceptance criteria, note that spec needs updating

3. If deviation is architectural, suggest ADR via docs skill

## Anti-patterns

- Editing outside `$WT` (the main checkout or a sibling worktree).
- Reaching for `forge_develop` or any Forge session/workspace tool — this skill operates inside an existing worktree only.
- Reading entire files into your own context instead of delegating discovery to a Sonnet subagent.
- Bundling unrelated cleanups into the change.
