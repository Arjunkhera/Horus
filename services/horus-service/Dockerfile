# ─── Build context: monorepo root ─────────────────────────────────────────────
# horus-service depends on @horus/auth and @horus/gateway-core (workspace
# siblings), so the build context must be the Horus monorepo root.
#
# Build:
#   docker build -f services/horus-service/Dockerfile \
#     -t ghcr.io/arjunkhera/horus/horus-service:0.1.0-alpha .
# ──────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /build

# Workspace manifests (so pnpm resolves the workspace: protocol)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/auth/package.json ./packages/auth/
COPY packages/gateway-core/package.json ./packages/gateway-core/
COPY services/horus-service/package.json ./services/horus-service/

# Install all deps (incl. dev — tsup/tsc needed to build)
RUN pnpm install --no-frozen-lockfile

# tsconfigs + sources
COPY packages/auth/ ./packages/auth/
COPY packages/gateway-core/ ./packages/gateway-core/
COPY services/horus-service/ ./services/horus-service/

# Build leaf deps first, then the service (each uses its own tsup build script)
RUN pnpm --filter @horus/auth build \
    && pnpm --filter @horus/gateway-core build \
    && pnpm --filter @horus/horus-service build

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

LABEL org.opencontainers.image.title="Horus Service" \
      org.opencontainers.image.description="Public API gateway — edge/identity + aggregation" \
      org.opencontainers.image.source="https://github.com/arjunkhera/horus" \
      org.opencontainers.image.licenses="MIT"

RUN useradd -ms /bin/bash horus
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/auth/package.json ./packages/auth/
COPY packages/gateway-core/package.json ./packages/gateway-core/
COPY services/horus-service/package.json ./services/horus-service/

RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --prod --no-frozen-lockfile

# Compiled output from the builder stage
COPY --from=builder /build/packages/auth/dist ./packages/auth/dist
COPY --from=builder /build/packages/gateway-core/dist ./packages/gateway-core/dist
COPY --from=builder /build/services/horus-service/dist ./services/horus-service/dist

RUN chown -R horus:horus /app
USER horus
WORKDIR /app/services/horus-service

EXPOSE 8080
ENV HORUS_SERVICE_PORT=8080

ENTRYPOINT ["node", "dist/index.js"]
