# @horus/tenancy — Per-User Anvil Tenancy Plumbing Contract (F3)

This package is the **written contract** that Track A (Anvil service) and Track E (Operator) implement against. It is **not** a service implementation — it contains only types, interface definitions, and reference-contract scaffolding with no real I/O.

Decision journals referenced: 6a553c77 and 3944fd2f.

---

## Per-User Anvil Resource Shape

Each authenticated user gets exactly two Anvil-level resources:

| Resource | Type | Derivation |
|---|---|---|
| `typesenseCollection` | Typesense collection name | `anvil_<tenant>_<user>` (sanitised) |
| `neo4jDatabase` | Neo4j database name | `anvil-<tenant>-<user>` (sanitised, lowercase) |

Both names are derived from the **F2 scope coordinate** returned by `resolveScope(principal, 'anvil', profile)`. This makes them deterministic, unique per `(tenant, user)` pair, and profile-aware. Under the SaaS single-user profile (where tenant collapses to user per F2 semantics), both resource names still contain the user identifier.

```ts
import { derivePerUserAnvilResource } from '@horus/tenancy';
import { enterpriseAlphaProfile } from '@horus/scope';

const resource = derivePerUserAnvilResource(
  { tenant: 'acme', user: 'alice', role: 'admin' },
  enterpriseAlphaProfile,
);
// { typesenseCollection: 'anvil_acme_alice', neo4jDatabase: 'anvil-acme-alice' }
```

---

## Idempotent Provisioning Step List

`perUserAnvilProvisioningPlan` is an ordered array of `ProvisioningStep` objects consumable by the Operator's C2 retry-safe handlers.

Each step is **idempotent** and **status-checkpointed**: calling `ensure(ctx)` a second time for the same step id is safe — the step checks `ctx.completed` first and returns `'done'` immediately without re-executing side effects.

```ts
import { perUserAnvilProvisioningPlan } from '@horus/tenancy';

const ctx = { completed: new Set<string>() };
for (const step of perUserAnvilProvisioningPlan) {
  const status = await step.ensure(ctx); // always 'done'
}
```

Steps (in order):

1. `create-typesense-collection` — owned by `anvil`
2. `create-neo4j-database` — owned by `anvil`
3. `schema-bootstrap` — owned by `horus-provisioner` (see below)

---

## Schema-Bootstrap Ownership Relocation

The `schema-bootstrap` step — which loads Anvil's default type definitions into a newly provisioned Neo4j database — is **NOT owned by Anvil**. Its ownership is relocated to the neutral owner **`horus-provisioner`** (exported as `SCHEMA_BOOTSTRAP_OWNER`).

This is a deliberate architectural boundary: Anvil must not be responsible for initialising its own schema. The Operator (`horus-provisioner`) holds that responsibility so the Anvil service can remain stateless with respect to provisioning.

```ts
import { SCHEMA_BOOTSTRAP_OWNER } from '@horus/tenancy';
// 'horus-provisioner'
```

---

## Principal → Scoping Enforcement Contract

`createScopingEnforcement(profile)` returns a `ScopingEnforcement` object that binds the F1 `Principal` type and mirrors the F1 tenant-isolation floor.

`assertAccess(principal, { principal: target })` compares the F2 scope coordinate key of both principals. Same key → pass; different key → `throw`. This allows same-user access and blocks cross-user access in a profile-agnostic way.

```ts
import { createScopingEnforcement } from '@horus/tenancy';
import { enterpriseAlphaProfile } from '@horus/scope';

const enf = createScopingEnforcement(enterpriseAlphaProfile);
enf.assertAccess(alice, { principal: alice }); // ok
enf.assertAccess(alice, { principal: bob });   // throws — cross-user access denied
```

---

## Implementing Against This Contract

- **Track A (Anvil service)**: implement the actual Typesense and Neo4j calls that `perUserAnvilProvisioningPlan` steps describe. Do not own the `schema-bootstrap` step.
- **Track E (Operator)**: wire `perUserAnvilProvisioningPlan` into the C2 retry-safe handler loop, execute steps in order, pass a shared `completed` set for checkpointing, and own the `schema-bootstrap` step as `horus-provisioner`.
