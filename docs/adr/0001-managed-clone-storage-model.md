# ADR 0001 — Horus-owned managed-clone storage model

- Status: Accepted
- Date: 2026-05-20
- Source decision journal: `349fdd96` (+ `2c413cf7`, `ca259b26`)
- Feature: Forge Code Isolation (Anvil `98a967dc`); design proposal `2341edfe`

## Context

Forge's code-isolation redesign committed to Horus owning its filesystem
domain — clones and worktrees live under Horus-managed roots, never
straddling user paths (R1: the user's working tree is sacred). The
post-RR-7 git-backed registry makes repo metadata portable, but the
on-disk clone layout was undecided and enterprise hosts (github.com,
github.adobe.com, gitlab) created an `{org}/{name}` collision class.

## Decision

- Managed clones live at `~/Horus/data/repos/{host}/{org}/{name}/`,
  computed deterministically from registry metadata (no lookup).
- The `{host}` segment is normalized (lowercase, port stripped) and is
  what disambiguates enterprise hosts.
- Refresh is lazy-TTL: a `git fetch` (never pull/merge) of the base
  branch only when `LocalRepoState.lastFetchedAt` exceeds a config-driven
  TTL (default 1h).
- Session worktrees are colocated inside the clone at
  `.horus/worktrees/{session-id}/`, git-ignored via per-clone
  `.git/info/exclude`.
- Machine-specific state lives in `LocalRepoState` (`repo-state.json`),
  never synced.

## Consequences

- Clone path is a pure function of the remote URL — deterministic state
  machine for the read/edit flows.
- Clone + all its worktrees form one GC subtree (see ADR 0002).
- A clone may be up to TTL stale at resolve time; acceptable because
  worktrees branch from the freshly-fetched ref.
- Supersedes the earlier "worktrees attach directly to user repos" idea
  (would have violated R1).

## Alternatives considered

- `{org}/{name}` without host (rejected: enterprise-host collisions).
- Flat hashed dirs (rejected: opaque/undebuggable).
- Always-fetch per session (rejected: wasteful on hotbox VMs).
