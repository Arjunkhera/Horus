# Horus Runbooks

Operational runbooks for standing up and running Horus. These live in-repo (not in
Vault) so any operator can follow them without access to the knowledge base.

A **runbook** is a step-by-step operational procedure with explicit verification
gates. It differs from the conceptual guides in `docs/` (which explain *how Horus
works*) — a runbook tells you *exactly what to run, in what order, and how to know
it worked*.

## Available runbooks

| Runbook | Audience | What it does |
|---------|----------|--------------|
| [client-setup.md](./client-setup.md) | End user | Install and run the 4-container Horus client (horus-ui + anvil + typesense + neo4j) on your machine — local-only or connected to a control plane. |
| [control-plane-k3s.md](./control-plane-k3s.md) | Operator | Stand up the remote Horus control plane (gateway, operator, Vault reader/writer + router, Forge registry) on single-node k3s via ArgoCD, and onboard users. |

## Topology at a glance

Horus is one product with two deployment halves:

- **Client (local, per user):** `horus-ui` (`:8400`, embeds Forge local-exec) +
  `anvil` (`:8100`) + `typesense` (`:8108`) + `neo4j` (`:7474/:7687`). Run via the
  `horus` CLI, which generates a Compose file from
  `packages/cli/compose/docker-compose.yml`. Vault and the Forge registry are
  **remote**. See [client-setup.md](./client-setup.md).
- **Control plane (remote, shared):** `horus-service` (public gateway),
  `operator-service` (identity/provisioning), `vault-router` + `vault-reader`(×N) +
  `vault-writer`, `forge-registry`, shared Typesense + Neo4j. Runs on single-node
  **k3s** on EC2, deployed via **ArgoCD + Kustomize**. See
  [control-plane-k3s.md](./control-plane-k3s.md).

Connected-vs-local-only is **config-driven**: an empty `HORUS_CONTROL_PLANE_URL`
(no `control_plane_url` in `config.yaml`) means local-only. The container set is
identical either way.

> **Why k3s and not EKS?** EKS/Fargate/ECS were evaluated and rejected: the EKS
> control plane alone costs more per month than the entire current single-node k3s
> substrate (~$51/mo). The control-plane runbook documents the k3s deployment that
> is actually in use.

## Source material

These runbooks consolidate and promote earlier validated drafts. When a detail here
disagrees with a draft, **this runbook is the source of truth** going forward:

- `design-artifacts/horus-client-local-setup-runbook.md` — local client (no VM)
- `design-artifacts/horus-client-verification-runbook.md` — EC2 clean-room client variant
- `deploy/ALPHA-INTEGRATION.md` — end-to-end control-plane bring-up
- `deploy/secrets/README.md` — Sealed Secrets procedure

## Conventions

- Every runbook ends each phase with a **verification gate** — an explicit command
  and its expected output. Do not proceed past a red gate.
- Secrets (static JWT bundles, signing keys, tokens) are **never** committed. Paths
  to secret files are shown; their contents are not.
- All user-facing client operations go through the `horus` CLI, never `docker
  compose` directly.
