# Horus New-Client Clean-Room Verification Runbook

**Purpose:** Verify the new 4-container Horus client (horus-ui + anvil + typesense + neo4j)
onboards and works end-to-end against the live control plane, from a *fresh* machine — before
migrating real users off the old/band-aid client.

**When to use:** Before any client cutover, after a CLI release, or after a control-plane change
that touches identity/gateway/vault routing.

**Last validated:** 2026-06-01 (CLI `@arkhera30/cli@0.8.8`, CP at `https://horus.arjunkhera.io`,
connected-vault-bridge fix PR #400). Validated end-to-end on a fresh AL2023 arm64 EC2 (t4g.large).

---

## Topology under test

- **Client (new):** `horus-ui` (8400, embeds Forge local-exec) + `anvil` (8100) + `typesense` (8108) + `neo4j` (7474/7687). Vault + Forge registry are **remote**; auth is a static JWT bundle.
- **Control plane:** single k3s node, us-east-1, EIP `13.219.32.204`, account `065585372120`. Namespace `horus-system`. Public ingress `https://horus.arjunkhera.io`.

---

## Prerequisites (one-time / host)

| Need | Value / check |
|---|---|
| AWS profile for EC2 | `default` = root of `065585372120`; `arkhera` is S3-only. Verify: `aws sts get-caller-identity --profile default` |
| Region | `us-east-1` (profile default is `ap-south-1` — pass `--region us-east-1` explicitly) |
| CP SSH key | `~/.ssh/horus-track-a.pem`, user `ubuntu` (mode 600) |
| operator CLI | Ships in the **published npm CLI ≥ 0.8.8** — `horus operator user add …` works without a worktree build. CLI ≥ 0.8.8 supports `--vault <ns=endpoint>` (repeatable) and emits a bundle with `token_provider.kind: static` and a `vaults:` map. (Worktree build only needed for unreleased operator changes.) |
| GHCR images | Multi-arch (amd64+arm64) → t4g (arm64) or t3 (amd64) both fine. |

> **Gotcha — CP access is tribal.** There is no scripted kubeconfig-fetch or tunnel. Access is SSH-only
> via the key above; on the node use `sudo k3s kubectl`. This runbook scripts the tunnel below.

---

## Phase 0 — Confirm control plane is live  ✅ (validated 2026-06-01)

```bash
ssh -i ~/.ssh/horus-track-a.pem -o StrictHostKeyChecking=accept-new ubuntu@13.219.32.204 \
  'sudo k3s kubectl -n horus-system get pods -o wide'
```

**Expect:** `horus-service` (2/2), `operator-service-0`, `vault-router`, `vault-reader` (2/2),
`vault-writer-0`, `forge-registry`, `typesense-0`, `neo4j-0`, observability stack — all `Running`.
vault-reader/writer with **0 restarts** confirms the GITHUB_TOKEN rotation (bug `3a561b8b`) held.

---

## Phase 1 — Mint the user bundle (also the operator-path health check)  ✅

**1a. Open tunnel to operator-service** (node-side port `18090` avoids a stale `:8090` port-forward):

```bash
ssh -i ~/.ssh/horus-track-a.pem -o ExitOnForwardFailure=yes \
  -L 8090:127.0.0.1:38090 ubuntu@13.219.32.204 \
  'sudo k3s kubectl -n horus-system port-forward svc/operator-service 38090:8090' &
# wait until: curl -fsS http://127.0.0.1:8090/health
```

> **Gotcha — port conflict.** Node-side `:8090` **and** `:18090` are both stale-bound by leftover
> port-forwards (`bind: address already in use`). Pick a fresh high node-side port (e.g. `:38090`).
> Note CP SG opens 22 (admin IP), 80/443 (public); **6443 is NOT open**, so a rewritten-to-EIP
> kubeconfig won't connect directly — the tunnel is the path. A scripted fetch also exists:
> `scripts/get-cp-kubeconfig.sh` + `deploy/ALPHA-INTEGRATION.md` §A1.

**1b. Inspect conventions + mint** (from the published CLI ≥ 0.8.8, or `packages/cli` in the operator worktree):

```bash
node dist/index.js operator status     --operator-url http://127.0.0.1:8090   # health + counts
node dist/index.js operator user list  --operator-url http://127.0.0.1:8090   # confirms tenant=default in use
node dist/index.js operator user add ec2-test \
  --tenant default \
  --vault default=https://horus.arjunkhera.io/api/v1/vault \
  --vault vault-code=https://horus.arjunkhera.io/api/v1/vault \
  --cp-url https://horus.arjunkhera.io \
  --operator-url http://127.0.0.1:8090 \
  --out "$HOME/horus-verify/ec2-test.bundle.yaml"
```

> **CRITICAL — use `--tenant default`, NOT `--tenant alpha`.** The CP vault is single-tenant `default`.
> A token minted with `--tenant alpha` will get `403 TENANT_MISMATCH` on every vault read — this was
> the connected-mode defect fixed in PR #400. Always mint with `--tenant default` and assign both
> vaults at mint time via the `--vault` flags. CLI ≥ 0.8.8 supports `--vault <ns=endpoint>` (repeatable).

Bundle shape (token is a secret — keep OUT of git):
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

> **Role gotcha — Forge registry writes.** A default `--role user` token gets **403** on Forge
> registry writes (repo register / artifact publish). To mint a bundle whose client must register a
> repo or publish skills/artifacts, pass **`--role registry-admin`**. Plain client verification
> (this runbook's happy path) only needs `user`.

**1c. Token sanity-check: vault reads MUST return 200** (de-risks EC2 before spending):

```bash
TOKEN=$(grep -E 'config:' "$HOME/horus-verify/ec2-test.bundle.yaml" | sed -E 's/.*config:[[:space:]]*//' | tr -d '"')

# Gateway auth baseline
curl -s -o /dev/null -w "%{http_code}\n" https://horus.arjunkhera.io/api/v1/vault/            # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
     https://horus.arjunkhera.io/api/v1/vault/                                                # expect 200

# Vault-code read (MUST be 200, ~16 results) — verified 2026-06-01
curl -s -H "Authorization: Bearer $TOKEN" \
     -X POST https://horus.arjunkhera.io/api/v1/vault/list-by-scope \
     -H "Content-Type: application/json" \
     -d '{"vault":"vault-code","scope":{"repo":"horus"}}' | python3 -m json.tool | grep -c '"id"'
# expect: 16

# Default vault read (MUST be 200, ~1 result) — verified 2026-06-01
curl -s -H "Authorization: Bearer $TOKEN" \
     -X POST https://horus.arjunkhera.io/api/v1/vault/list-by-scope \
     -H "Content-Type: application/json" \
     -d '{"vault":"default","scope":{"repo":"horus"}}' | python3 -m json.tool | grep -c '"id"'
# expect: 1
```

**Result key:**
- `401` (no token) → correct gateway baseline.
- `200` on vault root + both list-by-scope calls → token correct, vaults assigned, proceed.
- `403 TENANT_MISMATCH` → token was minted with wrong tenant (re-mint with `--tenant default`).
- `403` on list-by-scope with the right tenant → vaults were not assigned at mint time (re-mint with `--vault` flags).

> **Known residual:** `default` vault `get-page` by UUID may return CP 502→404 (vault-reader
> `uuid_registry`; tracked in story `50402b77`). The default vault holds one empty placeholder;
> all `vault-code` content reads fine.

---

## Phase 2 — Provision throwaway EC2 client box  ✅ (validated 2026-06-01)

Region `us-east-1`, profile `default`. SSH-only ingress (UI reached via SSH tunnel, not exposed).

```bash
mkdir -p "$HOME/horus-verify"; cd "$HOME/horus-verify"
REGION=us-east-1; PROFILE=default
AMI=$(aws ssm get-parameters --region $REGION --profile $PROFILE \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query 'Parameters[0].Value' --output text)               # arm64 AL2023
MYIP=$(curl -s https://checkip.amazonaws.com)
VPC=$(aws ec2 describe-vpcs --region $REGION --profile $PROFILE \
  --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
aws ec2 create-key-pair --region $REGION --profile $PROFILE --key-name horus-ec2-verify \
  --query 'KeyMaterial' --output text > horus-ec2-verify.pem && chmod 600 horus-ec2-verify.pem
SG=$(aws ec2 create-security-group --region $REGION --profile $PROFILE \
  --group-name horus-ec2-verify-sg --description "Horus client verification SSH only" \
  --vpc-id $VPC --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --region $REGION --profile $PROFILE \
  --group-id $SG --protocol tcp --port 22 --cidr ${MYIP}/32
IID=$(aws ec2 run-instances --region $REGION --profile $PROFILE \
  --image-id $AMI --instance-type t4g.large --key-name horus-ec2-verify --security-group-ids $SG \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=horus-ec2-verify}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --region $REGION --profile $PROFILE --instance-ids $IID
PUBIP=$(aws ec2 describe-instances --region $REGION --profile $PROFILE --instance-ids $IID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
# Persist REGION/PROFILE/AMI/VPC/SG/KEY/IID/PUBIP to verify-env.sh for later phases.
```

---

## Phase 3 — Bootstrap + onboard the new client  ✅

SSH user is `ec2-user`. **Two gotchas**, both scripted below.

```bash
KEYPEM="$HOME/horus-verify/horus-ec2-verify.pem"
# 3a. Docker + Node 20 + CLI. (usermod -aG docker takes effect on the NEXT ssh session.)
ssh -i "$KEYPEM" ec2-user@$PUBIP 'bash -s' <<'SH'
set -e
sudo dnf install -y docker && sudo systemctl enable --now docker && sudo usermod -aG docker ec2-user
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs
sudo npm i -g @arkhera30/cli@0.8.8
SH
# 3b. GOTCHA: AL2023 'docker' package ships WITHOUT the compose v2 plugin → CLI reports
#     "No container runtime found". Install the plugin explicitly:
ssh -i "$KEYPEM" ec2-user@$PUBIP 'bash -s' <<'SH'
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
SH
# 3c. Transfer bundle + run setup (pulls 4 images, runs login). New ssh session → docker group active.
scp -i "$KEYPEM" "$HOME/horus-verify/ec2-test.bundle.yaml" ec2-user@$PUBIP:/home/ec2-user/
ssh -i "$KEYPEM" ec2-user@$PUBIP 'horus setup --config /home/ec2-user/ec2-test.bundle.yaml --yes'
```

**Expect (success):** all 4 containers pulled + Healthy → `✔ Static principal token configured — client is
authenticated.` → `Mode: connected`, `Control plane: https://horus.arjunkhera.io`.

---

## Phase 4 — Tier-2 verification suite  ✅ (all green 2026-06-01)

Run on the box (`ssh -i "$KEYPEM" ec2-user@$PUBIP`):

| Check | Command | Result |
|---|---|---|
| 4 containers healthy | `docker ps` / `horus status` | anvil, horus-ui, typesense, neo4j all `healthy` |
| UI health | `curl -s localhost:8400/health` | `ok [200]` |
| Forge embedded | `curl -s localhost:8400/forge/health` | `{"status":"ok","service":"forge-local","embedded":true}` |
| System status | `curl -s localhost:8400/api/system/status` | mode `connected`; anvil/typesense/neo4j/**control_plane** all `connected`; tabs available |
| Gateway auth (from any host w/ token) | `curl … https://horus.arjunkhera.io/api/v1/vault/` | `401` no token → `200` with correctly-minted token |
| Anvil MCP round-trip (local) | MCP handshake → `tools/list` (27 tools) → `anvil_create_note {type,title,content}` → confirm file on disk | note `ec2-verify-roundtrip.md` persisted with correct frontmatter |

> **MCP transport note.** `/api/anvil/*`, `/api/v1/vault/*`, `/api/v1/forge/*` are **MCP-over-HTTP**, not REST.
> A plain `GET` returns `406 "must accept text/event-stream"` — that is the *correct* live signal, not a fault.
> To exercise them: POST JSON-RPC with `Accept: application/json, text/event-stream`, capture the
> `Mcp-Session-Id` response header from `initialize`, send `notifications/initialized`, then `tools/call`.

> **Anvil search lag.** A just-created note is not immediately returned by `anvil_search` (Typesense indexes
> async). Read back by `noteId` via `anvil_get_note` (arg name is `noteId`, not `id`) or check the file on disk.

### Phase 4 — Vault MCP verification  ✅ (verified 2026-06-01)

After `horus setup --config <bundle> --yes`, the in-process vault bridge is available at
`http://localhost:8400/vault/mcp`. Verify it via MCP handshake (initialize → tools/list → tools/call):

**4a. Bridge health:**
```bash
curl -s http://localhost:8400/vault/health
# expect: {"service":"vault-local", ...}
```

**4b. tools/list includes all 17 knowledge_* tools** (not just anvil_*):
```bash
# MCP initialize + tools/list; capture Mcp-Session-Id from initialize response header
SESSION=$(curl -s -D - -X POST http://localhost:8400/vault/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}' \
  | grep -i 'mcp-session-id' | awk '{print $2}' | tr -d '\r')
curl -s -X POST http://localhost:8400/vault/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | grep -o '"knowledge_[^"]*"' | sort
# expect: 17 knowledge_* tools (knowledge_check_duplicates, knowledge_create_edge, knowledge_delete_edge,
#   knowledge_export_graph, knowledge_get_edges, knowledge_get_page, knowledge_get_related,
#   knowledge_get_schema, knowledge_import_graph, knowledge_list_by_scope, knowledge_registry_add,
#   knowledge_resolve_context, knowledge_search, knowledge_suggest_metadata, knowledge_traverse_graph,
#   knowledge_validate_page, knowledge_write_page)
```

**4c. knowledge_list_by_scope + knowledge_get_page (vault-code):**
```bash
# list-by-scope must return ~16 pages
curl -s -X POST http://localhost:8400/vault/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"knowledge_list_by_scope","arguments":{"vault":"vault-code","scope":{"repo":"horus"}}}}' \
  | python3 -m json.tool | grep -c '"id"'
# expect: 16 (verified 2026-06-01)

# knowledge_get_page on each returned id must return full body (verified 16/16 2026-06-01)
```

**4d. knowledge_search:**
```bash
curl -s -X POST http://localhost:8400/vault/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"knowledge_search","arguments":{"vault":"vault-code","query":"horus"}}}' \
  | python3 -m json.tool | grep '"total"'
# expect: total > 0 (verified total=10, 2026-06-01)
```

**4e. anvil horus_search with source=vault (cross-system):**
```bash
# Via Anvil MCP at localhost:8400/api/anvil (use same MCP handshake pattern)
# horus_search {source:"vault"} → total > 0 (verified total=16, 2026-06-01)
```

> **Vault MCP result summary (2026-06-01):** vault-code list-by-scope=16, knowledge_search total=10,
> anvil horus_search(source=vault) total=16, vault/health service=vault-local. All 200.

---

## Phase 4b — Global skill + SDLC/registry provisioning  ⚠️ (NOT yet verified — defect found)

When the client comes up it is supposed to install/refresh **global skills** into the AI client.
This was **not exercised** in the 2026-06-01 run (the EC2 box had no AI client). Two tracks:

**Track 1 — horus-core global skills (via `horus connect`).**
- Mechanism: `horus setup` step 11 / `horus connect --target claude-code` runs `syncSkills`
  (`packages/cli/src/commands/connect.ts`): reads `<container>/.claude/skills/<skill>/SKILL.md` and
  writes `~/.claude/skills/<skill>/SKILL.md` (Cursor → `~/.cursor/rules/*.mdc` + `~/.cursor/skills-cursor/`).
- Global set (6): `horus-anvil`, `horus-vault`, `horus-forge`, `horus-context`, `capture`, `triage`.
- **KNOWN DEFECT (blocks updated-skill install on the new client):** `connect.ts` hardcodes the
  source container as **`horus-forge-1`** (lines 193/203/217). The new 4-container client has **no
  forge container** (Forge is embedded in `horus-horus-ui-1`). So `runtime.exec('horus-forge-1', …)`
  fails and skill sync **silently warns + skips** (line 350: *"Could not sync skills (Forge container
  may not be running)"*). **Result: the new client does NOT install/update global skills.** Fix =
  point the sync at `horus-horus-ui-1` and confirm the horus-ui image bakes `.claude/skills/`.
  (Owned by the in-flight skills work — confirm scope.)
- **Verify (next clean-room pass):**
  ```bash
  # on the box, with an AI client installed (e.g. Claude Code) and `horus up` running:
  horus connect --target claude-code           # expect: "horus-core skills synced to ~/.claude/skills/"
  ls ~/.claude/skills/                          # expect 6 dirs, each with SKILL.md
  grep -l . ~/.claude/skills/horus-*/SKILL.md   # content present + matches current image versions
  ```

**Track 2 — SDLC skills/artifacts (Forge remote registry, "new format").**
- SDLC skills (orchestrator, planner, developer, tester, reviewer, story, project, docs, …) are **not**
  in the global `connect` set. They are **workspace-scoped**, installed from the Forge registry via
  `forge install`, and are being migrated to the **versioned artifact layout** (`skills/<id>/<semver>/metadata.yaml`
  vs legacy flat `skills/<id>/metadata.yaml`; schema in `@forge/core` `skill-meta.ts`).
- Migration of SDLC skill *content* to Anvil V2 APIs is tracked by Anvil story **`f9c43d31`** (open).
- **Dependency:** these must be re-published in the new format before a client's `forge install` pulls
  correct SDLC artifacts. (Owned by the in-flight work — not verified here.)

**Track 3 — Register the Horus repo in the Forge git registry.**
- Mechanism: MCP `forge_repo_register {org,name,canonicalUrl}` (`mcp-server/src/index.ts:193`) / CLI
  `horus repo` (+ `horus repo migrate --registry <url>`). Shared S3-backed registry landed PR #361.
- Requires a **`registry-admin`-role** token (see Phase 1 role gotcha) — a `user` token gets 403.
- **Status:** infra present; the actual `horus` repo entry registration is in-flight (no tracking story found).

---

## Phase 5 — Teardown  ✅

```bash
cd "$HOME/horus-verify"; source verify-env.sh
aws ec2 terminate-instances --region $REGION --profile $PROFILE --instance-ids $IID
aws ec2 wait instance-terminated --region $REGION --profile $PROFILE --instance-ids $IID
aws ec2 delete-security-group --region $REGION --profile $PROFILE --group-id $SG
aws ec2 delete-key-pair    --region $REGION --profile $PROFILE --key-name $KEY
shred -u horus-ec2-verify.pem; rm -f ec2-test.bundle.yaml          # scrub local secrets
```

> **Operator test user is NOT auto-removed.** There is no `operator user remove` command; the minted
> token expires on its TTL (default 86400s / 24h). The `ec2-test` user record remains in operator-service's
> SQLite. Harmless; clean up directly in the DB if it matters.

---

## Findings log (2026-06-01 run)

- ✅ Control plane fully deployed & healthy (Seq 2). All pods Running.
- ✅ Bug `3a561b8b` (vault token) held — vault pods 16h, 0 restarts after PAT rotation.
- ✅ Bug `2baad981` (operator vault provisioning) effectively fixed — `vault_create` reaches `provisioned`.
- ✅ Operator bundle minting works end-to-end (POST /requests → /tokens → bundle).
- ✅ Gateway auth pipeline correct: 401 (no token) → 200 (token minted with `--tenant default` + `--vault` flags).
- ✅ **Fresh-box onboarding works end-to-end** (t4g.large arm64, AL2023): CLI 0.8.8 → setup → 4 healthy containers → authenticated to CP. Mode `connected`.
- ✅ **Anvil local write+read proven** — note persisted to git-backed store inside the client.
- ✅ All `/api/system/status` subsystems `connected` (incl. control_plane over the public gateway).
- ✅ **Vault MCP bridge verified** — vault-code list-by-scope=16, knowledge_search total=10, horus_search(source=vault) total=16, vault/health service=vault-local. All 200.
- ⚠️ CP access is tribal (SSH-only, no scripted kubeconfig/tunnel) — scripted in this runbook (Phase 1a).
- ⚠️ AL2023 `docker` package lacks the Compose v2 plugin — must install manually (Phase 3b).
- ⚠️ `agent_chat.enabled=false` until an AI client / API key is configured (`horus connect`) — not exercised here.
- 🛑 **Global skill sync is broken on the new topology** — `connect.ts` reads skills from a `horus-forge-1`
  container that no longer exists; sync silently warns + skips. New clients install no global skills until fixed.
- ⚠️ SDLC skills are workspace-scoped (Forge registry, new versioned format), not part of global `connect`;
  re-publish + Horus repo git-registry registration are in-flight (owned by another engineer).
- ⚠️ **Known residual: default-vault `get-page` by UUID returns CP 502→404** (vault-reader `uuid_registry`; tracked
  in story `50402b77`). The default vault holds one empty placeholder; all vault-code content reads fine.

> **Validated end-to-end 2026-06-01** on a fresh AL2023 arm64 EC2 with CLI 0.8.8 + the connected-vault-bridge
> fix (PR #400). Previous runs (CLI 0.8.2) minted with `--tenant alpha` and no `--vault` flags, resulting in
> `403 TENANT_MISMATCH` on every vault read — that was the connected-mode defect. The corrected flow
> (this runbook) mints `--tenant default` with both vaults assigned; the connected client then reads all vault content.

## Outstanding before user cutover

1. **🛑 Fix global-skill sync on the new topology** — `connect.ts` targets the non-existent `horus-forge-1`
   container, so the client silently installs **no** global skills. Repoint to `horus-horus-ui-1` (+ confirm
   the horus-ui image bakes `.claude/skills/`), then verify per Phase 4b Track 1. *(In-flight skills work — confirm scope.)*
2. **Re-publish SDLC skills/artifacts in the new versioned format** to the Forge registry so client
   `forge install` pulls correct artifacts (story `f9c43d31` open). *(In-flight.)*
3. **Register the `horus` repo in the Forge git registry** with a `registry-admin` token (Phase 4b Track 3). *(In-flight.)*
4. **Resolve default-vault uuid_registry (story `50402b77`)** — `get-page` by UUID on the default vault returns 502→404 via vault-reader. Low priority (default vault holds one empty placeholder; vault-code reads fully).
5. **(Optional) verify `agent_chat`** by configuring an AI client on the box (`horus connect`).
6. Core onboarding + Anvil/local + CP connectivity + **Vault MCP bridge** verified green. **Skill provisioning (1–3) is the
   remaining functional gap** for a complete client experience.
