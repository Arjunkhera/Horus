# Vault Service — Knowledge REST API

**This is a service inside the Horus monorepo. It is NOT a separate repository.**

## Vault Context

Load before working here:
```
knowledge_get_page({ id: "shared/guides/horus-vault-service.md" })
```

For the full Vault chain and architecture:
```
knowledge_get_page({ id: "shared/guides/horus-vault-router.md" })
knowledge_get_page({ id: "shared/guides/horus-vault-mcp.md" })
knowledge_get_page({ id: "shared/concepts/horus-package-architecture.md" })
```

## What This Service Does

FastAPI knowledge service with 23 REST endpoints. Manages knowledge pages (guides, procedures, repo profiles, learnings) with schema-validated write-path, Neo4j knowledge graph, and Typesense search. Two-layer architecture: `src/layer1/` (storage I/O) and `src/layer2/` (business logic).

## Build & Test

```bash
pip install -r requirements.txt
uvicorn src.main:app --reload    # Dev server
pytest                            # All tests
pytest tests/integration/ -v     # Integration (needs Typesense)
```

## Dependencies

- Typesense (runtime, port 8108)
- Neo4j (runtime, bolt port 7687)
- No build-time dependency on TypeScript packages

## Rules

- **Never run `docker compose build vault`** — push to master and let CI build the GHCR image
- Changes here trigger CI build of `ghcr.io/arjunkhera/horus/vault`
- Claude never talks to this service directly — the chain is: Claude → Vault MCP → Vault Router → here
- The Typesense collection schema must stay in sync with `packages/search/src/bootstrap.ts`
- Healthcheck is Python-based — do NOT replace with curl (slim image has no curl)
