# ADR-0001: Unified deployment model differentiated by a mode module; SaaS = single-user enterprise

**Status:** accepted
**Date:** 2026-05-19
**Related:** Decision journal `2d4ef753` (design-proposal `eee11da4` questions A1, A4, C3); story `e745a54d`

## Context

The Horus platform must be able to deploy as SaaS later **without a rebuild**. The open
question (design-proposal `eee11da4` A1/A4/C3) was: how do SaaS and enterprise relate
architecturally, and what is the tenancy/provisioning model? The user's explicit goal is to
maximise code reuse and minimise complexity, and to avoid maintaining a divergent product.

## Decision

One unified setup/stack process. A **deployment-mode module** is the sole differentiator.

- **SaaS is defined as a single-user enterprise instance, repeated per paying user, plus
  exactly one global Forge artifactory.**
- **Enterprise mode** = one tenant (the company, N users), isolated, no global connection.
- Tenancy hierarchy = **Tenant → User**; in SaaS the tenant cardinality is 1 (per paying user).
- Provisioning is one mode-parameterized process the operator runs.

Mode matrix:
- **Enterprise** → operator = company, tenant = company (N users), Anvil per-user,
  Forge/Vault tenant-shared, no global connection, company admin.
- **SaaS** → operator = us, tenant = 1 user, Anvil/Forge/Vault all per-user, one global
  Forge artifactory (the only global element for now), we are admin.

## Alternatives Considered

### Separate SaaS vs enterprise architectures
Rejected — doubles maintenance, which is exactly the outcome the user explicitly wants to
avoid.

### Pooled multi-tenant-only
Deferred to the A3 data-isolation-mechanism question rather than decided here.

## Consequences

### Positive
- Maximises code reuse and minimises complexity (the user's explicit goal).
- The mode module is the seam that makes "deploy as SaaS later without a rebuild" true —
  it is config/policy, not a fork.
- Treating SaaS as enterprise-of-one means one architecture, one governance dial, no
  divergent product.

### Negative
- Per-user provisioning of all three subsystems in SaaS has linear infra cost/ops.
  (Pushed into the A3 data-isolation-mechanism question to resolve — see ADR-0002.)

### Neutral
- Cross-tenant/global features require an explicit federation path; only the global Forge
  artifactory exists as a global element for now.
- The deployment-mode module's exact responsibilities/config schema are deferred to the
  C2 work.

## Updates

_None._
