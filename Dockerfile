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

# System dependencies for QMD (cmake + g++ + make needed for node-llama-cpp native build)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    cmake \
    make \
    g++ \
    curl \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user early so QMD is installed into their home
RUN useradd -ms /bin/bash anvil

# Install QMD globally from npm, then fix permissions so the anvil user
# can write to the node-llama-cpp build/cache directories at runtime.
# GGUF models (~1GB) are downloaded on first use — mount a volume at
# /home/anvil/.cache/qmd for persistence across rebuilds.
RUN npm install -g @tobilu/qmd && \
    chmod -R a+rwX /usr/local/lib/node_modules/@tobilu/qmd/node_modules/node-llama-cpp/ || \
    echo "QMD installation failed - will use FTS5 fallback"

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

# Data directories + QMD cache (must exist before USER switch for volume mount permissions)
RUN mkdir -p /data/notes /home/anvil/.cache/qmd && chown -R anvil:anvil /app /data /home/anvil/.cache

EXPOSE 8100

# Environment configuration with defaults
ENV ANVIL_TRANSPORT=http
ENV ANVIL_PORT=8100
ENV ANVIL_HOST=0.0.0.0
ENV ANVIL_NOTES_PATH=/data/notes
ENV ANVIL_QMD_COLLECTION=anvil
ENV ANVIL_SYNC_INTERVAL=300
ENV ANVIL_DEBOUNCE_SECONDS=5

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -f http://localhost:8100/health || exit 1

CMD ["./entrypoint.sh"]
