# ─── Stage 1: Builder ─────────────────────────────────────────────────────
# Installs all dependencies (including dev) and compiles TypeScript.
# Context: monorepo root (needs packages/search + packages/anvil).
FROM node:22-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build

# Minimal workspace manifest (only search + anvil)
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/search/package.json ./packages/search/
COPY packages/anvil/package.json ./packages/anvil/

# Install all deps (including devDependencies needed for TypeScript compilation)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/search/ ./packages/search/
COPY packages/anvil/src/ ./packages/anvil/src/
COPY packages/anvil/tsconfig.json ./packages/anvil/

# Build search first (anvil depends on it), then anvil
RUN pnpm --filter @horus/search build && pnpm --filter anvil-mcp build


# ─── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -ms /bin/bash anvil

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install production dependencies only
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/search/package.json ./packages/search/
COPY packages/anvil/package.json ./packages/anvil/
RUN pnpm install --prod --frozen-lockfile

# Copy compiled output from builder stage
COPY --from=builder /build/packages/search/dist/ ./packages/search/dist/
COPY --from=builder /build/packages/anvil/dist/ ./packages/anvil/dist/

# Copy static assets
COPY packages/anvil/defaults/ ./packages/anvil/defaults/

# Entrypoint script
COPY packages/anvil/entrypoint.sh ./packages/anvil/
RUN chmod +x packages/anvil/entrypoint.sh

RUN mkdir -p /data/notes && chown -R anvil:anvil /app /data /home/anvil

EXPOSE 8100

# Environment configuration with defaults
ENV ANVIL_TRANSPORT=http
ENV ANVIL_PORT=8100
ENV ANVIL_HOST=0.0.0.0
ENV ANVIL_NOTES_PATH=/data/notes
ENV ANVIL_SYNC_INTERVAL=300
ENV ANVIL_DEBOUNCE_SECONDS=5

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -f http://localhost:8100/health || exit 1

CMD ["./packages/anvil/entrypoint.sh"]
