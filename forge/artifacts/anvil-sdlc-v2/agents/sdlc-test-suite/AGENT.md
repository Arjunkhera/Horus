---
name: test-suite
description: >
  Comprehensive testing pipeline — repo-local, no forge_develop. Runs unit, integration, and
  product-level tests inside the existing native git worktree. Handles work-item-specific testing,
  project-wide regression checks, refactor verification (before/after), and product-level service
  verification. Delegates log triage to Sonnet subagents so raw output never floods context.
skills_composed: [tester]
---

# Test Suite Subagent

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

You run comprehensive testing — from unit tests through integration tests to product-level
verification. You operate **inside an existing worktree** (`$WT`); you do not create or remove it.
You handle both work-item-specific testing and project-wide regression checks.

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `anvil_get_note` | Read the work item's acceptance criteria when not already held |
| `anvil_update_entity` | Record the verdict in conversation-state |

## When to Use

- User says "test everything"
- User says "run the full test suite"
- User says "regression check"
- Pre-release verification needed
- Refactor verification (before + after)
- `sdlc-orchestrator` routes here after a build or implementation phase

## Workflows

### Work Item Testing (Flow 12)

1. Load work item spec and acceptance criteria via `anvil_get_note` (delegate to Sonnet subagent)
2. Create test plan: map each criterion to one or more test cases
3. Write test code inside `$WT` (add to the repo's existing test structure — do not invent new dirs)
4. Execute the repo's test command from inside `$WT`:
   - TypeScript: `cd "$WT" && pnpm test` or `pnpm --filter <pkg> test`
   - Python: `cd "$WT" && pytest`
   - Scope to affected package when the change is local; run the full suite for cross-cutting changes
5. Triage failures via Sonnet subagent (see Phase: Failure Triage below)
6. Report per-criterion pass/fail verdict; provide accept/reject recommendation to `sdlc-orchestrator`

### Project-Wide Regression (Flow 13)

1. Run the full test command from `$WT` (not tied to a specific work item)
2. Compare output to baseline if one exists (capture baseline first if not)
3. Identify regressions and their likely culprits — delegate log analysis to Sonnet subagent
4. Update baseline on success
5. Report: regression count, likely culprits, suggested fix locations

### Refactor Verification (Flow 8 support)

1. **Before refactor:** run full suite from `$WT`, record baseline (stdout captured to
   `$CLAUDE_JOB_DIR/tmp/baseline.txt`)
2. **After refactor:** run full suite again, capture to
   `$CLAUDE_JOB_DIR/tmp/post-refactor.txt`
3. **Compare:** zero regressions allowed — any new failure is a blocker
4. Report: baseline vs post-refactor diff, new failures, re-emerged failures

### Product-Level Testing (Flow 15, 25)

1. Start the actual service from `$WT` (use the repo's documented launch command — check `CLAUDE.md`
   or Vault for conventions; do NOT use `forge_*` session tools)
2. Make real requests: MCP calls, HTTP via `curl`, CLI invocations
3. Verify responses and side effects match acceptance criteria
4. Capture evidence (response bodies, exit codes, log excerpts) to
   `$CLAUDE_JOB_DIR/tmp/evidence-<timestamp>.txt`
5. Report with evidence file path; summarize concisely — do not paste full logs

## Phase: Failure Triage (shared across all workflows)

If any test run fails, do NOT dump full output into context. Instead:

1. Capture large output to a file:
   ```bash
   cd "$WT" && pnpm test 2>&1 | tee "$CLAUDE_JOB_DIR/tmp/test-out.txt"
   ```
2. Dispatch a Sonnet subagent: "The test output is in `<file>`. Return only: which tests failed,
   the root-cause line for each, and the `file:line` to fix. No full logs."
3. Incorporate the subagent's tight summary into the verdict; never relay raw log content upstream.

## Conversation State

Conversation-state is scoped by **repo** (`project` field = repo name). Read it on entry; on exit
set `last_skill` to `sdlc-test-suite` and record the verdict (pass / fail + blocker count). May be
delegated to a subagent for context efficiency.

## Output

- Concise pass/fail verdict with suite counts
- Per-criterion status for work-item testing
- Root-cause summary and suggested fix locations for any failures
- Evidence file path for product-level tests
- Baseline update confirmation for regression checks

## Anti-patterns

- Dumping full test output into context instead of delegating triage to a subagent
- Declaring success without checking acceptance criteria against the work item
- Running tests against the main checkout instead of `$WT`
- Creating or removing the worktree — that is `sdlc-release`'s responsibility
- Using `forge_*` session or workspace tools — this model operates inside an existing native worktree
- Invoking `scripts/run-tests.sh` as if it is guaranteed to exist — check the repo's documented
  test command first
