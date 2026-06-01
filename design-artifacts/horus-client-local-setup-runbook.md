# Horus New-Client Local Setup Runbook (no VM)

**Purpose:** Mint a fresh user bundle via the operator and onboard the new 4-container Horus client
(horus-ui + anvil + typesense + neo4j) **on your local machine** — no throwaway EC2. Use this when
replacing an existing local Horus install with a clean connected client.

**Derived from:** `design-artifacts/horus-client-verification-runbook.md` (the EC2 clean-room
variant). Phases 0 / 1 / 1c are identical; Phase 2 (EC2 provisioning) is dropped; Phase 3 runs
locally with no SCP/SSH. **If the two disagree, the verification runbook is the source of truth.**

**Last validated:** operator-path + bundle shape validated 2026-06-01 against CP
`https://horus.arjunkhera.io` (CLI `@arkhera30/cli@0.8.8`, PR #400). Local-machine Phase 3 path is
adapted, not separately re-validated end-to-end.

---

## Topology under test

- **Client (new):** `horus-ui` (8400, embeds Forge local-exec) + `anvil` (8100) + `typesense` (8108) + `neo4j` (7474/7687). Vault + Forge registry are **remote**; auth is a static JWT bundle.
- **Control plane:** single k3s node, us-east-1, EIP `13.219.32.204`, account `065585372120`. Namespace `horus-system`. Public ingress `https://horus.arjunkhera.io`.

---

## Prerequisites (local host)

| Need | Value / check |
|---|---|
| Docker w/ Compose v2 | Docker Desktop on macOS ships Compose v2 — `docker compose version` must work. (On AL2023 you'd install the plugin manually; not needed on macOS/modern Linux.) |
| Node 20 + CLI | `npm i -g @arkhera30/cli@0.8.8`. Operator subcommands ship in the published CLI ≥ 0.8.8; no worktree build needed. CLI ≥ 0.8.8 supports `--vault <ns=endpoint>` (repeatable). |
| CP SSH key | `~/.ssh/horus-track-a.pem`, user `ubuntu` (mode 600) — required only for the mint tunnel. |
| Tenant | **`default`** — see the CRITICAL note in Phase 1. Do NOT use `alpha`. |

> **Why a tunnel is still needed:** `operator-service` is a ClusterIP, not publicly exposed. Minting
> a bundle requires an SSH tunnel to the CP node. Everything else runs locally.

---

## Phase A — Tear down the existing local client

> Destructive. This removes your current Horus containers (and, if you choose, its data). Confirm
> you have nothing to preserve first.

```bash
horus down                 # stop + remove the current client containers
horus status               # expect: not running
```

If you want a truly clean slate (wipe local data/workspace under `$HORUS_DATA_PATH`), remove that
directory manually — inspect it first, and only delete once you've confirmed the path:

```bash
echo "$HORUS_DATA_PATH"    # confirm the path before removing anything
# rm -rf "$HORUS_DATA_PATH"   # <- run only after you've verified the path and accept data loss
```

---

## Phase 0 — Confirm control plane is live

```bash
ssh -i ~/.ssh/horus-track-a.pem -o StrictHostKeyChecking=accept-new ubuntu@13.219.32.204 \
  'sudo k3s kubectl -n horus-system get pods -o wide'
```

**Expect:** `horus-service` (2/2), `operator-service-0`, `vault-router`, `vault-reader` (2/2),
`vault-writer-0`, `forge-registry`, `typesense-0`, `neo4j-0`, observability stack — all `Running`.

---

## Phase 1 — Mint the user bundle (operator-path health check)

**1a. Open tunnel to operator-service** (pick a fresh high node-side port; `:8090` and `:18090` are
commonly stale-bound):

```bash
ssh -i ~/.ssh/horus-track-a.pem -o ExitOnForwardFailure=yes \
  -L 8090:127.0.0.1:38090 ubuntu@13.219.32.204 \
  'sudo k3s kubectl -n horus-system port-forward svc/operator-service 38090:8090' &
# wait until healthy:
curl -fsS http://127.0.0.1:8090/health
```

> **Gotcha — port conflict.** If you get `bind: address already in use`, pick another fresh high
> node-side port (e.g. `:48090`) for both the `-L` target and the `port-forward`. CP SG opens 22
> (admin IP) + 80/443 (public); 6443 is NOT open, so the tunnel is the only path to operator-service.

**1b. Inspect conventions + mint** (replace `local-arjun` with your chosen user id):

```bash
horus operator status     --operator-url http://127.0.0.1:8090   # health + counts
horus operator user list  --operator-url http://127.0.0.1:8090   # confirms tenant=default in use
horus operator user add local-arjun \
  --tenant default \
  --role registry-admin \
  --vault default=https://horus.arjunkhera.io/api/v1/vault \
  --vault vault-code=https://horus.arjunkhera.io/api/v1/vault \
  --cp-url https://horus.arjunkhera.io \
  --operator-url http://127.0.0.1:8090 \
  --out "$HOME/horus/local-arjun.bundle.yaml"
```

> **CRITICAL — use `--tenant default`, NOT `--tenant alpha`.** The CP vault is single-tenant
> `default`. A token minted with `--tenant alpha` gets `403 TENANT_MISMATCH` on every vault read
> (the connected-mode defect fixed in PR #400). Always mint with `--tenant default` and assign both
> vaults at mint time via the `--vault` flags.

Bundle shape (the token is a secret — keep it OUT of git):
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

> **Role — Forge registry writes.** This runbook mints with **`--role registry-admin`** because the
> client needs to register repos / publish skills+artifacts. A default `--role user` token gets
> **403** on those writes. If you only need read-only client usage, drop to `--role user`.

**1c. Token sanity-check: vault reads MUST return 200** (de-risk before `horus setup`):

```bash
TOKEN=$(grep -E 'config:' "$HOME/horus/local-arjun.bundle.yaml" | sed -E 's/.*config:[[:space:]]*//' | tr -d '"')

# Gateway auth baseline
curl -s -o /dev/null -w "%{http_code}\n" https://horus.arjunkhera.io/api/v1/vault/            # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
     https://horus.arjunkhera.io/api/v1/vault/                                                # expect 200

# Vault-code read (MUST be 200, ~16 results)
curl -s -H "Authorization: Bearer $TOKEN" \
     -X POST https://horus.arjunkhera.io/api/v1/vault/list-by-scope \
     -H "Content-Type: application/json" \
     -d '{"vault":"vault-code","scope":{"repo":"horus"}}' | python3 -m json.tool | grep -c '"id"'
# expect: 16

# Default vault read (MUST be 200, ~1 result)
curl -s -H "Authorization: Bearer $TOKEN" \
     -X POST https://horus.arjunkhera.io/api/v1/vault/list-by-scope \
     -H "Content-Type: application/json" \
     -d '{"vault":"default","scope":{"repo":"horus"}}' | python3 -m json.tool | grep -c '"id"'
# expect: 1
```

**Result key:**
- `401` (no token) → correct gateway baseline.
- `200` on vault root + both list-by-scope calls → token correct, vaults assigned, proceed.
- `403 TENANT_MISMATCH` → re-mint with `--tenant default`.
- `403` on list-by-scope with the right tenant → vaults not assigned at mint; re-mint with `--vault` flags.

> **Known residual:** `default` vault `get-page` by UUID may return CP 502→404 (story `50402b77`).
> The default vault holds one empty placeholder; all `vault-code` content reads fine.

You can close the tunnel after the bundle is minted and sanity-checked (`kill %1` if backgrounded).

---

## Phase 3 — Onboard the new client locally

No SCP, no SSH. The bundle is already on your machine; just point `horus setup` at it.

```bash
horus setup --config "$HOME/horus/local-arjun.bundle.yaml" --yes
```

**Expect (success):** all 4 containers pulled + Healthy → `✔ Static principal token configured —
client is authenticated.` → `Mode: connected`, `Control plane: https://horus.arjunkhera.io`.

---

## Phase 4 — Smoke-test the local client

```bash
horus status                                   # 4 containers healthy; mode connected; control_plane connected
curl -s localhost:8400/health                  # ok [200]
curl -s localhost:8400/api/system/status       # mode connected; anvil/typesense/neo4j/control_plane all connected
curl -s localhost:8400/forge/health            # {"status":"ok","service":"forge-local","embedded":true}
docker ps                                       # anvil, horus-ui, typesense, neo4j all healthy
```

All green → the new local client is onboarded against the live control plane.
