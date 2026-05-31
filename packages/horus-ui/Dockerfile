# Horus UI image — the new local client backend. Hosts the Anvil proxy, the
# agent chat surface, AND the embedded Forge local-execution engine
# (@forge/core + @forge/mcp-server). Build context: monorepo root.
#
# Forge's core/mcp-server are built inside their NESTED workspace
# (packages/forge, which sets shamefully-hoist so tsc can resolve test-time
# deps) — exactly how packages/forge/Dockerfile builds the forge image.

# ─── Stage 0: Build @horus/search ─────────────────────────────────────────
FROM node:22-bookworm-slim AS search-builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /search
COPY .npmrc ./
COPY packages/search/package.json packages/search/tsconfig.json ./
RUN pnpm install --no-frozen-lockfile
COPY packages/search/src/ ./src/
RUN pnpm build

# ─── Stage 1: Build the Forge engine (core + mcp-server) ──────────────────
FROM node:22-bookworm-slim AS forge-builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /build
COPY packages/forge/package.json packages/forge/pnpm-workspace.yaml packages/forge/.npmrc ./
COPY packages/forge/packages/core/package.json ./packages/core/
COPY packages/forge/packages/cli/package.json ./packages/cli/
COPY packages/forge/packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/search/package.json ./packages/search/
COPY --from=search-builder /search/dist/ ./packages/search/dist/
RUN pnpm install --no-frozen-lockfile
COPY packages/forge/packages/ ./packages/
COPY packages/forge/tsconfig.json ./
RUN pnpm --filter @forge/core build \
 && pnpm --filter @forge/mcp-server build

# ─── Stage 2: Runtime — horus-ui embedded in the forge workspace ──────────
FROM node:22-bookworm-slim AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Reuse the forge nested workspace (packages/* glob). horus-ui joins as a member
# at packages/horus-ui, so its @forge/core / @forge/mcp-server workspace:* deps
# resolve, and shamefully-hoist flattens its runtime deps into /app/node_modules.
COPY packages/forge/package.json packages/forge/pnpm-workspace.yaml packages/forge/.npmrc ./
COPY packages/forge/packages/core/package.json ./packages/core/
COPY packages/forge/packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/search/package.json ./packages/search/
COPY packages/horus-ui/package.json ./packages/horus-ui/

RUN pnpm install --prod --no-frozen-lockfile

# Pre-built outputs
COPY --from=search-builder /search/dist ./packages/search/dist
COPY --from=forge-builder /build/packages/core/dist ./packages/core/dist
COPY --from=forge-builder /build/packages/mcp-server/dist ./packages/mcp-server/dist

# horus-ui is plain ESM JS (no build) + the SPA static assets
COPY packages/horus-ui/ ./packages/horus-ui/
COPY packages/horus-ui-client/ ./packages/horus-ui-client/

ENV READER_STATIC=/app/packages/horus-ui-client

WORKDIR /app/packages/horus-ui
EXPOSE 8400
CMD ["node", "server.js"]
