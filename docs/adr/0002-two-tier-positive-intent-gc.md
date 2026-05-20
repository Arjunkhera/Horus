# ADR 0002 — Two-tier positive-intent GC

- Status: Accepted
- Date: 2026-05-20
- Source decision journal: `6bb34855`
- Feature: Forge Code Isolation (Anvil `98a967dc`)

## Context

Bug J: `forge_session_cleanup(olderThan:"1d")` destroyed three
in-progress sessions by age alone — no status check, no dirty-tree
check, no dry-run. Requirements R3 (destructive ops require positive
intent) and R4 (every flow has an undo) demand this be structurally
impossible, not merely discouraged.

## Decision

Two independent GC tiers, dry-run by default:

1. **Worktree tier.** A worktree is reclaimable ONLY if its work item
   is not active (per Anvil) AND its tree is clean (no uncommitted, no
   unpushed, no stash). When any signal cannot be determined, treat as
   unsafe and retain. Age is surfaced for information but is NEVER a
   sufficient deletion condition.
2. **Clone tier.** LRU on `LocalRepoState.lastUsedAt`; a clone is never
   reclaimed while it has any live worktree (subordinate to tier 1).

Destruction requires an explicit `apply: true`. The default run is a
dry-run that enumerates each candidate with the reasons it is or is not
eligible.

## Consequences

- The Bug J scenario (old + in-progress + dirty) can never delete data
  — enforced by a regression test.
- Implemented as a new self-contained module; the legacy
  `sessionCleanup` is left untouched to avoid behavioral risk.
- "Undetermined ⇒ unsafe" can retain reclaimable worktrees in odd git
  states; accepted (safety over reclamation).

## Alternatives considered

- Single unified GC over the repo subtree (rejected: cannot distinguish
  stale-clone from in-progress session — would repeat Bug J).
- Manual-only GC (rejected: unbounded disk growth on long-lived VMs).
