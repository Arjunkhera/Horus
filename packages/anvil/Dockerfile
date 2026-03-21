# ─── Stage 1: Builder ─────────────────────────────────────────────────────
# Installs all dependencies (including dev) and compiles TypeScript.
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# Copy manifests first (layer cache)
COPY package.json package-lock.json tsconfig.json ./

# Install all deps (including devDependencies needed for TypeScript compilation)
RUN npm ci

# Copy source files
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build


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

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder stage
COPY --from=builder /build/dist/ ./dist/

# Copy static assets
COPY defaults/ ./defaults/

# Entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

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

CMD ["./entrypoint.sh"]
