# @horus/anvil-router

The Anvil Router is a TypeScript Fastify service that routes Anvil MCP and REST traffic to the correct per-user Anvil instance in the Horus platform. It sits between the Claude Code client and each user's dedicated Anvil container, applying per-tenant auth and registry-driven routing rules.

This scaffold (TA-1) establishes the service directory, build pipeline, and `/health` endpoint. No routing logic is included; that is implemented in subsequent stories (TA-2..TA-11).

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

## Health endpoint

```
GET /health → 200 { status: "ok", service: "anvil-router", version: "0.1.0" }
```
