---
title: Your First Forge Code Session
description: How to start an isolated code session on a repo for a specific work item, using forge_develop.
slug: first-session
tags: [forge, session, onboarding, git, worktree]
schema_version: 1
keywords: [session, worktree, forge-develop, code, branch, git, isolate, coding, start-work]
related_commands: [horus status]
sidebar_position: 4
---

# Your First Forge Code Session

A **Forge session** is a git worktree on disk, tied to a single work item and a single repository. When you're ready to actually write code for a task — not just plan it, not just take notes — you start a session. The session gives you an isolated, feature-branched workspace that doesn't interfere with whatever else is checked out in your main clone of the repo.

Sessions are created by the **`forge_develop`** MCP tool. One call does everything: finds the repo, creates the worktree, checks out a feature branch, wires up the commit scripts, and hands you back a path to work in.

## Before you start

You need two things:

1. **A repo registered with Forge.** Run `forge_repo_list()` to see what Forge has indexed, or `forge_repo_resolve({ name: "..." })` to look up a specific one. Forge scans the `host_repos_path` you set during `horus setup` and auto-adds repos it finds.
2. **A work item in Anvil.** Sessions are namespaced by work item ID, so you need one before `forge_develop` will do anything. See `first-note` for how to create one.

## Create your first session

Ask Claude:

> "Start a code session for work item `<your-work-item-id>` on repo `<your-repo>`."

Or call the MCP tool directly:

```
forge_develop({
  repo: "my-project",
  workItem: "abc12345",
  branch: "feature/abc12345-initial-work"
})
```

Forge returns something like:

```json
{
  "status": "created",
  "sessionId": "sess-...",
  "sessionPath": "/Users/you/Horus/data/sessions/abc12345-my-project",
  "branch": "feature/abc12345-initial-work",
  "baseBranch": "main",
  "repo": "my-project",
  "repoSource": "managed"
}
```

The **`sessionPath`** is where you do all your work. It's a real git worktree — a separate working directory that shares the underlying git object store with your main clone of the repo. You can `cd` into it, edit files, run tests, and commit like you would in any other clone.

## What's in a session directory

When you open the session path, you'll see your repo checked out at the feature branch, plus one extra directory:

```
<sessionPath>/
  <your repo contents>
  .forge/
    scripts/
      commit.sh       # stage-aware conventional commit wrapper
      push.sh         # push to the right remote for this repo's workflow
      create-pr.sh    # create a PR against the correct target (handles fork vs owner vs contributor)
```

Always commit through `.forge/scripts/commit.sh <type> <scope> <description>`. It handles the conventional-commit formatting and picks up per-repo workflow metadata so you don't have to remember which remote to push to or what the target branch is. Same applies to `push.sh` and `create-pr.sh`.

## Resume a session

`forge_develop` is **idempotent** for the same work item + repo pair. If the session already exists, Forge resumes it instead of creating a new one:

```json
{
  "status": "resumed",
  "sessionId": "sess-...",
  "sessionPath": "...",
  "branch": "feature/abc12345-initial-work"
}
```

That means you can re-invoke `forge_develop` any time you restart an agent session or switch machines — it picks up where you left off without polluting your git state.

## Workflow confirmation on first use

The first time you create a session for a new repo, Forge may return:

```json
{ "status": "needs_workflow_confirmation", "detected": { ... } }
```

This is Forge asking: "I see a `fork` / `owner` / `contributor` workflow here — is that right?" Re-call `forge_develop` with the `workflow` parameter set to confirm. Forge saves the choice so future sessions on the same repo don't need the confirmation again.

## Clean up when the work is done

Sessions hang around until the linked work item transitions to `done` or `cancelled`. Once that happens, you can bulk-clean:

```
forge_session_cleanup({ auto: true })
```

This removes every session whose work item is complete. Or you can check for stale sessions manually:

```
forge_session_list()
```

## Sessions vs. workspaces

This trips up everyone the first time, so here it is one more time:

- A **workspace** is an agent *environment* — MCP configs, skills, CLAUDE.md, permissions. It doesn't touch any repo.
- A **session** is a git *worktree* — an actual checkout of a repo, tied to a work item.

You can have one workspace and ten sessions inside it, each working on a different story or repo. Or you can skip workspaces and create sessions directly — they work fine on their own.

## What's next

- **`horus guide first-note`** — create a work item in Anvil to link your session to
- **`horus guide first-workspace`** — set up an isolated agent context that wraps multiple sessions
- **`horus guide core-concepts`** — the mental model behind the workspace / session / repo split
