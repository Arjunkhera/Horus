# ADR-0002: Two-domain data isolation; Anvil is a separate per-user infra domain

**Status:** accepted
**Date:** 2026-05-19
**Related:** Decision journal `6a553c77` (design-proposal `eee11da4` questions A3, C4); ADR-0001; story `e745a54d`

## Context

Given the decided unified topology (ADR-0001), the open question (design-proposal `eee11da4`
A3 and C4) was: where does the tenant/user boundary physically sit for the heavy stateful
infra (Typesense, Neo4j, primary storage)? Anvil is high-volume/high-churn/exploding data;
Forge and Vault are low-volume and stable. Vault's core value is succinct, accurate recall,
and Typesense relevance is per-collection.

## Decision

**Two distinct infra domains:**

1. **Anvil domain — separate and per-user, in BOTH modes.** Each Anvil-user gets their own
   Typesense **collection** plus their own Neo4j **database**. Collection/db granularity is
   fixed in the data model from day one. Deployment form is an ops dial on the mode module:
   own instance per user at alpha/handful-of-users scale → collection-per-user /
   db-per-user on one shared Anvil cluster at scale. No data-model rebuild between the two —
   same granularity throughout.
2. **Forge + Vault domain — tenant-shared.** One Typesense + Neo4j backing, shared within
   the tenant in enterprise mode; per-user in SaaS mode (SaaS tenant = 1 user). Vault still
   partitions internally via the vault-router multi-instance pattern.
3. **`horus_search` becomes a federated query** across the Anvil per-user domain and the
   Forge/Vault shared domain, results merged — the same federation pattern already being
   invested in for the Vault V3 router.

## Alternatives Considered

### All-in-one per-user siloed stack with Anvil NOT split out (Option 2)
Simpler, fewer moving parts, but re-merges Anvil churn with Vault curation and loses
relevance protection; rejected because Vault recall quality is sacred to the vision.

### Pooled single shared store with tenant_id (Option 1)
Cheapest, but rejected: weakest isolation, breaks the enterprise air-gap promise.

### Hybrid pooled search/graph (Option 3)
Dominated by the chosen collection/db-granularity approach at similar cost.

## Consequences

### Positive
- Different data physics are respected — Anvil's noisy corpus does not degrade Vault's
  curated corpus.
- Protects Vault's core value: Typesense relevance is per-collection, so isolating Anvil
  defends the Vault V3 thesis.
- Clean per-user lifecycle — deprovision = drop the user's Anvil collection/db, with no
  risky filtered deletes on shared state.
- It is the scaling seam: instance-per-user → shared-cluster-with-namespace is a
  mode-module ops dial; single-user → enterprise growth needs no data reshaping.

### Negative
- `horus_search` is now a federated cross-domain query (more engineering) — accepted
  because it reuses the Vault-router federation investment and improves relevance.
- Two infra domains to operate instead of one.

### Neutral
- Resolves C4: Anvil no longer co-owns a shared Typesense collection with Vault/Forge.
  The control plane provisions per-user Anvil namespaces; a neutral owner bootstraps the
  Forge/Vault shared collection.

## Updates

_None._
