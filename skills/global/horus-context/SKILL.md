---
name: horus-context
description: >
  This skill should be used when the agent needs to decide which Horus subsystem
  to call, "start working on a story", "search across everything", "catch me up",
  or route any request that may span Anvil, Vault, and Forge. Provides the unified
  Horus mental model and cross-subsystem routing.
---

# Horus Context — Mental Model & Routing

## Subsystems

- **Anvil** — everything in-flight: tasks, notes, stories, design docs, journals, PKM. Default home for structured data.
- **Vault** — permanent truth: repo docs, guides, concepts, learnings. Read-mostly. Never write working docs here.
- **Forge** — execution: code sessions, workspaces, repos, artifact registry.

Tool-level reference: `horus-anvil`, `horus-vault`, `horus-forge`.

> **Topology (connected client):** Anvil runs **locally** (the `anvil` container); Vault and the Forge **registry** are **remote**, reached through the control-plane gateway at `https://horus.arjunkhera.io` (JWT-gated). Forge **local execution** (sessions/workspaces, `forge_develop`) is embedded in the `horus-ui` container.

## Default Routing Heuristic

For any request, follow this sequence. Skip steps when context is already present. Human override always wins.

1. **Anvil first** — search stories, notes, project state (`anvil_search`, `anvil_get_note`).
2. **Vault if code context needed** — load repo conventions and architecture (`knowledge_resolve_context`, `knowledge_search`).
3. **Forge if execution needed** — create or resume a code session (`forge_develop`).

Report back after each phase. Do not advance without need.

## Anvil-Only Shortcut

If the task is purely about capturing, organizing, or querying data — stay in Anvil. No Vault or Forge needed. Covers: tasks, notes, journals, design docs, decisions, scratch, bookmarks, views, dashboards, areas, edges.

## Non-Obvious Routes

| Intent | Trigger Phrases | Sequence | Constraint |
|--------|----------------|----------|------------|
| **Code** | story ID, "start working on", branch name, repo name | Anvil (read story) → Vault (`resolve_context`) → Forge (`forge_develop`) | All 3 steps required in order |
| **Review** | "review PR", session status, "what's the diff" | Forge (session/PR status) → Anvil (update story status) | Verify session exists before proceeding |
| **Investigate** | "why is this broken", "what changed", debugging | Anvil (`anvil_search`) + Vault (`resolve_context`) | Do NOT create a Forge session unless the user explicitly asks to fix |
| **Orient** | "catch me up", "where are we", "project status" | Anvil (project, stories, journals) → Vault (`resolve_context`, `include_full: false`) | Start with project state in Anvil, not code |
| **Search** | "find", "search for", "is there anything about" | `horus_search` (cross-system, single call) | Use per-system calls only when scoped results are needed |

## When Multiple Intents Are Detected

If a request spans multiple intents (e.g., "summarize progress and start the next story"), confirm the sequence with the user before proceeding. Do not auto-chain.