---
title: Set Up a Horus Client
description: Install and run the 4-container Horus client — local-only or connected to a remote control plane — and verify it end-to-end.
slug: runbook-client-setup
tags: [runbook, onboarding, client, setup, cli]
schema_version: 1
keywords: [client, setup, install, onboard, bundle, connected, local-only, local only, token, jwt, vault, forge, horus up, horus down, horus status, smoke test, verify]
related_commands: [horus setup, horus up, horus down, horus status, horus doctor, horus login]
sidebar_position: 10
---

# Runbook — Set Up a Horus Client

**Purpose:** Get a working Horus client (horus-ui + anvil + typesense + neo4j) running
on a user's machine, in either **local-only** mode (no remote dependencies) or
**connected** mode (authenticated to a remote control plane for Vault + Forge).

**Audience:** the end user setting up their own machine, or an operator onboarding
someone.

**Source:** consolidates `design-artifacts/horus-client-local-setup-runbook.md` and
`design-artifacts/horus-client-verification-runbook.md`. The CLI implementation lives
in `packages/cli/src/commands/setup.ts`; the Compose template it generates is
`packages/cli/compose/docker-compose.yml`.

---

## Decide your mode first

| Mode | When | What you need |
|------|------|---------------|
| **Local-only** | Trying Horus solo; no shared Vault/Forge; offline-friendly | Docker + the CLI. No token. |
| **Connected** | Joining a team's control plane; shared remote Vault + Forge registry | A **user bundle** (static JWT) minted by an operator, *or* the operator must mint one for you — see [control-plane-k3s.md](./control-plane-k3s.md) §"Onboard a user". |

The container set is identical in both modes — the only difference is whether
`control_plane_url` / `HORUS_CONTROL_PLANE_URL` is set. You can start local-only and
connect later.

---

## Prerequisites (local host)

| Need | Check |
|------|-------|
| **Docker 24+** (or Podman 4+) with Compose v2 | `docker compose version` must work. Docker Desktop on macOS ships Compose v2; on AL2023/Linux install the plugin. |
| **Node 18+** + the CLI | `npm install -g @arkhera30/cli` then `horus --version`. For connected mode against the current alpha CP, use **≥ 0.8.8** (adds repeatable `--vault <ns=endpoint>` and the operator subcommands). |
| **An AI client** (optional but expected) | Claude Desktop, Claude Code, or Cursor — setup can auto-wire MCP servers into them. |
| **Connected mode only:** a user bundle | A `*.bundle.yaml` file containing `control_plane_url`, a `token_provider` (static JWT), and `vaults`. Keep it OUT of git. |

> Horus auto-detects Docker vs Podman. In interactive setup it prompts you to pick
> when both are installed; with `--yes` it uses `--runtime <docker|podman>` or the
> first available.

---

## Path A — Local-only quickstart

The fastest way to a running client with no remote dependencies.

```bash
horus setup --local-only --yes
```

This writes `~/Horus/config.yaml` + `~/Horus/.env`, generates the Compose file,
pulls the four images, starts them, and polls until healthy (up to ~10 min on first
pull). Then jump to [Phase V — Verify](#phase-v--verify).

> **Optional — Anvil notes repo.** To back your notes with a git repo, pass
> `--anvil-repo https://github.com/<you>/<notes>.git` (HTTPS, not SSH — containers
> don't have your SSH keys; set `GITHUB_TOKEN` in `~/Horus/.env` for private repos).
> An empty repo is fine; Horus clones it on first boot.

---

## Path B — Connected setup (pre-provisioned bundle)

Use this when an operator has already minted a bundle for you (the common case).

### B1. Verify the bundle is well-formed

The bundle is YAML of this shape (the `config` value is a secret JWT — never commit):

```yaml
version: "1"
control_plane_url: https://horus.arjunkhera.io
token_provider:
  kind: static
  config: <static JWT>
vaults:
  default: https://horus.arjunkhera.io/api/v1/vault
  vault-code: https://horus.arjunkhera.io/api/v1/vault
```

### B2. (Recommended) Sanity-check the token *before* setup

De-risk by confirming the token authenticates against the gateway. Replace the host
if your control plane differs.

```bash
BUNDLE="$HOME/horus/local-arjun.bundle.yaml"   # path to your bundle
TOKEN=$(grep -E 'config:' "$BUNDLE" | sed -E 's/.*config:[[:space:]]*//' | tr -d '"')
CP=https://horus.arjunkhera.io

# Gateway baseline — no token must be rejected, token must be accepted.
curl -s -o /dev/null -w "%{http_code}\n" "$CP/api/v1/vault/"                       # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "$CP/api/v1/vault/"  # expect 200
```

**Gate B2:**
- `401` then `200` → token valid, proceed.
- `403 TENANT_MISMATCH` → the bundle was minted with the wrong tenant. Ask the
  operator to re-mint with `--tenant default` (see control-plane runbook).
- `403` on a vault read with the right tenant → vaults not assigned at mint; re-mint
  with the `--vault` flags.

### B3. Run setup against the bundle

```bash
horus setup --config "$BUNDLE" --yes
```

**Expect:** all 4 containers pulled + healthy → `✔ Static principal token configured —
client is authenticated.` → `Mode: connected`, `Control plane:
https://horus.arjunkhera.io`.

> If a token wasn't shipped in the bundle (`token_provider.kind: none`), finish auth
> after setup with `horus login`.

---

## Path C — Connected setup (interactive, no bundle yet)

If you don't have a bundle and an operator can't hand you one, you can configure the
control-plane URL interactively and authenticate separately:

```bash
horus setup            # prompts for control-plane URL + token provider (static/oidc/none)
horus login            # completes auth if you chose 'none'
```

An unreachable control-plane URL only **warns** — setup still completes — so the
client comes up; fix connectivity and re-run `horus login`. To actually obtain a
token, an operator must mint your user — see
[control-plane-k3s.md](./control-plane-k3s.md).

---

## Phase V — Verify

Run after any path above. This is the smoke test that proves the client is healthy.

```bash
horus status                                   # 4 containers healthy; shows mode + control_plane state
curl -s localhost:8400/health                  # ok [200]
curl -s localhost:8400/api/system/status       # per-service: anvil / typesense / neo4j (+ control_plane if connected)
curl -s localhost:8400/forge/health            # {"status":"ok","service":"forge-local","embedded":true}
docker ps                                       # anvil, horus-ui, typesense, neo4j all healthy
```

**Verification gate:**
- **Local-only:** `horus status` shows mode `local-only`; anvil/typesense/neo4j
  connected; the four containers healthy.
- **Connected:** as above **plus** `control_plane` connected in
  `/api/system/status`, and `horus status` reports `Mode: connected`.

Open `http://localhost:8400` in a browser — the UI should load. In local-only mode
the Vault/Forge/Admin tabs are disabled by design.

---

## Day-2 operations

```bash
horus status      # health + mode
horus down        # stop + remove containers (data persists under ~/Horus/data)
horus up          # start again (pulls newer GHCR images if available)
horus doctor      # diagnose common setup/connectivity problems
```

To switch a local-only client to connected later, re-run `horus setup --config
<bundle> --yes`. To wipe and start clean, `horus down`, then (after confirming the
path) remove `$HORUS_DATA_PATH`.

> **Never** edit the generated `~/Horus/docker-compose.yml` by hand — `horus setup`
> regenerates it from the CLI template and your edits are lost. Service-runtime fixes
> belong in `packages/cli/compose/docker-compose.yml` and ship via a CLI release.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `docker compose version` fails | Compose v2 not installed. Install Docker Desktop (macOS) or the compose plugin (Linux). |
| Setup hangs on "pulling images" | First pull of 4 images; allow up to ~10 min. Check network / GHCR reachability. |
| `403 TENANT_MISMATCH` on vault reads | Bundle minted with wrong tenant; re-mint with `--tenant default`. |
| `403` on Forge writes (register repo / publish) | Token role too low; needs `--role registry-admin` at mint time. |
| `control_plane` shows unreachable in `/api/system/status` | CP down or URL wrong; verify with the §B2 curl checks; run `horus login`. |
| Containers unhealthy after start | `horus doctor`, then `docker logs <container>`; Neo4j has a 60s start period. |
