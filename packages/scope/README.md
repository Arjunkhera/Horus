# @horus/scope

Scope-chain resolver and DeploymentProfile configuration module for the Horus platform (F2).

## Overview

`@horus/scope` provides:

- **`DeploymentProfile`** — the single source of every enterprise/SaaS behavioural difference in the Horus platform.  Every downstream package (F3+) reads the profile; none branch on ad-hoc mode strings.
- **`resolveScope`** — pure function that maps a `Principal` + `Subsystem` + `DeploymentProfile` to a `ScopeCoordinate` encoding the active namespace tiers.

## Scope chain: Global → Tenant → User

Each subsystem activates a subset of the three tiers:

| Subsystem          | Global | Tenant | User |
|--------------------|--------|--------|------|
| `anvil`            |        | ✓      | ✓    |
| `vault`            |        | ✓      |      |
| `forge-registry`   |        | ✓      |      |
| `forge-artifactory`| ✓      | ✓      |      |

Tiers not listed for a subsystem are `undefined` on the returned `ScopeCoordinate`.

## enterprise vs SaaS

`DeploymentProfile` is the single source of truth for all enterprise vs SaaS distinctions:

- **enterprise** profiles use `tenancy: 'multi-tenant'` — each tenant gets its own namespace, and users within a tenant have individual user-tier scopes where the subsystem requires it.
- **SaaS** profiles use `tenancy: 'single-user'` — the tenant namespace collapses to the user identity, so `coordinate.tenant === coordinate.user`.  No code in `resolveScope` branches on the mode string; the collapse is driven entirely by the profile value.

### Reference profiles

```ts
import { enterpriseAlphaProfile, saasProfile, parseDeploymentProfile } from '@horus/scope';
```

`enterpriseAlphaProfile`: `mode: 'enterprise'`, `tenancy: 'multi-tenant'`  
`saasProfile`: `mode: 'saas'`, `tenancy: 'single-user'`

Both satisfy the `DeploymentProfile` schema and can be validated with `parseDeploymentProfile`.

## Usage

```ts
import { resolveScope, parseDeploymentProfile, saasProfile } from '@horus/scope';
import type { Principal, DeploymentProfile } from '@horus/scope';

const profile: DeploymentProfile = parseDeploymentProfile(rawConfig);

const principal: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };
const coord = resolveScope(principal, 'anvil', profile);
// coord.tenant === 'acme', coord.user === 'alice'
```

## Schema validation

`parseDeploymentProfile(input: unknown): DeploymentProfile` — throws a `ZodError` if the input does not conform to the schema.  Required fields: `mode`, `tenancy`, `placement` (record of all four subsystems → `'shared' | 'per-user'`), `scale`, `credentialPair`, `identitySource`, `globalForgeLink`, `governancePolicy`.
