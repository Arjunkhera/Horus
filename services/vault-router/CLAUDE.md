# Vault Router — Multi-Vault Routing Proxy

**This is a service inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-vault-router.md" })
```

## What This Service Does

FastAPI proxy sitting between Vault MCP and the Vault service(s). Fan-outs reads across all configured vaults and merges results. Routes writes to the specific vault that owns a page by UUID lookup.

## Build & Test

```bash
pip install -r requirements.txt
uvicorn src.main:app --reload
```

No tests currently — minimal proxying logic.

## Dependencies

- Vault service(s) (runtime, HTTP)
- No build-time dependency on other Horus packages

## Rules

- **Never run `docker compose build vault-router`** — push to master and let CI build the GHCR image
- Changes here trigger CI build of `ghcr.io/arjunkhera/horus/vault-router`
- Healthcheck is Python-based — do NOT replace with curl (slim image has no curl)
- UUID registry refreshes periodically — can be briefly stale after new page writes
