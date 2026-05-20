# @horus/anvil-router

The Anvil Router is a TypeScript Fastify service that routes Anvil MCP and REST traffic to the correct per-user Anvil instance in the Horus platform. It sits between the Claude Code client and each user's dedicated Anvil container, applying per-tenant auth and registry-driven routing rules.

This service applies per-tenant JWT auth (TA-4) and will route Anvil traffic to per-user instances (TA-5..TA-7).

## Related

- Story: [TA-1](https://anvil/notes/7e9411d3-36ff-4b92-884d-6c8a012c7c15)
- Design Proposal: [Track A Design](https://anvil/notes/b711ce02-10e8-498d-a65e-b2153e89db18)

## Development

```bash
# Install dependencies (from repo root)
pnpm install

# Run in dev mode
pnpm --filter @horus/anvil-router dev

# Build
pnpm --filter @horus/anvil-router build

# Test
pnpm --filter @horus/anvil-router test
```

## Configuration (env vars)

| Var | Required | Description |
|-----|----------|-------------|
| `ANVIL_ROUTER_PORT` | No | Listening port (default: `8200`) |
| `ANVIL_ROUTER_TENANT` | **Yes** | Expected tenant string. Every JWT's `tenant` claim must match this value. |
| `ANVIL_ROUTER_JWKS_JSON` | **Yes** | JSON string of a JWK set `{ "keys": [...] }` used to verify inbound JWTs. |

### Auth behavior (TA-4)

Every request except `GET /health` is verified with `hardenedVerifier(createJwtVerifier(...), expectedTenant)` (double-check on tenant claim per design decision top-fork 4).

- Missing/invalid/expired token → `401 { error: { code: "UNAUTHORIZED", message } }`
- Token with wrong tenant claim → `403 { error: { code: "TENANT_MISMATCH", message } }`
- Valid token → `request.principal` populated; original `Authorization` header stored as `request.forwardedAuth` for downstream proxy use (TA-5/6/7).

## Endpoints

```
GET /health → 200 { status: "ok", service: "anvil-router", version: "0.1.0" }
             (no auth required)
```
