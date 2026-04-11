---
title: Your First Forge Workspace
description: What a Forge workspace is, how it differs from a code session, and how to create your first one.
slug: first-workspace
tags: [forge, workspace, onboarding]
schema_version: 1
keywords: [workspace, forge, context, isolation, mcp, skills, plugins, environment]
related_commands: [horus status]
sidebar_position: 3
---

# Your First Forge Workspace

A **Forge workspace** is an isolated agent context — a bundle of MCP configs, installed skills, environment variables, and permission settings — that Claude loads when you're working on something specific. Workspaces do **not** clone code. That's what sessions are for (see `first-session`).

Think of a workspace as "the agent environment for working on project X", and a session as "the git worktree where I'm actually editing code for story Y inside project X". One workspace, many sessions.

## Why workspaces exist

Without workspaces, every Claude session shares the same MCP tools, skills, and environment. That's fine at first, but as you start using Horus for real work you'll notice:

- Different projects want different skills loaded (one project uses `horus-anvil`, another needs a custom `client-conventions` skill)
- Sensitive projects shouldn't share environment variables with throwaway experiments
- You want a clean context when you switch from personal work to client work
- MCP server configs can drift per-project (e.g. different vault instances)

Workspaces solve this by giving each line of work its own agent context.

## What's in a workspace

When Forge creates a workspace, it writes:

- **`.claude/settings.local.json`** — MCP server URLs for Anvil, Vault, and Forge, resolved to host-accessible endpoints (not Docker-internal ones)
- **`.claude/skills/`** — a subset of skills from the Forge registry, installed for this workspace
- **`workspace.env`** — environment variables sourced by shells and child processes inside the workspace
- **`CLAUDE.md`** — a workspace-level instruction file that gets loaded into Claude's context on every session
- **Permission hooks** — optional pre/post hooks that enforce policies

The workspace directory lives under `<data_dir>/workspaces/<workspace-name>/` on your host and is also mounted into the Forge container so the MCP server can read and update it.

## Create your first workspace

Open Claude and ask it to create a workspace for you:

> "Create a workspace called `draft` for general experimentation with the `sdlc-*` skills loaded."

Claude will call `forge_workspace_create` under the hood. If you want to do it in a single MCP tool call directly, the arguments look like:

```
forge_workspace_create({
  name: "draft",
  description: "General experimentation workspace",
  skills: ["sdlc-planner", "sdlc-developer", "sdlc-reviewer", "sdlc-story"],
  mcp_servers: ["anvil", "vault", "forge"]
})
```

Forge returns the workspace path (e.g. `~/Horus/data/workspaces/draft/`) and writes all the config files mentioned above.

## Use the workspace

To actually *work* inside a workspace, open Claude Code or Cursor in the workspace directory:

```bash
cd ~/Horus/data/workspaces/draft
claude
```

Claude Code picks up `.claude/settings.local.json` automatically and loads the configured MCP servers and skills. The `CLAUDE.md` in the workspace root becomes your project-level instructions. From that point on, every tool call Claude makes is scoped to this workspace's configuration.

## Workspaces vs. code sessions

Here's the easiest way to keep them straight:

| Workspace | Session |
|---|---|
| Agent environment (MCP, skills, permissions) | Git worktree on disk |
| One per project or line of work | One per work item (story / task) |
| Does NOT clone any repo | Is a git worktree checked out to a feature branch |
| Persists until you explicitly delete it | Auto-cleans when the linked work item is done |
| Created via `forge_workspace_create` | Created via `forge_develop` |

You typically have one workspace per project and many sessions inside that workspace over time as you pick up different work items.

## Listing and inspecting workspaces

```
forge_workspace_list()
forge_workspace_status({ name: "draft" })
```

The list tool returns every workspace Forge knows about. The status tool tells you its configuration and whether any sessions are linked to it.

## Cleaning up

When you're done with a workspace:

```
forge_workspace_delete({ name: "draft" })
```

This removes the workspace directory and deregisters it from Forge. If the workspace has active sessions, you'll need to clean those up first (see `first-session`).

## What's next

- **`horus guide first-session`** — create a git worktree tied to a work item so you can actually edit code
- **`horus guide first-note`** — create the work item in Anvil that a session links to
- **`horus guide core-concepts`** — the mental model for why workspace, session, and repo are three separate concepts
