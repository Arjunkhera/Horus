# Git → HTTP Registry Migration — Execution Record

**Migration date:** 2026-05-16
**Story:** [1g.1] — `65f3a842-5e58-47fb-961e-d44f59eaf727`
**Executed by:** automated migration script (`scripts/migrate-from-git.ts`)
**Source:** `git@github.com:Arjunkhera/Forge-Registry.git`
**Target:** `http://34.234.40.171:8744` (EC2 direct; CloudFront read URL: `https://d1agcpjabvrj1s.cloudfront.net`)

---

## Results

| Metric | Value |
|--------|-------|
| Total discovered in git registry | 135 |
| Migrated (201 OK) | 135 |
| Skipped (409 already present) | 0 |
| Failed | 0 |

### By artifact type

| Type | Count |
|------|-------|
| skill | 71 |
| agent | 40 |
| plugin | 4 |
| persona | 9 |
| workspace-config | 8 |
| smoke-test (pre-existing) | 2 |
| **Total** | **135** |

---

## Issues resolved during migration

### 9 sdlc agents: missing `rootSkill` field

The initial run migrated 126/135 artifacts. The following 9 sdlc agents failed
schema validation (`SCHEMA_VALIDATION_FAILED: Invalid agent metadata: rootSkill: Required`):

- `sdlc-design-proposal@1.0.0` → `rootSkill: sdlc-designer`
- `sdlc-doc-sync@1.0.0` → `rootSkill: sdlc-docs`
- `sdlc-gather-context@1.0.0` → `rootSkill: sdlc-discovery`
- `sdlc-implement-story@1.0.0` → `rootSkill: sdlc-developer`
- `sdlc-plan-feature@1.0.0` → `rootSkill: sdlc-planner`
- `sdlc-release@1.0.0` → `rootSkill: sdlc-orchestrator`
- `sdlc-route-evaluator@1.0.0` → `rootSkill: sdlc-orchestrator`
- `sdlc-test-suite@1.0.0` → `rootSkill: sdlc-tester`
- `sdlc-testenv@1.0.0` → `rootSkill: sdlc-tester`

These agents were created before the `AgentMetaSchema` made `rootSkill` a
required field. The `rootSkill` field was added to each metadata.yaml in the
git registry and committed (commit `1aa299d`), then the 9 artifacts were
re-published successfully.

---

## Verification

All 135 artifacts verified present via `HEAD /artifacts/{type}/{id}/{version}` checks.

Spot-checked content decoded from base64 response:
- `skill:horus-forge@2.1.0` — files: `SKILL.md`, `manifest.yaml`, `metadata.yaml` ✓
- `agent:sdlc-implement-story@1.0.0` — includes `rootSkill: sdlc-developer` ✓
- `plugin:horus-core@2.0.0` — files: `PLUGIN.md`, `manifest.yaml`, `metadata.yaml` ✓

SHA-256 spot-checks passed for 5 random artifacts (script built-in verification):
all 5 `metadata.yaml` SHA-256 hashes matched between source and HTTP registry.

---

## Script invocation

```bash
node --experimental-strip-types \
  packages/forge/packages/registry-service/scripts/migrate-from-git.ts \
  --source git@github.com:Arjunkhera/Forge-Registry.git \
  --target http://34.234.40.171:8744 \
  --token <admin-api-key>
```

The script is idempotent — re-running will skip already-present artifacts (HTTP 409).
