# ─── Stage 0: Build @horus/search ─────────────────────────────────────────
# Context: monorepo root. Builds the shared search package in isolation.
FROM node:22-bookworm-slim AS search-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /search
COPY packages/search/package.json packages/search/tsconfig.json ./
RUN pnpm install --no-frozen-lockfile
COPY packages/search/src/ ./src/
RUN pnpm build


# ─── Stage 1: Build Forge ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build

# Copy forge workspace manifests
COPY packages/forge/package.json packages/forge/pnpm-workspace.yaml packages/forge/.npmrc ./

# Copy package manifests for all forge workspace packages
COPY packages/forge/packages/core/package.json ./packages/core/
COPY packages/forge/packages/cli/package.json ./packages/cli/
COPY packages/forge/packages/mcp-server/package.json ./packages/mcp-server/

# Add pre-built @horus/search as a workspace sibling
COPY packages/search/package.json ./packages/search/
COPY --from=search-builder /search/dist/ ./packages/search/dist/
RUN echo "  - '../search'" >> pnpm-workspace.yaml

# Install all deps
RUN pnpm install --no-frozen-lockfile

# Copy source files and per-package tsconfigs
COPY packages/forge/packages/ ./packages/
COPY packages/forge/tsconfig.json ./

# Build packages in dependency order
RUN pnpm --filter @forge/core build \
    && pnpm --filter @forge/mcp-server build \
    && pnpm --filter @forge/cli build


# ─── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash forge

WORKDIR /app

# Copy workspace manifests for production install
COPY packages/forge/package.json packages/forge/pnpm-workspace.yaml packages/forge/.npmrc ./
COPY packages/forge/packages/core/package.json ./packages/core/
COPY packages/forge/packages/cli/package.json ./packages/cli/
COPY packages/forge/packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/search/package.json ./packages/search/
RUN echo "  - '../search'" >> pnpm-workspace.yaml

RUN pnpm install --prod --no-frozen-lockfile

# Copy compiled output
COPY --from=search-builder /search/dist ./packages/search/dist
COPY --from=builder /build/packages/core/dist ./packages/core/dist
COPY --from=builder /build/packages/cli/dist ./packages/cli/dist
COPY --from=builder /build/packages/mcp-server/dist ./packages/mcp-server/dist

COPY packages/forge/entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /data/registry /data/workspaces \
    && chown -R forge:forge /app /data /home/forge

USER forge

EXPOSE 8200

ENV FORGE_PORT=8200
ENV FORGE_HOST=0.0.0.0
ENV FORGE_REGISTRY_PATH=/data/registry
ENV FORGE_WORKSPACES_PATH=/data/workspaces
ENV FORGE_ANVIL_URL=http://anvil:8100
ENV FORGE_VAULT_URL=http://vault:8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -f http://localhost:${FORGE_PORT}/health || exit 1

CMD ["./entrypoint.sh"]
