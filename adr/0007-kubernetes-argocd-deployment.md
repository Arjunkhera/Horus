# ADR-0007: Kubernetes + ArgoCD + Kustomize deployment; pinned server image tags

**Status:** accepted
**Date:** 2026-05-28
**Related:** ADR-0001 (unified deployment mode-module), ADR-0002 (two-domain data isolation),
ADR-0004 (layered control plane; horus-service + operator-service split), ADR-0008 (principal
normalization); conversation-state `03619fa6` (Horus Phase 2 design, Sections D + G).

## Context

ADR-0001 and ADR-0002 deliberately left the deployment *mechanism* open ("ops dial"). The Phase 2
design needed to make it concrete for the alpha "one deployment per company" posture, and to do so
without painting us into a SaaS-rebuild corner. The repo had **no existing K8s/Helm/ArgoCD
artifacts** (greenfield); the Forge registry ran on EC2 + Terraform; all service images were
published to GHCR with `:latest`.

Two sub-questions had to resolve together: (1) how the control plane and backends are deployed and
reconciled, and (2) how images are versioned and rolled back, given the client already uses
`:latest` (see ADR/B decision) but `:latest` does not compose with GitOps.

## Decision

**Kubernetes, declaratively managed by ArgoCD over a Kustomize "deploy repo", with pinned
versioned server image tags.**

1. **Kubernetes, any conformant distribution.** Tested against **k3s** for solo / self-hosted
   ("custom enterprise") installs and a **managed control plane** (EKS/GKE/AKS) for production. No
   cloud-specific hard dependencies (no provider LB controller required to function).

2. **Kustomize, not Helm.** `base/<service>/` + `overlays/prod/` (patches, ingress,
   service-discovery ConfigMaps). Plain manifests + overlays, no templating language.

3. **ArgoCD app-of-apps.** A root Application points at `bootstrap/argocd-root-app.yaml`; one child
   Application per service under `apps/<service>.yaml`. ArgoCD owns continuous reconciliation of all
   **non-secret** manifests.

4. **Service topology** (realizes the ADR-0004 split):
   - **horus-service** — Deployment ×1, the **only** public ingress (Edge/Identity + Aggregation).
   - **operator-service** — Deployment ×1, god-mode (user mgmt + Request model + Provisioner).
     **ClusterIP + port-forward only**, no ingress (distinct privilege boundary). SQLite on a PVC.
   - **vault-router** ×1, **vault-reader** ×2–3 (stateless), **vault-writer** StatefulSet ×1 (PVC,
     sole git writer), **forge-registry** ×1 (PVC for SQLite + S3 for artifact bundles),
     **typesense** StatefulSet ×1 (PVC), **neo4j** StatefulSet ×1 (PVC). All **ClusterIP** and
     fenced by **NetworkPolicy** so only horus-service reaches them.
   - Request path: `horus-service → vault-router → vault-reader / vault-writer`.

5. **Forge registry migrates EC2 → K8s.** Keeps S3 for artifact bundles; its SQLite metadata moves
   to a PVC. The EC2 + Terraform + CloudWatch stack is retired (CloudWatch alarms replaced by
   K8s-native observability — see Consequences).

6. **Service discovery is operator-supplied config (ConfigMap), not auto-discovery** (per ADR-0004).
   A `vault-registry` ConfigMap lists provisioned vaults; vault-router and vault-writer mount it and
   **watch + live-reload** (no restart). The Provisioner is the sole writer; the data plane only
   reads.

7. **Server images pin versioned tags in Kustomize.** Deploying a new version = a manifest change
   (commit) that ArgoCD reconciles; **rollback = `git revert`**. This is intentionally **different
   from the client**, which pulls `:latest` and rolls back via local snapshots. The two planes use
   two rollback mechanisms, both real. (`:latest` + GitOps is rejected — ArgoCD tracks git manifest
   changes, not image-digest changes under a fixed tag.)

8. **Bootstrap is idempotent and secret-aware.** operator-service generates the JWT keypair(s) on
   first boot into an idempotent K8s Secret (never blindly recreated); bootstraps an admin from a
   supplied value with **forced rotation** on first login. **Plain K8s Secrets are applied
   out-of-band** via `horus operator init` and are **not** committed to the deploy repo; ArgoCD
   manages only non-secret manifests.

## Alternatives Considered

- **Helm.** Rejected for alpha — templating overhead and value-sprawl exceed the need; Kustomize
  base+overlay is sufficient and more transparent for a small surface.
- **`:latest` server tags with ArgoCD Image Updater.** Rejected — keeps the `:latest` convention but
  adds a write-back-to-git component and complexity; pinned tags give the same GitOps rollback with
  fewer moving parts.
- **Manual `kubectl rollout restart` on `:latest`.** Rejected — no real GitOps rollback; drift
  between git and cluster.
- **Keeping Forge on EC2.** Considered (don't conflate the K8s rollout with a Forge migration), but
  rejected for alpha so the company runs **one** operational model; the EC2 CloudWatch loss is
  replaced by K8s-native observability.
- **Auto-discovery of backends.** Rejected per ADR-0004 — operator-supplied ConfigMap keeps the
  privileged registry write in the Provisioner.

## Consequences

### Positive
- One declarative source of truth (deploy repo) with GitOps reconciliation and `git revert`
  rollback for the whole server side.
- Honors ADR-0004's privilege boundary structurally (operator-service has no ingress; NetworkPolicy
  fences the data plane behind horus-service).
- Works on k3s (solo) and managed K8s (prod) from the same manifests via overlays — no rebuild to
  scale, consistent with ADR-0001/0002's mode/scale dial.
- Vault provisioning is **logical** (Typesense collection + Neo4j database + git repo/subdir +
  ConfigMap entry), not pod creation — fast, resumable, idempotent.

### Negative
- More ops surface than EC2-Docker: a cluster, ArgoCD, and a deploy repo to maintain.
- Server and client now use **different** image-versioning + rollback mechanisms (pinned tags vs
  `:latest` + snapshots) — a documented, deliberate split, but two things to understand.
- Forge EC2→K8s migration is net-new work and drops the existing CloudWatch dashboards/alarms.

### Neutral
- Observability is K8s-native: **Prometheus + Grafana** (all services instrumented), **structured
  JSON logs to stdout** with a propagated `X-Request-ID` across hops, **Alertmanager + ArgoCD
  notifications** replacing the retired forge CloudWatch alarms. Probes are **shallow liveness**
  (`/health`) + **self-scoped readiness** (deep dependency health is scraped to Prometheus, not
  wired to readiness, to avoid cascading outages). Distributed tracing (OTel) is deferred.
- Backup posture: a CronJob snapshots the operator-service and forge-registry **SQLite** DBs to S3;
  Vault content is backed by its git remote; Typesense (reindex) and Neo4j (`_graph/edges.json`
  import) are rebuildable; S3 versioning is enabled on the artifact bucket.

## Updates

_None._
