# ── Build stage ───────────────────────────────────────────────────────────────
# Context: monorepo root (needs packages/router-core + services/anvil-router).
FROM node:22-alpine AS builder

WORKDIR /build

# Install pnpm — pinned to pnpm@9 (matches workspace convention)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# Copy dependency package manifests (bottom-up topological order)
# @horus/auth and @horus/scope are needed by @horus/router-core
COPY packages/auth/package.json ./packages/auth/
COPY packages/scope/package.json ./packages/scope/
COPY packages/router-core/package.json ./packages/router-core/
COPY services/anvil-router/package.json ./services/anvil-router/

# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Copy source for workspace dependencies (build order: auth → scope → router-core → anvil-router)
COPY packages/auth/ ./packages/auth/
COPY packages/scope/ ./packages/scope/
COPY packages/router-core/ ./packages/router-core/
COPY services/anvil-router/ ./services/anvil-router/

# Build in topological order
RUN pnpm --filter @horus/auth build \
 && pnpm --filter @horus/scope build \
 && pnpm --filter @horus/router-core build \
 && pnpm --filter @horus/anvil-router build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV ANVIL_ROUTER_PORT=8200

# Workspace manifests (needed for pnpm linking)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/auth/package.json ./packages/auth/
COPY packages/scope/package.json ./packages/scope/
COPY packages/router-core/package.json ./packages/router-core/
COPY services/anvil-router/package.json ./services/anvil-router/

RUN corepack enable && corepack prepare pnpm@9 --activate && \
    pnpm install --prod --frozen-lockfile

# Copy pre-built package dists
COPY --from=builder /build/packages/auth/dist/ ./packages/auth/dist/
COPY --from=builder /build/packages/scope/dist/ ./packages/scope/dist/
COPY --from=builder /build/packages/router-core/dist/ ./packages/router-core/dist/
COPY --from=builder /build/services/anvil-router/dist/ ./services/anvil-router/dist/

WORKDIR /app/services/anvil-router

EXPOSE 8200

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8200/health || exit 1

CMD ["node", "dist/index.js"]
