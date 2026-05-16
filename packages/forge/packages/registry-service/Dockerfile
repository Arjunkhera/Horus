# ─── Build context: monorepo root ─────────────────────────────────────────────
# The registry-service depends on @forge/core (workspace sibling), so the build
# context must be the Horus monorepo root, not the package directory.
#
# Build:
#   docker build -f packages/forge/packages/registry-service/Dockerfile \
#     -t ghcr.io/arjunkhera/forge-registry:latest .
# ──────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /build

# Copy root workspace manifest (needed so pnpm resolves workspace: protocol)
COPY package.json pnpm-workspace.yaml .npmrc* ./

# Copy workspace package manifests in dependency order (layer cache-friendly)
COPY packages/forge/package.json ./packages/forge/
COPY packages/forge/packages/core/package.json ./packages/forge/packages/core/
COPY packages/forge/packages/registry-service/package.json ./packages/forge/packages/registry-service/
COPY packages/search/package.json ./packages/search/

# Install ALL deps (including devDeps) — required for tsc
RUN pnpm install --no-frozen-lockfile

# Copy tsconfigs
COPY packages/forge/tsconfig.json ./packages/forge/tsconfig.json
COPY packages/forge/packages/core/tsconfig.json ./packages/forge/packages/core/tsconfig.json
COPY packages/forge/packages/registry-service/tsconfig.json ./packages/forge/packages/registry-service/tsconfig.json

# Copy source files (search package is needed as workspace dep)
COPY packages/search/ ./packages/search/
COPY packages/forge/packages/core/src/ ./packages/forge/packages/core/src/
COPY packages/forge/packages/registry-service/src/ ./packages/forge/packages/registry-service/src/

# Build in dependency order: search → core → registry-service
# @horus/search uses its package.json build script (tsup); core and registry-service use tsc.
RUN TSC=$(find /build -name "tsc" -path "*/typescript/bin/tsc" | head -1) && \
    echo "Using tsc: $TSC" && \
    cd /build && pnpm --filter @horus/search run build && \
    cd /build/packages/forge/packages/core && $TSC -p tsconfig.json && \
    cd /build/packages/forge/packages/registry-service && $TSC -p tsconfig.json


# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

LABEL org.opencontainers.image.title="Forge Registry Service" \
      org.opencontainers.image.description="Forge Remote Registry — validated publish and resolve path for all Forge artifacts" \
      org.opencontainers.image.source="https://github.com/arjunkhera/horus" \
      org.opencontainers.image.vendor="Arjun Khera" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
      git \
      openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash forge

WORKDIR /app

# Copy workspace manifests for production install
COPY package.json pnpm-workspace.yaml .npmrc* ./
COPY packages/forge/package.json ./packages/forge/
COPY packages/forge/packages/core/package.json ./packages/forge/packages/core/
COPY packages/forge/packages/registry-service/package.json ./packages/forge/packages/registry-service/
COPY packages/search/package.json ./packages/search/

RUN corepack enable && corepack prepare pnpm@latest --activate \
    && pnpm install --prod --no-frozen-lockfile

# Copy compiled output from builder
COPY --from=builder /build/packages/search/dist ./packages/search/dist
COPY --from=builder /build/packages/forge/packages/core/dist ./packages/forge/packages/core/dist
COPY --from=builder /build/packages/forge/packages/registry-service/dist ./packages/forge/packages/registry-service/dist

RUN mkdir -p /data/registry \
    && chown -R forge:forge /app /data /home/forge

USER forge

WORKDIR /app/packages/forge/packages/registry-service

EXPOSE 8744

ENV FORGE_REGISTRY_HOST=0.0.0.0 \
    FORGE_REGISTRY_PORT=8744 \
    FORGE_REGISTRY_DB_PATH=/data/registry/forge-registry.db \
    FORGE_REGISTRY_LOG_LEVEL=info

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD curl -f http://localhost:8744/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
