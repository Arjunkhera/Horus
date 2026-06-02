---
name: horus-onboard-user
description: Use this skill to onboard a user onto a Horus control plane — either as the OPERATOR minting a connection bundle (tenant/role/vault assignment, optional vault provisioning) or as the USER setting up their local client from a bundle. Triggers on "onboard a user", "add a user to horus", "mint a bundle", "set me up on the horus service", "connect me to the control plane", "give X access", "provision a vault for X", "I got a bundle, set me up". Routes the many onboarding variables (existing anvil repo, existing install, connected vs local-only, vault assignment vs provisioning) to the right `horus operator …` / `horus setup` commands. Procedure detail lives in docs/runbooks/.
---

# horus-onboard-user

Onboarding a user to a Horus control plane is variable-heavy but every step is an
existing CLI command. This skill is the **decision engine** — it asks the right
questions and runs the right command in the right order. It does not reimplement
anything; the step-by-step procedures live in the runbooks:

- `docs/runbooks/client-setup.md` — client install (local-only / connected / verify)
- `docs/runbooks/control-plane-k3s.md` — control-plane deploy + §"Onboard a user"

## When this skill fires

| The user says… | Mode |
|---|---|
| "onboard X", "add a user", "mint a bundle for X", "give X access", "provision a vault for X" | **Operator** |
| "set me up", "I got a bundle", "connect me to the control plane", "onboard me" | **User** |

If it's ambiguous, ask one question: *"Are you minting a bundle for someone else
(operator), or setting up your own machine from a bundle (user)?"*

## Mode A — Operator (mint a bundle)

Requires access to `operator-service` (ClusterIP — not public). Reach it via the SSH
tunnel from `control-plane-k3s.md` §6, or pass `--operator-url` if it's already
forwarded.

### A1. Confirm operator reachability

```bash
curl -fsS http://127.0.0.1:8090/health          # via the tunnel
horus operator status --operator-url http://127.0.0.1:8090
horus operator user list --operator-url http://127.0.0.1:8090   # confirms tenant=default in use
```

> **Tunnel gotcha:** if `bind: address already in use`, pick a fresh high node-side
> port (e.g. `:48090`) for both the `-L` target and the `port-forward`. Port 6443 is
> closed, so the tunnel is the only path to operator-service.

### A2. Decide the bundle parameters

| Parameter | Default | Decide |
|---|---|---|
| **tenant** | `default` | **Always `default`** unless you know otherwise. A wrong tenant → `403 TENANT_MISMATCH` on every vault read. |
| **role** | `user` | `registry-admin` if the user must register repos / publish Forge artifacts; otherwise `user` (Forge writes 403). |
| **vaults** | — | Which vault namespaces to assign (see A3). |
| **ttl** | `86400` | Initial token lifetime in seconds. |

### A3. Vault: assign existing vs provision new

**Default — assign existing** (covers most onboarding, no provisioning):

```bash
horus operator user add <user-id> \
  --tenant default --role <user|registry-admin> \
  --vault default=https://<cp-host>/api/v1/vault \
  --vault vault-code=https://<cp-host>/api/v1/vault \
  --cp-url https://<cp-host> \
  --operator-url http://127.0.0.1:8090 \
  --out "<user-id>.bundle.yaml"
```

**Opt-in — provision a NEW vault first** (only when the user needs their own). This is
a two-step **request → approve** flow:

```bash
# 1. File a provisioning request. --adapter git-subdir carves a subdir in the
#    backing knowledge repo; use --endpoint for a dedicated upstream instead.
horus operator vault create --namespace <owner/ns> --tenant default \
  --adapter git-subdir --operator-url http://127.0.0.1:8090     # returns a request id

# 2. Approve it (operator action — actually provisions).
horus operator request list  --operator-url http://127.0.0.1:8090
horus operator request approve <request-id> --operator-url http://127.0.0.1:8090

# 3. Then assign the new namespace at user add time (add another --vault flag).
```

> Discuss the adapter choice with the requester: `git-subdir` (shared knowledge repo,
> simplest) vs a dedicated repo via `--endpoint`. Provisioned vaults become
> searchable only after the writer's per-vault sync loop runs on first write.

### A4. Hand off

- The bundle's `token_provider.config` is a **static JWT — a secret**. Deliver it
  out-of-band (not git, not Slack history). 
- Tell the user to follow Mode B (or `docs/runbooks/client-setup.md` Path B).
- Optional sanity check before handing off: run the §B2 token curl from
  `client-setup.md` and confirm `200` on a vault read.

## Mode B — User (set up from a bundle)

This is the variable-heavy half. Walk these decisions, then run setup.

### B1. Existing local install?

```bash
horus status        # is something already running?
```

- Replacing a previous client → `horus down` first (and confirm whether to wipe
  `$HORUS_DATA_PATH` — destructive; verify the path before any `rm`).
- Fresh machine → continue.

### B2. The decision checklist

| Variable | Ask / detect | Action |
|---|---|---|
| **Have a bundle?** | yes / no | yes → connected setup (B3). no + just trying Horus → `horus setup --local-only --yes` and stop. no + needs access → go get one minted (Mode A). |
| **Anvil notes repo** | already have one? | **Have one:** pass `--anvil-repo <https-url>`. **Known bug:** an empty `repos.anvil_notes` in the bundle can silently override `--anvil-repo` — after setup, verify `config.yaml` `repos.anvil_notes` is your URL; if blank, `horus config set` it (or re-run). **None:** omit the flag; Horus creates an empty notes dir. |
| **Private repos** | any private git URLs? | set `GITHUB_TOKEN` in `~/Horus/.env` (HTTPS only — containers don't have your SSH keys). |
| **AI clients** | Claude Desktop / Code / Cursor installed? | let setup auto-wire MCP, or run `horus connect` later. |

### B3. Run setup + verify

```bash
horus setup --config "<bundle>.yaml" --anvil-repo <url-if-any> --yes
horus login          # only if the bundle's token_provider.kind is 'none'
```

Then the verification gate (from `client-setup.md` §Phase V):

```bash
horus status                                   # 4 containers healthy; Mode: connected
curl -s localhost:8400/api/system/status       # anvil/typesense/neo4j + control_plane connected
curl -s localhost:8400/forge/health            # {"status":"ok","embedded":true}
```

## Guardrails

- **Never echo or commit the static JWT.** It's the user's credential.
- **`--tenant default`** unless explicitly told otherwise — the single most common
  onboarding failure is a tenant mismatch.
- **Don't reimplement** the procedures — run the CLI commands and point at the
  runbooks for detail. If a command doesn't exist, that's a gap to file, not to
  hand-roll around.
- **Provisioning is opt-in.** Default to assigning existing vaults; only provision
  when the user genuinely needs their own.
