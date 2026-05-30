# ADR-0004: Layered control plane; Horus = client + control plane; Operator is a separate service

**Status:** accepted
**Date:** 2026-05-19
**Related:** Decision journals `8c6a5b5a` (B1), `d59dc593` (B1 amendment), `b506e4e4` (B2); design-proposal `eee11da4`; ADR-0002, ADR-0003; story `e745a54d`

## Context

Three related decisions resolve the shape of the control plane (design-proposal `eee11da4`
questions B1 and B2):

- **B1 (`8c6a5b5a`):** Is the Horus control plane one fat service, a thin gateway, or
  layered — and where do federated `horus_search`, cross-system aggregation, and governance
  live?
- **B1 amendment (`d59dc593`):** What exactly is "Horus", where does the client run, and is
  the Operator a Horus module or a separate service?
- **B2 (`b506e4e4`):** How is governance + provisioning structured, and what is the MVP
  scope?

## Decision

**Layered control plane behind one logical front door, with Horus as client + control
plane and the Operator as a genuinely separate service.**

From B1 (`8c6a5b5a`): three modules behind one logical front door — (1) **Edge/Identity**
(credential issue, routing, Principal), (2) **Aggregation** (federated `horus_search`,
cross-system read API), (3) **Governance** (`request→review→provision`, tenant registry).
Clean module boundaries fixed in design; deployed as a **single process for alpha**; splits
into independently-scalable services at SaaS scale via the mode/scale dial — no rebuild.

From the B1 amendment (`d59dc593`):
1. **Horus = the user-facing client AND the control-plane services it fronts.** Horus
   control plane = **Edge/Identity + Aggregation only**.
2. **The Horus client runs on the user's own machine OR a VM — identical artifact,
   location-irrelevant. Running on a personal machine is non-negotiable.** The always-on
   "hotbox VM" is one operator-offered option, not a requirement. Today's baseline install
   mechanism = MCP + skills installed globally; exact client delivery route is an OPEN
   design question, but must be identical for machine and VM.
3. **The Operator/Admin is a genuinely separate service** (not a Horus module). Its purpose
   is user/tenant management. It owns the tenant/resource registry, the
   request→review→approve governance workflow, and drives provisioning. Its admin UI MAY
   be surfaced through the Horus client, but it is a distinct service with a distinct
   privilege boundary.
4. **Amends B1:** Governance + tenant registry + provisioning move OUT of the Horus control
   plane INTO the separate Operator/Admin service.

From B2 (`b506e4e4`):
- **Generic polymorphic `Request {kind, payload, requester, tenant, status, decision,
  decidedBy}` + pluggable per-kind handlers.** One primitive, not per-subsystem approval.
- **Policy is a mode-module dial.** Alpha = single admin, no auto-rules, everything queues
  for manual approval. Flipping later = config, not code.
- **Lives in the SEPARATE Operator/Admin service**, which owns the `Request` model, the
  approval workflow, the tenant/resource registry, and the Provisioner.
- **Decoupled idempotent Provisioner.** Approval emits a durable event; the Provisioner
  reconciles desired→actual idempotently with retries and resumable partial-failure, owns
  teardown (Kubernetes API-server vs controller analogy).
- **Three action classes:** [G] Governed (front the approval workflow), [I] Internal
  (Operator reconciles autonomously), [S] Scheduled. Only [G] needs the queue.
- **MVP scope (confirmed):** In — onboard, Anvil spin-up, one Vault router, vault
  create+attach, one-time Forge registry, add/remove repo, publish/promote,
  artifact-verification; crude manual teardown only. Deferred (post-alpha) — full offboard,
  remaining governance items, and ALL cross-cutting (key rotation, backup/export/import,
  drift-reconcile, mode change). Authoritative responsibility surface = catalog `db07326b`.

## Alternatives Considered

### Fat single service (B1 Option A)
Rejected — chokepoint, god-service accretion, cannot scale search independently of auth.

### Thin gateway + smart subsystems (B1 Option B)
Rejected — structurally breaks two locked decisions (governance-as-one-primitive;
`horus_search` must federate two domains, impossible from inside Anvil); this is the
SaaS-rebuild corner.

### Governance as a Horus control-plane module (original B1)
Superseded by `d59dc593` — conflates user-management with the user-facing/runtime plane.

### Hotbox-VM-only client
Rejected — running on a personal machine is non-negotiable.

### Inline synchronous provisioning (B2)
Rejected — partial-failure hand-cleanup, unsafe at any scale.

### Per-subsystem approvals (B2)
Rejected — breaks the one-primitive requirement.

## Consequences

### Positive
- Fix boundaries now, make deployment form a mode/scale dial — consistent with ADR-0001
  and ADR-0002; no rebuild to split services at scale.
- `horus_search` gets an unambiguous home (Aggregation module) and is out of Anvil MCP.
- Governance stays the one cross-cutting primitive in its own module/service.
- Separate privileged Operator = trust-boundary isolation: the internet-facing plane does
  not hold infra god-mode.
- Matches how users actually experience Horus (a growing client) and the personal-machine
  requirement.
- One reusable governed `Request` primitive; policy-as-dial = SaaS-without-rebuild in
  governance.

### Negative
- Slightly more ops at full service split (deferred by the alpha = one-deployable dial).
- Horus client and Operator have separate UIs to integrate (Horus may embed Operator UI).
- An internal contract between the Horus client/control-plane and the Operator service is
  required.
- Durable-event + status-reconcile machinery; crude (non-export) teardown in MVP.

### Neutral
- Internal module-to-module trust reuses the ADR-0003 Principal/credential model — no new
  mechanism.
- New open design question: Horus client delivery/runtime (machine/VM-agnostic; today =
  global MCP+skills; route TBD).

## Updates

### 2026-05-28 — Federation point moved to the client (Anvil-local premise change)

**Amends:** the Decision/Consequences claim that `horus_search` federation lives in the
control-plane **Aggregation module** server-side (lines 26–27), and the Alternatives rationale
that rejected the thin-gateway option *because* "`horus_search` must federate two domains,
impossible from inside Anvil" (lines 71–73).

**What changed:** A later decision (Horus Phase 2 design, conversation-state `03619fa6`) made
**Anvil local-only for alpha** — Anvil runs in containers on the user's own machine, git-synced,
and is **not reachable from the remote control plane**. The original premise behind locating
federation server-side (the gateway can reach both domains) no longer holds: the control plane
cannot reach a user's local Anvil.

**New decision:** **The client (horus-ui) is the federation point.** horus-ui issues two queries
in parallel — local Anvil (direct, no auth) and the remote control plane — and merges/ranks the
results. The control-plane **Aggregation module federates only the remote domains** it can reach
(Vault + Forge). This keeps Anvil data off the remote plane (privacy-preserving) and is the only
topology consistent with Anvil-local.

**Unchanged:** the layered-module model, the separate Operator service, and the
Edge/Identity + Aggregation split all stand. Aggregation still exists and still federates — its
scope just narrows to the remote domains. ADR-0005's "single Edge/Aggregation API" is unaffected
in shape; only the federation fan-out boundary moves.

**Related:** ADR-0002 (two-domain federation), ADR-0005 (Edge/Aggregation API), ADR-0007
(deployment), ADR-0008 (principal normalization). Anvil-local rationale recorded in
conversation-state `03619fa6`.
