# Anvil SDLC v2 (repo-local)

The full Horus software-development-lifecycle pipeline, running **inside the user's own repo
checkout** instead of a Forge workspace or session. As of v3.0.0 this suite is fully repo-local —
the workspace/session/`forge_develop` model is gone.

## Why this exists

The Forge workspace/session model (`forge_develop`, managed clones, Docker path translation, guard
hooks) is the fragile path during the Horus client migration. This plugin sidesteps it entirely: it
runs where Claude Code already is — a real git checkout — and isolates parallel work with **native
git worktrees** under `.worktrees/<slug>`. Because `cwd` is the real repo, the repo's own
`CLAUDE.md`, `.claude/skills`, MCP servers, and settings auto-load.

Anvil (work-item state) and Vault (conventions) are location-independent MCP services, used as before.

## The pipeline

| Skill | Stage |
|---|---|
| `sdlc-orchestrator` | Conductor — routes plan → build → verify → doc → ship |
| `sdlc-project` | Project-level setup and management |
| `sdlc-story` | Work-item lifecycle entry — creates the `.worktrees/<slug>` worktree + branch |
| `sdlc-planner` | File-level implementation plan from Vault conventions + code structure |
| `sdlc-designer` | Design proposals, options, trade-offs, ADRs |
| `sdlc-discovery` | Requirements discovery / stakeholder personas |
| `sdlc-developer` | Implement inside the worktree, run build/lint |
| `sdlc-tester` | Run the suite, check acceptance criteria |
| `sdlc-reviewer` | Review the change inside the worktree |
| `sdlc-docs` | Durable knowledge → Vault; working notes → Anvil |
| `sdlc-scratch` | Scratch journaling |

Subagents: `sdlc-gather-context`, `sdlc-implement-story`, `sdlc-plan-feature`,
`sdlc-design-proposal`, `sdlc-route-evaluator`, `sdlc-test-suite`, `sdlc-doc-sync`, `sdlc-release`
(owns commit/push/PR/Anvil-status and worktree removal after merge).

## Hard rules (shared by every skill/agent)

1. Run inside the user's real repo checkout. Isolation is a native `git worktree`, nothing else.
2. **Never** use `forge_develop`, Forge workspaces, or Forge sessions.
3. Anvil for work-item state; Vault for conventions.
4. Delegate **all** code exploration and Anvil/Vault reads to a Sonnet subagent — keep context lean.

## Install

```
horus global install plugin:anvil-sdlc-v2     # global: ~/.claude/skills + ~/.claude/agents
```

or per-repo:

```
forge_add({ refs: ["plugin:anvil-sdlc-v2@3.0.0"] })
forge_install({ target: "claude-code" })
```

Then, from inside a repo: "start working on `<work-item>`" → `sdlc-story` carves the worktree and
hands off to `sdlc-orchestrator`.
