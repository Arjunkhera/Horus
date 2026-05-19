# Architecture Decision Records

This directory records the significant structural decisions for the Horus platform.
Each ADR captures the context, the decision, the alternatives considered, and the
consequences, so future readers understand **why** without prior knowledge.

ADRs are sourced from the Anvil decision journals that closed the core platform design
(design proposal `eee11da4` — "Horus Platform — Control Plane, Identity, Tenancy &
Deployment (SaaS-grade)"). They are records, not justifications.

| ADR | Title | Source journal(s) | Status |
|-----|-------|-------------------|--------|
| [0001](0001-unified-deployment-mode-module.md) | Unified deployment model differentiated by a mode module; SaaS = single-user enterprise | `2d4ef753` | accepted |
| [0002](0002-two-domain-data-isolation.md) | Two-domain data isolation; Anvil is a separate per-user infra domain | `6a553c77` | accepted |
| [0003](0003-pluggable-credential-provider-verifier.md) | Pluggable CredentialProvider/Verifier pair over a locked Principal contract | `3dc752a8` | accepted |
| [0004](0004-layered-control-plane-operator-separate.md) | Layered control plane; Horus = client + control plane; Operator is a separate service | `8c6a5b5a`, `d59dc593`, `b506e4e4` | accepted |
| [0005](0005-single-edge-aggregation-api-agent-first.md) | Single Edge/Aggregation API; agent-first north star | `a1a984f9` | accepted |
| [0006](0006-global-tenant-user-scope-chain.md) | One canonical Global→Tenant→User scope chain; Principal is the resolver | `c417915a` | accepted |

## Status lifecycle

`proposed → accepted → deprecated → superseded`

## Conventions

- Files are named `NNNN-kebab-title.md`, numbered sequentially from `0001`.
- Append updates under the `## Updates` section rather than rewriting history.
