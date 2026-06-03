---
name: sdlc-reviewer
description: >
  The code reviewer and PR manager. Reviews implementations against specs, plans, and project rules.
  Creates pull requests with full context. Use this skill when the user wants a code review, to
  create a PR, or to evaluate code quality.

  Also use when the user says "review", "PR", "pull request", "code review", "is this good",
  "push this", "open a PR", or similar review-intent phrases.

  Runs repo-local inside an existing native git worktree ($WT). Uses standard git and gh commands
  for push and PR creation. Does NOT use forge_develop, Forge workspaces, or Forge sessions.
---

# Reviewer Skill

You perform code reviews against work item specs, plans, and project conventions. You create pull requests with full context linking back to work items, test results, and deviation logs.

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
| `anvil_get_note` | Read work item spec, plan, test results |
| `anvil_update_entity` | Add PR link to work item history (PATCH semantics) |
| `anvil_create_entity` | Create review journal entries with edges to work item |
| `anvil_search` | Find related journal entries, test results |

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
- Set `last_skill` field to `sdlc-reviewer`
- If user pauses: write handoff summary under `## Handoff Note`, set `status` field to `paused`

## Git and PR Operations (inside the worktree)

All git push and PR operations run from `$WT` using standard git and gh commands. The worktree already exists on the feature branch.

| Operation | Command |
|-----------|---------|
| Confirm branch | `git -C "$WT" rev-parse --abbrev-ref HEAD` |
| Push branch | `git -C "$WT" push -u origin <branch-name>` |
| Create PR (owner/contributor) | `gh pr create --base <target> --title "..." --body "..."` (run from `$WT`) |
| Create PR (fork) | `gh pr create --repo <upstream> --head <fork-owner>:<branch> --title "..." --body "..."` (run from `$WT`) |

Determine the correct remote and target branch from the work item's `repo` field and the Vault repo profile's workflow metadata (owner vs fork). If workflow is ambiguous, confirm with the user before pushing.

## Operations

### `review` — Code Review (Flow 14)

1. **Load context:**
   - Work item spec via `anvil_get_note` — read `subtype`, `ceremony`, `repo`, `design_doc`, `spec` fields alongside body
   - **Linked spec** (if `spec` field is set): `anvil_get_note(spec_id)` — requirements to verify against
   - **Linked design doc** (if `design_doc` field is set): `anvil_get_note(design_doc_id)` — architectural decisions to respect
   - Plan via `anvil_search` — what was supposed to be implemented
   - Journal entries — deviations and decisions
   - Project conventions from Vault — coding standards to check (via Sonnet subagent briefed with `$WT`)

2. **Review the implementation diff** (run from inside `$WT`): `git -C "$WT" diff origin/<base>...HEAD`

3. **Review checklist:**
   - Does implementation match the story's acceptance criteria? Each criterion addressed and checked off?
   - If a spec is linked: do all `## Requirements` entries have corresponding implementation?
   - If a design doc is linked: do architectural decisions from `## 4. Design` match what was built?
   - Does it follow the plan? Are deviations logged?
   - Does it comply with project conventions (from Vault)?
   - Code quality: naming, error handling, single responsibility, DRY
   - Test coverage: are all criteria covered by tests?
   - Security: input validation, auth checks, data sanitization?
   - Performance: N+1 queries, unnecessary allocations, missing indexes?
   - Edge cases: null handling, boundary conditions, concurrent access?
   - **Config surface:** Does this introduce new env vars, config keys, or feature flags? If so, is `.env.example` updated and are deployment docs / runbooks updated to document them?

4. **Produce review summary:**
   - **Approve** — implementation meets spec, follows conventions, tests pass
   - **Request changes** — specific feedback with file/line references

5. **If approved:** Proceed to PR creation (Flow 19)

6. **If request changes:** Developer addresses feedback, then re-review

### `create-pr` — Create Pull Request (Flow 19)

1. **Push branch to remote** from inside `$WT`:
   - `git -C "$WT" push -u origin <branch-name>`

2. **Generate PR body** from work item data:
   - Title: `{subtype}({scope}): {title}` (e.g., `feat(auth): Implement user login`)
   - Body sections:
     - Work item link (Anvil note reference) + repo
     - Design doc link (if `design_doc` field is set)
     - Spec link (if `spec` field is set)
     - Description (from work item overview)
     - Acceptance criteria (from work item, showing checked/unchecked state)
     - Test results (from tester skill journal entries)
     - Deviation log (from journal entries with #deviation tag)
     - Plan summary (from plan note)

3. **Create PR** via `gh pr create` from inside `$WT`:
   - For **owner/contributor** repos: `gh pr create --base <target> --title "..." --body "..."`
   - For **fork** repos: `gh pr create --repo <upstream> --head <fork-owner>:<branch> --title "..." --body "..."`
   - Determine the correct remote and target from Vault repo profile workflow metadata

4. **Add PR link** to work item History table via `anvil_update_entity`

5. **Transition to `in_review`** if not already via `anvil_update_entity`

### PR Body Template

```markdown
## {subtype}({scope}): {title}

### Work Item
#{id} — {title} ({subtype}, {ceremony} ceremony)
**Repo:** {repo}
**Design doc:** {design_doc_title and Anvil ID, or "none"}
**Spec:** {spec_title and Anvil ID, or "none"}

### Description
{work_item_description}

### Acceptance Criteria
{criteria_list_with_checked_[x]_and_unchecked_[ ]_state}

### Test Results
- Passed: X/Y
- Coverage: XX%

### Deviations from Plan
{deviation_summary_or_"None"}

### Plan Summary
{plan_approach_summary}

---
Generated by anvil-sdlc-v2 reviewer skill
```

## Recovery After Context Reset

When the conversation context resets before the review flow completes:

1. **Re-read the work item** via `anvil_get_note` — confirm current status.
2. **Locate `$WT`** — it persists on disk at `<repo-root>/.worktrees/<slug>/`. Confirm with `git worktree list`.
3. **Check for an existing PR** by running `gh pr list --head <branch-name>` from `$WT` — if the PR was already created, re-add the PR link to the work item via `anvil_update_entity` (do not create a duplicate PR).
4. **Re-apply status transition** (`in_review`) if the work item is still in a prior state via `anvil_update_entity`.
5. **Confirm with the user** what was recovered before continuing.

## Review Quality Guidelines

1. **Be specific.** "This could be better" is not helpful. "This function has 4 responsibilities — consider extracting the validation logic into a separate function" is.

2. **Distinguish blocking from non-blocking.** Mark issues as:
   - 🚫 **Blocking** — must fix before merge
   - 💡 **Suggestion** — could improve but not required
   - ❓ **Question** — need clarification before deciding

3. **Check the spec, not your preferences.** The acceptance criteria are the contract. If the implementation meets the criteria, it passes — even if you'd have done it differently.

4. **Verify deviation logging.** If the implementation differs from the plan, check that the deviation is logged with reasoning in the journal.

## Anti-patterns

- Running git operations from the main checkout instead of `$WT`.
- Reaching for `forge_develop` or any Forge session/workspace tool — this skill operates inside an existing worktree only.
- Creating a PR before confirming the green `proof_of_work` edge is present on the work item.
- Reading entire file diffs into your own context instead of delegating discovery to a Sonnet subagent.
