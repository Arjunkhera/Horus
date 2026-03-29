# Doc-Gen Pilot Runbook

> Work item: eebf3d7a — End-to-end pilot on Horus repos

## Overview

This runbook guides the end-to-end validation of the doc-gen pipeline against Horus repos. The pilot covers: repo profiling → edge detection → CLAUDE.md generation → graph traversal → retrieval sub-agent.

---

## Step 0: Merge Feature Branches

All feature work is on separate branches. Merge them in dependency order before starting.

### Horus (in this order)

```bash
cd /Users/arkhera/Desktop/Repositories/Horus

# Wave 1: Neo4j Docker Compose + connection layer
git merge feature/fb8cad73

# Wave 2: Schema evolution + scope resolver + models
git merge feature/968f4051

# Wave 3: Edge CRUD API + MCP tools + tests
git merge feature/cdb75ac1

# Wave 4: Graph export/import
git merge feature/01a90620
```

### Forge-Registry (order doesn't matter, all independent)

```bash
cd /Users/arkhera/Desktop/Repositories/Forge-Registry

git merge feature/c7c95add    # doc-gen plugin + skill stubs
git merge feature/9b53c99f    # repo-profile scanner skill
git merge feature/5456c682    # retrieval sub-agent skill
git merge feature/b08bfdb0    # edge proposal scanner skill
git merge feature/611b46eb    # guide & procedure scanner skill
git merge feature/3743b19c    # CLAUDE.md generator skill
git merge feature/2e4ecfd3    # human verification flow skill
```

---

## Step 1: Start Services

```bash
cd /Users/arkhera/Desktop/Repositories/Horus

# Start Neo4j + Vault API (and other services)
docker-compose up -d

# Verify Neo4j is healthy (takes ~60s on first start)
docker-compose ps neo4j
# Expected: health: healthy

# Check Vault API is up
curl -s http://localhost:8000/health | python3 -m json.tool
```

**Expected Vault health response:**
```json
{
  "status": "ok",
  "neo4j": "connected"
}
```

If `neo4j` shows `"unavailable"`, wait 30s and retry — Neo4j takes time to initialize.

---

## Step 2: Verify Graph API

```bash
# Create a test edge (should return 200)
curl -s -X POST http://localhost:8000/graph/edges \
  -H "Content-Type: application/json" \
  -d '{"from_path": "test/a.md", "to_path": "test/b.md", "edge_type": "RELATED"}' \
  | python3 -m json.tool

# Delete the test edge
curl -s -X POST http://localhost:8000/graph/edges/delete \
  -H "Content-Type: application/json" \
  -d '{"from_path": "test/a.md", "to_path": "test/b.md", "edge_type": "RELATED"}' \
  | python3 -m json.tool
```

---

## Step 3: Run Pilot — Repo 1 (Forge-Registry)

Start with Forge-Registry — smallest and best-known repo.

In a new Claude Code session (with the doc-gen plugin available):

```
Use the doc-gen-repo-profile-scanner skill to scan: forge-registry
```

**Expected outcome:**
- Vault PR created for `repos/forge-registry.md`
- Confidence score 4–5 (good README + package manifests)
- DOCS edge created in Neo4j

**Validate:**
```bash
# Check for the DOCS edge
curl -s -X POST http://localhost:8000/graph/edges/get \
  -H "Content-Type: application/json" \
  -d '{"from_path": "repos/forge-registry.md"}' \
  | python3 -m json.tool
```

---

## Step 4: Run Pilot — Repo 2 (Knowledge-Base)

```
Use the doc-gen-repo-profile-scanner skill to scan: knowledge-base
```

Then run the guide & procedure scanner:

```
Use the doc-gen-guide-procedure-scanner skill to scan: knowledge-base
```

---

## Step 5: Run Pilot — Repo 3 (Horus monorepo)

```
Use the doc-gen-repo-profile-scanner skill to scan: horus
```

Horus is a monorepo — the skill should detect this and add the `monorepo` tag. Check that confidence ≥ 3.

Then run the edge proposal scanner:

```
Use the doc-gen-edge-proposal-scanner skill to scan: horus
```

Expected edges:
- `PART_OF`: sub-packages within the monorepo
- `DEPENDS_ON`: cross-package dependencies
- `DOCS`: link from generated Vault pages to repos

---

## Step 6: Generate CLAUDE.md Files

For each repo after profiling is complete:

```
Use the doc-gen-claudemd-generator skill for repo: horus
Use the doc-gen-claudemd-generator skill for repo: forge-registry
Use the doc-gen-claudemd-generator skill for repo: knowledge-base
```

Review the generated Always Load lists before committing.

---

## Step 7: Validate Retrieval Sub-Agent

Test the sub-agent with a context hint:

```
Use the doc-gen-retrieval-subagent skill:
  repo: horus
  context_hint: implementing graph edge storage
```

**Expected:** manifest with 3+ pages, coverage confidence `medium` or `high`.

---

## Step 8: Test Graph Export

```bash
curl -s -X POST http://localhost:8000/graph/export | python3 -m json.tool
```

Check that `_graph/edges.json` was updated in the Knowledge-Base repo:

```bash
ls -la /Users/arkhera/Desktop/Repositories/Knowledge-Base/_graph/
cat /Users/arkhera/Desktop/Repositories/Knowledge-Base/_graph/edges.json | python3 -m json.tool | head -40
```

---

## Step 9: Quality Review Checklist

For each generated Vault page:
- [ ] Title is descriptive and specific (not "Horus — a repo")
- [ ] Description is agent-consumable (dense, no filler)
- [ ] Tags are meaningful and correct
- [ ] Confidence score is appropriate (not all 5s on sparse repos)
- [ ] `auto-generated: true` is set
- [ ] No hallucinated content (all claims traceable to files read)

For the CLAUDE.md files:
- [ ] Identity section is present with correct Vault pointer
- [ ] Always Load list contains the repo-profile + at least 1 guide/procedure (if generated)
- [ ] Doesn't exceed 5 entries

For the graph:
- [ ] Neo4j has edges between real repos (not test nodes)
- [ ] Edge types are correct (not every relationship is RELATED)
- [ ] Confidence scores vary (would indicate real analysis, not defaults)

---

## Step 10: Bug Log

Document all issues found in this Anvil work item as a journal entry (type: journal, tag: #pilot-bugs).

Format:
```
## Bug: {title}
- Severity: high / medium / low
- Symptom: {what happened}
- Expected: {what should have happened}
- Reproduction: {how to reproduce}
```

---

## Known Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Neo4j slow to start, Vault times out | Medium | Set `start_period: 90s` in docker-compose healthcheck |
| LLM-generated edge proposals are low quality | High | Pilot will quantify — adjust detection heuristics in follow-up |
| Vault write-path pipeline fails on new tags | Medium | Human verification flow handles blocking cases |
| Monorepo scan misses sub-packages | Medium | Manual check — repo-profile scanner Note section should flag it |
