# @horus/anvil-router

The Anvil Router is a TypeScript Fastify service that routes Anvil MCP and REST traffic to the correct per-user Anvil instance in the Horus platform. It sits between the Claude Code client and each user's dedicated Anvil container, applying per-tenant auth and registry-driven routing rules.

This service applies per-tenant JWT auth (TA-4), routes Anvil traffic to per-user instances (TA-5..TA-7), and exposes structured logging, request-ID propagation, and Prometheus metrics (TA-10).

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
| `ANVIL_REGISTRY_PATH` | **Yes** (alpha mode) | Path to the SQLite registry DB file used to resolve Principal → Anvil URL. |
| `LOG_LEVEL` | No | Pino log level (default: `info`). Set to `silent` to suppress output in tests. |

### Auth behavior (TA-4)

Every request except `GET /health` and `GET /metrics` is verified with `hardenedVerifier(createJwtVerifier(...), expectedTenant)` (double-check on tenant claim per design decision top-fork 4).

- Missing/invalid/expired token → `401 { error: { code: "UNAUTHORIZED", message, request_id } }`
- Token with wrong tenant claim → `403 { error: { code: "TENANT_MISMATCH", message, request_id } }`
- Valid token → `request.principal` populated; original `Authorization` header stored as `request.forwardedAuth` for downstream proxy use (TA-5/6/7).

## Endpoints

```
GET /health  → 200 { status: "ok", service: "anvil-router", version: "0.1.0" }
              (no auth required)

GET /metrics → 200 text/plain  Prometheus text exposition format
              (no auth required — scrape without a bearer token)
```

## Observability (TA-10)

### Request IDs

Every request receives a `X-Request-Id` header in the response:

- If the inbound request includes `X-Request-Id`, that value is **preserved** and echoed back.
- Otherwise a UUIDv4 is generated and used for the lifetime of the request.

The same request ID is:
1. Included in the structured log line (field: `request_id`)
2. Included in all error response bodies (field: `error.request_id`)
3. Set on the outgoing `X-Request-Id` response header

The request ID is **not** currently forwarded to upstream Anvil instances (forward is a post-alpha enhancement).

### Structured log format

Every request emits a JSON log line at completion time (via pino):

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "path": "/api/notes/abc",
  "status": 200,
  "duration_ms": 42,
  "principal": {
    "tenant": "acme",
    "user": "alice",
    "role": "admin"
  }
}
```

Fields `principal.*` are omitted on unauthenticated routes (`/health`, `/metrics`).

### Prometheus metrics

`GET /metrics` returns Prometheus text exposition format. Minimum set:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `anvil_router_requests_total` | Counter | `method`, `status` | Total inbound requests |
| `anvil_router_request_duration_ms` | Histogram | `method`, `status` | End-to-end request latency (ms) |
| `anvil_router_upstream_latency_ms` | Histogram | `method`, `upstream_status` | Upstream Anvil proxy latency (ms) |
| `anvil_router_cache_hits_total` | Counter | — | Registry TTL-cache hits |
| `anvil_router_cache_misses_total` | Counter | — | Registry TTL-cache misses (SQLite queried) |
| `anvil_router_upstream_errors_total` | Counter | `code` | Upstream connection-level errors |

Histogram buckets (ms): `5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000`.

## Error response shape

All error responses (4xx, 5xx) return a JSON body with the following shape:

```json
{
  "error": {
    "code": "UPPERCASE_SNAKE_CASE",
    "message": "Human-readable description",
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "retryAfter": 30
  }
}
```

`retryAfter` (seconds) is only present on `425` and `503` responses; a `Retry-After` header is also set.

### HTTP status code catalog

| Status | `code` | Meaning |
|--------|--------|---------|
| `400` | `VALIDATION_ERROR` | Missing or invalid query parameters |
| `401` | `UNAUTHORIZED` | Missing, expired, or invalid JWT |
| `403` | `TENANT_MISMATCH` | Token tenant claim does not match `ANVIL_ROUTER_TENANT` |
| `425` | `REGISTRY_MISS` | Principal exists but Anvil instance not yet provisioned; retry after `Retry-After` seconds |
| `502` | `UPSTREAM_UNAVAILABLE` | Upstream Anvil instance unreachable (connection refused, timeout, etc.) |
| `503` | `INSTANCE_UNAVAILABLE` | Upstream instance temporarily unavailable (future Q3-B cold-start mode) |
| `504` | `UPSTREAM_TIMEOUT` | Upstream Anvil instance timed out (future) |
