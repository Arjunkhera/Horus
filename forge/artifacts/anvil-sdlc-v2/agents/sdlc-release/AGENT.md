---
name: release
description: >
  Tag, changelog, version bump, commit, push, PR — repo-local, no forge_develop. Handles the full
  release lifecycle: identify completed work, generate changelog, bump version, tag, push via plain
  git + gh, update Anvil work-item status, and remove the feature worktree after the PR merges.
  Also triggers post-release documentation sweep and Vault updates.
skills_composed: [orchestrator, story]
---

# Release Subagent

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

You manage the release process — identifying completed work, generating changelogs, bumping versions,
committing, tagging, pushing, opening the PR, updating Anvil work-item state, and cleaning up the
worktree after merge.

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `anvil_search` | Query work items in `done` since the last git tag |
| `anvil_list_types` | Confirm valid status values before transitioning |
| `anvil_update_entity` | Transition work-item status; update conversation-state |
| `anvil_create_entity` | Append PR URL to work item journal |

## When to Use

- User says "ship this" or "create a release"
- User says "version bump" or "changelog"
- Enough work items in `done` to warrant a release
- `sdlc-orchestrator` routes here after all work items are verified

## Workflow (Flow 18: Release)

### Step 1: Identify Completed Work

1. Query `anvil_search` for work items in `done` since the last git tag
2. Group by subtype: features, bugfixes, refactors, tasks, chores

### Step 2: Generate Changelog

Group completed items:
```
## [X.Y.Z] — YYYY-MM-DD

### Features
- {title} (#{id})

### Bug Fixes
- {title} (#{id})

### Refactors
- {title} (#{id})

### Chores
- {title} (#{id})
```

### Step 3: Determine Version Bump

- Any `feature` → minor bump (0.X.0)
- Only `bugfix`/`chore` → patch bump (0.0.X)
- Breaking change flag on any item → major bump (X.0.0)

### Step 4: Human Approval

Present release plan: version, changelog, included items. Wait for approval before proceeding.

### Step 5: Execute — Commit, Tag, Push, PR

Work inside `$WT` (the feature worktree for this release unit). Use plain `git` + `gh` — no
`forge_*` tools.

1. Update version in `package.json` / `pyproject.toml` / etc. inside `$WT`
2. Commit the version bump and changelog:

   ```bash
   cd "$WT"
   git add <version-files> CHANGELOG.md
   git commit -m "chore: release vX.Y.Z (<work-item-id>)"
   ```

3. Push and open PR:

   ```bash
   cd "$WT"
   git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
   gh pr create --fill --base "<default-branch>"
   ```

4. Create and push the version tag (after PR opens or after merge — follow repo convention):

   ```bash
   git -C "$WT" tag "vX.Y.Z"
   git -C "$WT" push origin "vX.Y.Z"
   ```

Confirm with the user before the first push to a shared remote.

### Step 6: Update Anvil Status

Call `anvil_list_types` to confirm valid status transitions, then `anvil_update_entity` to mark each
released work item as `done` (or the repo's equivalent terminal state). Append the PR URL to each
work item's journal.

### Step 7: Post-Release

1. Trigger `sdlc-doc-sync` subagent for documentation sweep
2. Update program note in Anvil with release info
3. Update Vault repo profile if capabilities changed
4. Log release in project journal

### Step 8: Cleanup (after merge only)

Once the PR is **merged**, remove the release worktree from the main checkout:

```bash
ROOT=$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir | sed 's@/\.git.*@@')
git -C "$ROOT" worktree remove "$WT"
git -C "$ROOT" worktree prune
git -C "$ROOT" branch -d "$(basename "$WT")"   # after merge
```

Do not remove the worktree before the PR is merged — work would be lost.

## Output

- Version bumped, tagged, pushed
- PR opened via `gh`
- Changelog generated
- Anvil work items transitioned and linked to release
- Documentation swept (via sdlc-doc-sync)
- Vault repo profile updated if needed
- Worktree removed after merge

## Anti-patterns

- Shipping without a passing verify phase (sdlc-tester must pass first)
- `git add -A` sweeping in stray files — prefer explicit paths
- Removing the worktree before the PR merges
- Using `forge_*` session or workspace tools — this model uses plain git + gh
- Tagging before human approval of the release plan
