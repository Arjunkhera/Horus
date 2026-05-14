# Forge Registry — Enterprise Deployment Runbook

> **Audience:** Arjun (v1 is high-touch — you deploy for customers).
> This document covers everything needed to stand up a customer's private
> Forge Registry instance, configure auth, smoke-test it, rotate keys, and
> back it up.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Environment Variable Reference](#environment-variable-reference)
4. [Provisioning](#provisioning)
   - [Step 1 — Prepare Storage](#step-1--prepare-storage)
   - [Step 2 — Configure Auth](#step-2--configure-auth)
   - [Step 3 — Write the .env File](#step-3--write-the-env-file)
   - [Step 4 — Start the Stack](#step-4--start-the-stack)
5. [Smoke Testing](#smoke-testing)
6. [Key Rotation (Builtin Auth)](#key-rotation-builtin-auth)
7. [Backup and Restore](#backup-and-restore)
   - [SQLite Database](#sqlite-database-audit-log--auth-keys)
   - [S3 Object Store](#s3-object-store)
8. [Auth Strategy Guide](#auth-strategy-guide)
   - [builtin](#builtin)
   - [trusted-headers](#trusted-headers)
   - [webhook (OPA/Rego example)](#webhook-oparego-example)
9. [No Federation](#no-federation)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker Engine ≥ 24 + Docker Compose v2 | `docker compose version` to verify |
| An S3-compatible object store | AWS S3, GCS (S3-interop), MinIO, Backblaze B2, Cloudflare R2 |
| A bucket with read/write permissions | The registry needs `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`, `s3:HeadObject` |
| TLS termination upstream | The registry speaks plain HTTP; TLS must be handled by your edge proxy (nginx, Caddy, Envoy, AWS ALB, etc.) |
| A persistent volume for the SQLite DB | Docker named volume or a host-mounted path |

The registry image is:
```
ghcr.io/arjunkhera/forge-registry:latest
```

Pull it to verify access before proceeding:
```bash
docker pull ghcr.io/arjunkhera/forge-registry:latest
```

---

## Architecture Overview

```
Internet
   │
   ▼ HTTPS
┌──────────────────┐
│   Edge Proxy     │  nginx / Caddy / Envoy / ALB
│   (TLS + auth)   │
└────────┬─────────┘
         │ HTTP :8744
         ▼
┌────────────────────────────┐
│   forge-registry           │  ghcr.io/arjunkhera/forge-registry:latest
│   Port: 8744               │
│   DB: /data/registry/*.db  │  ◄── Named Docker volume
└────────┬───────────────────┘
         │
         ├──► S3 (AWS / MinIO / etc.)  ◄── artifact blobs + manifests
         └──► Typesense :8108          ◄── full-text search (optional)
```

This instance is fully isolated. There is no federation or auto-sync to the
public Horus global registry.

---

## Environment Variable Reference

All `FORGE_REGISTRY_*` variables are read at startup. Env vars take precedence
over values in the YAML config file.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGE_REGISTRY_HOST` | `0.0.0.0` | Bind address inside the container |
| `FORGE_REGISTRY_PORT` | `8744` | HTTP port inside the container |
| `FORGE_REGISTRY_CORE_VERSION` | `0.1.0` | Forge-core semver for compatibility checks |
| `FORGE_REGISTRY_LOG_LEVEL` | `info` | Log level: `fatal` `error` `warn` `info` `debug` `trace` |
| `FORGE_REGISTRY_CONFIG` | _(none)_ | Path to a YAML config file inside the container |
| `FORGE_REGISTRY_DB_PATH` | `/data/registry/forge-registry.db` | SQLite database path (must be on a persistent volume) |

### Storage (S3)

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGE_REGISTRY_S3_BUCKET` | _(required)_ | S3 bucket name |
| `FORGE_REGISTRY_S3_REGION` | `us-east-1` | AWS region |
| `FORGE_REGISTRY_S3_PREFIX` | `` | Optional key prefix, e.g. `registry/` |
| `FORGE_REGISTRY_S3_ENDPOINT` | _(none)_ | Custom endpoint for MinIO, R2, etc. |
| `FORGE_REGISTRY_S3_FORCE_PATH_STYLE` | `false` | Set `true` for MinIO and other path-style stores |
| `FORGE_REGISTRY_S3_ACCESS_KEY_ID` | _(required)_ | S3 access key ID — **env only, never in YAML** |
| `FORGE_REGISTRY_S3_SECRET_ACCESS_KEY` | _(required)_ | S3 secret access key — **env only, never in YAML** |

> S3 credentials are stripped from any YAML file by the config loader. They
> must always be provided via environment variables.

### Typesense (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGE_REGISTRY_TYPESENSE_HOST` | _(none)_ | Typesense hostname. Search is disabled when absent. |
| `FORGE_REGISTRY_TYPESENSE_PORT` | `8108` | Typesense port |
| `FORGE_REGISTRY_TYPESENSE_PROTOCOL` | `http` | `http` or `https` |
| `FORGE_REGISTRY_TYPESENSE_API_KEY` | _(required if host set)_ | Typesense API key — **env only** |

---

## Provisioning

### Step 1 — Prepare Storage

**Option A: AWS S3**

```bash
# Create bucket
aws s3api create-bucket \
  --bucket acme-forge-registry \
  --region us-east-1

# Create a dedicated IAM user (do not use root credentials)
aws iam create-user --user-name forge-registry-svc

# Attach a least-privilege inline policy
aws iam put-user-policy \
  --user-name forge-registry-svc \
  --policy-name ForgeRegistryS3 \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:PutObject",
        "s3:ListBucket", "s3:HeadObject"
      ],
      "Resource": [
        "arn:aws:s3:::acme-forge-registry",
        "arn:aws:s3:::acme-forge-registry/*"
      ]
    }]
  }'

# Generate access keys (save these — you will need them for the .env file)
aws iam create-access-key --user-name forge-registry-svc
```

**Option B: MinIO (self-hosted)**

MinIO is not bundled in the enterprise compose (it is only in the dev compose).
If the customer runs their own MinIO:

```bash
# Create bucket and access key using the MinIO mc client
mc alias set customer http://minio.internal:9000 <root-user> <root-pass>
mc mb customer/forge-registry
mc admin user add customer forge-registry-svc <strong-password>
mc admin policy attach customer readwrite --user forge-registry-svc
mc admin user svcacct add customer forge-registry-svc
# Note the generated accessKey and secretKey
```

Set `FORGE_REGISTRY_S3_ENDPOINT=http://minio.internal:9000` and
`FORGE_REGISTRY_S3_FORCE_PATH_STYLE=true` in the .env file.

### Step 2 — Configure Auth

Choose one of the three auth strategies and copy the corresponding template:

```bash
# Navigate to the deploy/enterprise directory
cd packages/forge/packages/registry-service/deploy/enterprise

# Choose one:
cp configs/forge-registry-builtin.yaml        configs/active-config.yaml
# cp configs/forge-registry-trusted-headers.yaml  configs/active-config.yaml
# cp configs/forge-registry-webhook.yaml          configs/active-config.yaml
```

Edit `configs/active-config.yaml`:
- Set `storage.bucket` to your actual bucket name.
- Set `storage.region` to your region.
- For **builtin**: add admin entries under `auth.admins`.
- For **trusted-headers**: verify the header names match your proxy config.
- For **webhook**: set `auth.webhookUrl` to your policy service URL.

Then update the volume mount in `docker-compose.example.yaml`:
```yaml
volumes:
  - ./configs/active-config.yaml:/etc/forge-registry/config.yaml:ro
```

### Step 3 — Write the .env File

Create a `.env` file next to `docker-compose.example.yaml`. **Do not commit
this file to version control.**

```bash
# .env — Forge Registry enterprise secrets
# See docs/deploy-enterprise.md for the full variable reference.

# ── S3 ─────────────────────────────────────────────────────────────────────
FORGE_REGISTRY_S3_BUCKET=acme-forge-registry
FORGE_REGISTRY_S3_REGION=us-east-1
FORGE_REGISTRY_S3_ACCESS_KEY_ID=AKIAxxx
FORGE_REGISTRY_S3_SECRET_ACCESS_KEY=<secret>

# ── Typesense (generate a strong random key, min 16 chars) ──────────────────
FORGE_REGISTRY_TYPESENSE_API_KEY=$(openssl rand -hex 24)

# ── Webhook auth (only if using webhook strategy) ───────────────────────────
# FORGE_REGISTRY_WEBHOOK_SECRET=$(openssl rand -hex 32)
# JWT_SECRET=<your-jwt-signing-secret-or-public-key>
```

> **Tip:** Use `openssl rand -hex 32` to generate all secrets.

### Step 4 — Start the Stack

```bash
cd packages/forge/packages/registry-service/deploy/enterprise

docker compose -f docker-compose.example.yaml up -d

# Tail startup logs to confirm health and capture admin key (builtin auth)
docker compose -f docker-compose.example.yaml logs -f forge-registry
```

For **builtin auth**, look for a log line like:
```
[STARTUP] Admin API key for 'Arjun Khera' (arjun): <64-hex-chars>  — save this, it will not be shown again
```

**Copy and store this key immediately.** It is logged once and never shown
again. If lost, follow the Key Rotation procedure below.

---

## Smoke Testing

Run these checks after every new deployment or configuration change.

```bash
# Set the base URL for your instance
REGISTRY_URL=https://registry.example.com

# 1. Health check (must return HTTP 200 and status: ok)
curl -s "$REGISTRY_URL/health" | jq .
# Expected: { "status": "ok", "version": "...", "storage": "ok" }

# 2. List artifact types (public, no auth)
curl -s "$REGISTRY_URL/types" | jq .
# Expected: array of registered artifact type objects

# 3. Authenticated publish (requires admin key — builtin auth example)
ADMIN_KEY=<your-64-hex-admin-key>

curl -s -X POST "$REGISTRY_URL/artifacts/skill/test-smoke/0.0.1" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "files": {
      "skill.md": "'$(echo -n '# smoke test' | base64)'"
    }
  }' | jq .
# Expected: HTTP 201 with publishedAt, files[], manifest fields

# 4. Resolve the artifact back (public read, no auth)
curl -s "$REGISTRY_URL/artifacts/skill/test-smoke/0.0.1" | jq .
# Expected: HTTP 200 with artifact metadata

# 5. Search (if Typesense is enabled)
curl -s "$REGISTRY_URL/search?q=smoke" | jq .
# Expected: HTTP 200 with results array
```

---

## Key Rotation (Builtin Auth)

Key rotation replaces an admin's API key with a new one. The old key stops
working immediately.

**Procedure:**

1. Shell into the running registry container:
   ```bash
   docker exec -it forge-registry sh
   ```

2. Open the SQLite database with the sql.js binary (or copy it out and use
   the standard `sqlite3` CLI tool):
   ```bash
   # On the host — copy the DB out for manipulation
   docker cp forge-registry:/data/registry/forge-registry.db /tmp/forge-registry.db
   sqlite3 /tmp/forge-registry.db
   ```

3. Delete the old key hash for the target admin:
   ```sql
   -- Replace 'arjun' with the admin's id from config
   DELETE FROM auth_keys WHERE user_id = 'arjun';
   .quit
   ```

4. Copy the modified DB back into the volume:
   ```bash
   # Stop the registry first to avoid write conflicts
   docker compose -f docker-compose.example.yaml stop forge-registry

   docker cp /tmp/forge-registry.db forge-registry:/data/registry/forge-registry.db

   # Restart — a new key will be generated and logged at startup
   docker compose -f docker-compose.example.yaml start forge-registry
   docker compose -f docker-compose.example.yaml logs -f forge-registry
   # Look for: [STARTUP] Admin API key for '...' (arjun): <new-64-hex-key>
   ```

5. Distribute the new key to the admin and revoke the old one from any
   clients (CI pipelines, Forge config files, etc.).

> **Note on concurrent admins:** If multiple admins need key rotation, delete
> all their rows in the same sqlite session, then restart once. Each admin
> gets a fresh key on startup.

---

## Backup and Restore

### SQLite Database (audit log + auth keys)

The SQLite database at `FORGE_REGISTRY_DB_PATH` contains:
- `auth_keys` table: bcrypt-hashed API keys for builtin auth
- `audit_log` table: append-only record of all publish and read events

**Backup (run from the host):**

```bash
# Method 1: copy via docker cp (safe while the container is running)
BACKUP_DIR="/backups/forge-registry/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
docker cp forge-registry:/data/registry/forge-registry.db "$BACKUP_DIR/forge-registry.db"
echo "Backup written to $BACKUP_DIR/forge-registry.db"

# Method 2: use the Docker volume directly (container can be running)
docker run --rm \
  -v forge-registry_registry-data:/data \
  -v /backups/forge-registry:/backup \
  alpine \
  cp /data/forge-registry.db /backup/forge-registry-$(date +%Y%m%d-%H%M%S).db
```

**Recommended cadence:** Daily snapshots, retain 30 days.

**Restore:**

```bash
# 1. Stop the registry
docker compose -f docker-compose.example.yaml stop forge-registry

# 2. Copy the backup into the volume
docker cp /backups/forge-registry/forge-registry.db \
  forge-registry:/data/registry/forge-registry.db

# 3. Start the registry
docker compose -f docker-compose.example.yaml start forge-registry

# 4. Verify
curl -s https://registry.example.com/health | jq .
```

**Audit log export (for compliance / SIEM):**

The audit log is a standard SQLite table. To export to JSON:

```bash
sqlite3 /tmp/forge-registry.db \
  "SELECT json_object(
    'id', id, 'actor', actor, 'action', action,
    'targetType', target_type, 'targetId', target_id,
    'targetVersion', target_ver, 'timestamp', timestamp, 'meta', meta
  ) FROM audit_log ORDER BY id;" \
  > /tmp/audit-export.jsonl
```

### S3 Object Store

Artifacts (blobs + manifests) are stored in S3. Back these up using your
cloud provider's native mechanism.

**AWS S3 — enable versioning (recommended):**
```bash
aws s3api put-bucket-versioning \
  --bucket acme-forge-registry \
  --versioning-configuration Status=Enabled
```

**AWS S3 — cross-region replication (for DR):**
```bash
# Create a replication rule to copy objects to a secondary bucket.
# See AWS docs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html
```

**MinIO — mc mirror:**
```bash
mc mirror \
  customer/forge-registry \
  backup-target/forge-registry-backup \
  --overwrite --watch
```

---

## Auth Strategy Guide

### builtin

The registry generates a random 64-hex-char API key per admin at first startup.
Keys are bcrypt-hashed (12 rounds) before being stored in SQLite. The plaintext
is emitted to stdout **once** at startup and never stored.

- Reads: anonymous (no auth required)
- Writes: `Authorization: Bearer <key>` required

Config template: `configs/forge-registry-builtin.yaml`

Use this strategy for:
- Simple deployments with a small number of trusted publishers
- CI/CD pipelines using a single bot key
- Getting started quickly

### trusted-headers

The edge proxy authenticates callers (JWT, OAuth, mTLS) and injects identity
headers before forwarding to the registry. The registry trusts these headers
unconditionally.

**Security invariant:** The proxy MUST strip `X-User-Id`, `X-User-Name`, and
`X-User-Role` from all client requests before injecting verified values. If
clients can set these headers, they can impersonate any user.

- Reads: public
- Writes: `X-User-Role: admin` required (injected by the proxy)

Config template: `configs/forge-registry-trusted-headers.yaml`

Use this strategy for:
- Deployments behind an identity-aware proxy (Nginx + lua-resty-jwt, Envoy
  with ext_authz, AWS API Gateway + Cognito)
- SSO environments where every request already carries a verified JWT

### webhook (OPA/Rego example)

For each request requiring auth, the registry POSTs the request context to an
external HTTP policy service and awaits `{ "allow": true|false }`. Any non-200
response or network error is treated as **deny** (fail-closed).

The example in `examples/opa-webhook/` provides:
- `policy.rego` — sample OPA Rego policy with JWT verification
- `server.js` — lightweight Node.js HTTP server wrapping OPA's REST API
- `docker-compose.snippet.yaml` — drop-in services to add alongside the main compose

Config template: `configs/forge-registry-webhook.yaml`

**To deploy the OPA example alongside forge-registry:**

1. Merge `examples/opa-webhook/docker-compose.snippet.yaml` into your main
   compose file (copy the `opa-webhook` and `opa` service definitions).
2. Switch the config mount to `forge-registry-webhook.yaml`.
3. Set `auth.webhookUrl: http://opa-webhook:3100/v1/authz/decide` in the
   webhook config.
4. Add `FORGE_REGISTRY_WEBHOOK_SECRET` and `JWT_SECRET` to your `.env` file.
5. Edit `policy.rego` to match your JWT issuer and role structure.

Use this strategy for:
- Organizations with existing OPA / Cedar policy infrastructure
- Fine-grained per-artifact-type or per-user permissions
- Audit requirements that demand externalised policy decisions

---

## No Federation

Enterprise instances are intentionally isolated. There is:

- No sync from this instance to the public Horus global registry
- No auto-discovery of other instances
- No replication between customer instances

If you need an artifact published to both an enterprise instance and the public
registry, publish to each separately using `forge publish --registry <url>`.

---

## Troubleshooting

**Container exits immediately on startup**

Check the logs for config validation errors:
```bash
docker compose -f docker-compose.example.yaml logs forge-registry
```
Common causes:
- Missing `FORGE_REGISTRY_S3_ACCESS_KEY_ID` or `FORGE_REGISTRY_S3_SECRET_ACCESS_KEY`
- Invalid YAML in the config file mounted at `FORGE_REGISTRY_CONFIG`
- `dbPath` directory does not exist or is not writable

**`/health` returns `{ "status": "degraded", "storage": "error" }`**

The registry cannot reach S3. Verify:
- Bucket name and region are correct
- Credentials have `s3:ListBucket` and `s3:HeadObject` permissions
- If using a custom endpoint (MinIO), verify `FORGE_REGISTRY_S3_ENDPOINT` and
  `FORGE_REGISTRY_S3_FORCE_PATH_STYLE=true`

**Publish returns HTTP 401**

- For builtin auth: verify the `Authorization: Bearer <key>` header is present
  and the key was not rotated.
- For trusted-headers: verify the proxy is injecting `X-User-Role: admin`.
- For webhook: check the opa-webhook logs for the OPA decision.

**Typesense search returns no results after publishing**

The Typesense index is populated asynchronously on publish. If you published
an artifact and do not see it in search results:
1. Verify `FORGE_REGISTRY_TYPESENSE_HOST` is set and Typesense is healthy.
2. Check forge-registry logs for Typesense indexing errors.
3. The v1 index is not auto-rebuilt on restart — a full re-index requires
   republishing artifacts (or wait for the v2 re-index feature).

**Lost builtin admin key**

Follow the [Key Rotation](#key-rotation-builtin-auth) procedure to delete the
old hash row and generate a new key on next startup.
