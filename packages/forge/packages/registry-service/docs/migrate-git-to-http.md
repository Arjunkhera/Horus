# Forge Registry — Git → HTTP Migration Runbook

This document is the authoritative cutover procedure for migrating all Forge
artifacts from the legacy git-backed registry
(`github.com/Arjunkhera/Forge-Registry`) to the new HTTP registry service.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [T-1 day — Announce freeze](#t-1-day--announce-freeze)
3. [T-0 — Cutover sequence](#t-0--cutover-sequence)
   - [Step 1 — Revoke write access on the git repo](#step-1--revoke-write-access-on-the-git-repo)
   - [Step 2 — Run migration against staging](#step-2--run-migration-against-staging)
   - [Step 3 — Spot-check staging resolves](#step-3--spot-check-staging-resolves)
   - [Step 4 — Run migration against production](#step-4--run-migration-against-production)
   - [Step 5 — Spot-check production resolves](#step-5--spot-check-production-resolves)
   - [Step 6 — Flip default registry in forge.yaml](#step-6--flip-default-registry-in-forgeyaml)
   - [Step 7 — Archive the git repo](#step-7--archive-the-git-repo)
   - [Step 8 — Place MIGRATED.md in the git repo root](#step-8--place-migratedmd-in-the-git-repo-root)
4. [Rollback plan](#rollback-plan)
5. [Verification checklist](#verification-checklist)

---

## Prerequisites

Before starting the cutover, confirm each item is in place.

| Item | Check |
|------|-------|
| HTTP registry service is deployed and health-checked (`GET /health` returns 200) | [ ] |
| At least one admin API key has been generated and stored securely | [ ] |
| `tsx` is available in the shell (`npx tsx --version` works) | [ ] |
| You have GitHub admin rights on `Arjunkhera/Forge-Registry` | [ ] |
| Staging registry is configured, accessible, and empty (or idempotent-safe) | [ ] |
| Production registry URL and admin bearer token are stored in a secrets manager | [ ] |
| Network connectivity from migration host to staging and production registries | [ ] |
| At least 2 GB of free disk space on migration host (for shallow git clone) | [ ] |
| Rollback plan reviewed and agreed with team | [ ] |

---

## T-1 day — Announce freeze

1. Post in the team Slack channel (or equivalent) that the git registry will be
   frozen at `T-0` (insert specific date/time).
2. Advise that no new `git push` to `Arjunkhera/Forge-Registry` should occur
   after the announced cutover time.
3. Confirm acknowledgement from all teams who currently publish artifacts.

---

## T-0 — Cutover sequence

Work through steps in order. Do **not** skip a step even if you believe it is
already complete.

### Step 1 — Revoke write access on the git repo

On GitHub (`https://github.com/Arjunkhera/Forge-Registry`):

1. Navigate to **Settings → Collaborators and teams**.
2. For every team or individual with **Write** or **Maintain** access, change
   their permission to **Read**.
3. Navigate to **Settings → Branches**.
4. On the default branch (typically `main`), add a branch protection rule:
   - Enable **Restrict who can push to matching branches**.
   - Remove all users from the push allowlist.
   - This prevents any accidental push even from repository owners via the CLI
     (owners can bypass — see note below).
5. Record the time of the permission change in the incident timeline.

> **Note:** Repository owners cannot be fully blocked by branch protection.
> After the migration is complete (Step 8) the repository will be archived,
> which prevents all pushes including from owners.

Verification:

```bash
# Should fail with 403 or similar for any non-owner account
git clone https://github.com/Arjunkhera/Forge-Registry /tmp/verify-freeze
cd /tmp/verify-freeze
git commit --allow-empty -m "freeze test"
git push   # Expected: rejected
```

---

### Step 2 — Run migration against staging

```bash
export STAGING_URL="https://staging-registry.example.com"
export STAGING_TOKEN="<staging-admin-bearer-token>"   # from secrets manager

cd packages/forge/packages/registry-service

# Dry-run first — verify the artifact list looks correct
npx tsx scripts/migrate-from-git.ts \
  --source  https://github.com/Arjunkhera/Forge-Registry \
  --target  "$STAGING_URL" \
  --token   "$STAGING_TOKEN" \
  --dry-run

# If the dry-run output looks correct, run for real
npx tsx scripts/migrate-from-git.ts \
  --source  https://github.com/Arjunkhera/Forge-Registry \
  --target  "$STAGING_URL" \
  --token   "$STAGING_TOKEN"
```

Expected terminal output ends with:

```
Migration summary
─────────────────────────────────────────────
  Total discovered : N
  Migrated         : N
  Skipped (exists) : 0
  Failed           : 0
─────────────────────────────────────────────
```

**If any artifact fails:** stop here, diagnose, fix, and re-run (the script is
idempotent — 409 responses are treated as success).

---

### Step 3 — Spot-check staging resolves

The migration script already performs an automated spot-check of 5 random
artifacts at the end of the run (HEAD + SHA-256 comparison).

In addition, perform a manual resolve of at least 3 well-known artifacts:

```bash
# Replace TYPE / ID / VERSION with known artifact coordinates
curl -s "$STAGING_URL/artifacts/skill/my-skill-id/1.0.0" | jq .

# Decode the metadata.yaml from the response and inspect it
curl -s "$STAGING_URL/artifacts/skill/my-skill-id/1.0.0" \
  | jq -r '.files["metadata.yaml"]' \
  | base64 -d
```

Record the artifact coordinates and SHA-256 values observed. These will be
cross-checked against production in Step 5.

---

### Step 4 — Run migration against production

```bash
export PROD_URL="https://registry.example.com"
export PROD_TOKEN="<production-admin-bearer-token>"   # from secrets manager

cd packages/forge/packages/registry-service

# Dry-run first
npx tsx scripts/migrate-from-git.ts \
  --source  https://github.com/Arjunkhera/Forge-Registry \
  --target  "$PROD_URL" \
  --token   "$PROD_TOKEN" \
  --dry-run

# If dry-run is correct, migrate for real
npx tsx scripts/migrate-from-git.ts \
  --source  https://github.com/Arjunkhera/Forge-Registry \
  --target  "$PROD_URL" \
  --token   "$PROD_TOKEN"
```

Save the full terminal output (including the summary and spot-check lines) to a
migration log file for audit purposes:

```bash
npx tsx scripts/migrate-from-git.ts \
  --source  https://github.com/Arjunkhera/Forge-Registry \
  --target  "$PROD_URL" \
  --token   "$PROD_TOKEN" \
  2>&1 | tee migration-$(date +%Y%m%dT%H%M%S).log
```

---

### Step 5 — Spot-check production resolves

Repeat the manual spot-check from Step 3, but against `$PROD_URL`.

For each artifact checked in staging, verify:
- HTTP 200 on GET
- `metadata.yaml` SHA-256 matches the staging value

```bash
# Example for a single artifact
curl -s "$PROD_URL/artifacts/skill/my-skill-id/1.0.0" \
  | jq -r '.files["metadata.yaml"]' \
  | base64 -d \
  | sha256sum
# Compare against the sha256 recorded in Step 3
```

**Gate:** do not proceed to Step 6 until all spot-checks pass.

---

### Step 6 — Flip default registry in forge.yaml

Update the default registry endpoint in the project/workspace configuration
file (`forge.yaml`) to point at the production HTTP service:

```yaml
# Before
registry:
  url: https://github.com/Arjunkhera/Forge-Registry

# After
registry:
  url: https://registry.example.com
```

If `forge.yaml` is checked into multiple repositories or distributed via a
default workspace config artifact, update and republish as appropriate.

Announce the change in the team communication channel.

---

### Step 7 — Archive the git repo

On GitHub:

1. Navigate to `https://github.com/Arjunkhera/Forge-Registry` **Settings**.
2. Scroll to the **Danger Zone** section.
3. Click **Archive this repository**.
4. Confirm the archival.

Archiving makes the repository read-only permanently — no pushes, no issue
creation, no PR creation. Existing content and git history remain accessible
forever.

---

### Step 8 — Place MIGRATED.md in the git repo root

Before archiving (or immediately after if the window was missed — see note),
commit a `MIGRATED.md` file to the default branch of the old git repository
using the template below.

> **Note:** Once the repo is archived you cannot push. Commit `MIGRATED.md`
> *before* running Step 7, or temporarily un-archive, commit, then re-archive.

```markdown
# This registry has been migrated

This git repository (`Arjunkhera/Forge-Registry`) is **archived and read-only**.
All Forge artifacts have been migrated to the new HTTP registry service.

## New registry

| Property | Value |
|----------|-------|
| URL | https://registry.example.com |
| Migration date | YYYY-MM-DD |
| Migrated by | <your name / GitHub handle> |

## Using the new registry

Update your `forge.yaml`:

```yaml
registry:
  url: https://registry.example.com
```

## Historical content

All artifact versions that existed in this git registry have been copied to the
new service. Artifact coordinates (`type:id@version`) are unchanged.

For questions contact the platform team at platform@example.com.
```

---

## Rollback plan

If production migration fails or critical resolves fail in Step 5:

1. **Do not flip `forge.yaml`** (Step 6) — the old git registry still works.
2. Restore write access on the git repo (revert Step 1 permissions).
3. Announce to the team that the cutover has been postponed.
4. Diagnose the failure using the migration log from Step 4.
5. Fix the issue (script bug, service config, network policy, etc.).
6. Schedule a new cutover window and repeat from T-1.

The migration script is idempotent: artifacts already successfully posted will
return 409 on re-run and be counted as skipped. There is no need to clean up
partially migrated artifacts before retrying.

---

## Verification checklist

Complete this checklist before declaring the migration done.

- [ ] Git repo is archived (read-only) on GitHub
- [ ] `MIGRATED.md` is committed to the default branch of the old repo
- [ ] `forge.yaml` default `registry.url` points at the new HTTP service
- [ ] Migration log saved and linked from the migration issue/ticket
- [ ] Artifact count in migration log: `Total discovered == Migrated + Skipped`
- [ ] Zero `Failed` entries in the migration log
- [ ] Spot-check: ≥ 3 manual resolves passed on production
- [ ] Spot-check: SHA-256 values match between staging and production for the same artifacts
- [ ] Team announced via Slack (or equivalent) that migration is complete
- [ ] Old registry URL removed from all CI/CD pipeline configs and documentation
