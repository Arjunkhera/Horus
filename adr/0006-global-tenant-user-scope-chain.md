# ADR-0006: One canonical Global→Tenant→User scope chain; Principal is the resolver

**Status:** accepted
**Date:** 2026-05-19
**Related:** Decision journal `c417915a` (design-proposal `eee11da4` question D1); ADR-0001, ADR-0002, ADR-0003; story `e745a54d`

## Context

The open question (design-proposal `eee11da4` D1) was: one scope model across Vault
namespaces, Forge tiers, and Anvil accounts. The original reason for the platform zoom-out
was today's per-subsystem scoping fragmentation. The A2 `Principal {tenant, user, role}`
(ADR-0003) already travels on every call. This decision closes the core platform design
(13 decisions; Groups A/B/C/D-core resolved; D2/D3 deferred post-alpha).

## Decision

A single canonical **`Global → Tenant → User`** scope chain, applied uniformly, tiers
optional per subsystem:

- **The A2 `Principal {tenant, user, role}` IS the resolution key.** Auth token = scope
  coordinate; no separate scoping machinery. The thing passed on every call is the thing
  that scopes every call.
- **Per-subsystem tiers:**
  - Anvil → Tenant→User always (personal data never Global), addressed `tenant/user`.
  - Vault → Tenant-scoped (User only when SaaS collapses it), addressed `tenant/<vault>`.
  - Forge registry → Tenant (User in SaaS).
  - Forge artifactory → the one **Global** tier, resolution order `global` then `tenant`.
- **SaaS collapse is free:** SaaS tenant = 1 user ⇒ `tenant == user`; `tenant/user`
  degenerates to one identity. Same model, zero special-casing. Enterprise: tenant =
  company, Vault/Forge resolve at tenant tier, Anvil at user tier within tenant.
- **The `tenant` tier IS the Vault V3 namespace root:** `vault://<tenant>/<vault>/<page-id>`.
  The parked Vault V3 thread (URI-style addressing, `*`/`**` wildcards, UUID canonical,
  dumb-vault/smart-router, separated per-user infra) slots directly onto this with
  `owner = tenant`.

## Alternatives Considered

### Per-subsystem scoping
Rejected — this is exactly the fragmentation being eliminated.

### Two-tier Tenant→User only with global Forge as a one-off
Rejected — leaves Forge federation (D3) no consistent home; defining the Global tier now
is free and avoids a later retrofit.

## Consequences

### Positive
- One coordinate system everywhere kills today's per-subsystem fragmentation (the original
  reason for the zoom-out).
- Reusing the Principal as resolver is the elegant unification — auth and scoping are one
  system.
- Defining the Global tier now (even though only the Forge artifactory uses it
  pre-federation) costs nothing and avoids a D3 retrofit.

### Negative
- "Tier optional per subsystem" means the chain is a superset, not uniformly fully
  populated — acceptable; it is still one model and one resolver.

### Neutral
- Closes the core Horus platform design (13 decisions; D2/D3 deferred post-alpha).
- Unblocks: resuming the parked Vault V3 namespace thread (journal `50c1f4a9`) with
  `owner = tenant` locked; building the Horus Program roadmap from a closed design.

## Updates

_None._
