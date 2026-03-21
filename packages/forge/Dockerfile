# ─── Stage 1: Builder ─────────────────────────────────────────────────────
# Installs all dependencies (including dev) and compiles TypeScript.
FROM node:22-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build

# Copy root workspace manifests first (layer cache)
COPY package.json tsconfig.json ./

# Copy package manifests for all workspace packages
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
COPY packages/mcp-server/package.json ./packages/mcp-server/

# Install all deps (including devDependencies needed for TypeScript build)
# --no-frozen-lockfile: forge has no standalone pnpm-lock.yaml (monorepo root manages it)
RUN pnpm install --no-frozen-lockfile

# Copy source files and per-package tsconfigs
COPY packages/ ./packages/

# Build packages in explicit dependency order: core → mcp-server → cli
RUN pnpm --filter @forge/core build \
    && pnpm --filter @forge/mcp-server build \
    && pnpm --filter @forge/cli build


# ─── Stage 2: Runtime ─────────────────────────────────────────────────────
# Lean image with only production deps and compiled JS.
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

# System dependencies: git (repo index scanning), curl (health checks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -ms /bin/bash forge

WORKDIR /app

# Copy root workspace manifests for production install
COPY package.json ./

# Copy package manifests (needed for pnpm workspace resolution)
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
COPY packages/mcp-server/package.json ./packages/mcp-server/

# Install production dependencies only
RUN pnpm install --prod --no-frozen-lockfile

# Copy compiled output from builder stage
COPY --from=builder /build/packages/core/dist ./packages/core/dist
COPY --from=builder /build/packages/cli/dist ./packages/cli/dist
COPY --from=builder /build/packages/mcp-server/dist ./packages/mcp-server/dist

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create data directories and set ownership
RUN mkdir -p /data/registry /data/workspaces \
    && chown -R forge:forge /app /data /home/forge

USER forge

EXPOSE 8200

# Environment configuration with defaults
ENV FORGE_PORT=8200
ENV FORGE_HOST=0.0.0.0
ENV FORGE_REGISTRY_PATH=/data/registry
ENV FORGE_WORKSPACES_PATH=/data/workspaces
ENV FORGE_ANVIL_URL=http://anvil:8100
ENV FORGE_VAULT_URL=http://vault:8000

# Health check — waits for the HTTP server to be ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -f http://localhost:${FORGE_PORT}/health || exit 1

CMD ["./entrypoint.sh"]
