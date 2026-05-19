# ADR-0005: Single Edge/Aggregation API; agent-first north star

**Status:** accepted
**Date:** 2026-05-19
**Related:** Decision journal `a1a984f9` (design-proposal `eee11da4` question B3); ADR-0003, ADR-0004; story `e745a54d`

## Context

The open question (design-proposal `eee11da4` B3) was: how does the plane get exposed to
agents, humans, and the admin? Agents are the primary users of Horus. Today's mechanism is
MCP + globally-installed skills, and any chosen surface must avoid agent/human capability
drift.

## Decision

**Option A, agent-first:**

- **One canonical Edge/Aggregation API = the single contract.** All capability lives here
  once; both faces inherit it; agent and human can do the same things (no drift).
- **MCP + skills adapter = the PRIMARY face** (agents are the primary users — the major
  north star). Preserves today's mechanism (MCP + globally-installed skills); zero
  migration.
- **Portal = the SECONDARY human face**, a thin adapter over the same API. Must never
  expose a capability agents can't reach (agent surface = superset).
- **Operator Admin UI** embeddable in the Horus client but routes to the separate Operator
  service, not the shared API.

**Agent-First North Star (cross-cutting principle, applies system-wide):**
1. The single API is **tool-shaped and MCP-native by default**; the portal adapts to it,
   never the reverse.
2. The agent surface is the **superset**; humans are first-class but secondary consumers.
3. **Headless-safe by construction** — no interactive step in any core flow (this is *why*
   ADR-0003's auto-refreshing CredentialProvider exists; reaffirmed here as an agent-first
   requirement).
4. **Skill packaging is an agent-UX decision, not architecture.** The API is one contract;
   the skill surface over it may be 1 or N skills (today: 3 — anvil/vault/forge). Skill
   granularity is deliberately LEFT OPEN, decided at planning time on "what lets an agent
   select and chain well" — not locked here.

## Alternatives Considered

### MCP-first where the portal is itself an MCP consumer
Rejected — rich human UI through tool semantics is awkward; Option A already keeps the MCP
face so nothing is lost.

### Two independent surfaces
Rejected — drift, double work, breaks the one-contract pattern.

## Consequences

### Positive
- One contract = no agent/human capability drift, and "add capability once → both faces
  inherit" (the client-grows property).
- Agent-first inverts the usual human-API-with-automation-bolted-on; since agents are the
  primary users this is the correct default shaping force.
- Keeping MCP+skills as the primary adapter = no migration from today.

### Negative
- The portal is constrained to the agent-native contract's shape (acceptable — that is the
  point).

### Neutral
- Skill-count is left unresolved intentionally; tracked as an open agent-UX call decided
  at planning time.

## Updates

_None._
