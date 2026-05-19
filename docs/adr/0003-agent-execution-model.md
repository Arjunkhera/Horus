# ADR 0003 — Agent-execution model (Note 9 fix)

- Status: Accepted
- Date: 2026-05-20
- Source decision journals: `df07315f`, `560b884a` (+ `0e1f7f8b`)
- Feature: Forge Code Isolation (Anvil `98a967dc`)

## Context

Note 9 (project-context severance): the agent ran from the workspace
cwd and edited worktree files by absolute path, so the repo's
`CLAUDE.md`, `.claude/skills/`, settings and permissions never loaded.
Claude Code config discovery is cwd-anchored; `additionalDirectories`
extends file access only, NOT config discovery; the SDK
`AgentDefinition` has no `cwd`. Claude Code is the sole harness.

## Decision

Three flows, all on Claude Code:

1. **Edit flow** — a top-level Claude Code session launched
   programmatically via the Agent SDK `query({ cwd: <worktree> })`
   (Shape 1: the human keeps talking only to the workspace agent).
   Project root = worktree ⇒ native scaffolding load. This is the
   structural Note 9 fix. `session_id` is captured for resumable
   provenance.
2. **Read / cross-repo flow** — an Agent Team teammate per repo, rooted
   at that repo's clone (ephemeral; teammates are non-resumable).
3. **Inline glance** — Horus-mediated `add directory` plus injection of
   the target repo's CLAUDE.md + skill manifest.

Headless `horus run --workspace --story` is the same edit-flow
mechanism with a story-preloaded entry point; managed-clone only; S11
mandatory; never `--bare` in-repo. The SDK reuses the logged-in Claude
Code CLI credential — no API key prompt (office VMs are pre-authed,
journal `0e1f7f8b`).

## Consequences

- Note 9 is fixed structurally (by cwd), not by injection.
- Edit-flow cannot be an in-process subagent (no per-subagent cwd).
- Open validation: teammate `skills`/`mcpServers` frontmatter is not
  applied to teammates — repo skill loading for the read flow needs a
  POC (Anvil CI-1) before that flow is implemented.

## Alternatives considered

- Edit-as-subagent / `add directory` for edits (rejected: reproduces
  Note 9).
- Shape 2 (user opens the second session manually) — valid interactive
  twin, deferred for UX; same rooting mechanism.
