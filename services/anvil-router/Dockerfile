# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY services/anvil-router/package.json ./services/anvil-router/

# Install only production deps for the package
RUN pnpm install --filter @horus/anvil-router --frozen-lockfile

# Copy source
COPY services/anvil-router/ ./services/anvil-router/

# Build TypeScript
RUN pnpm --filter @horus/anvil-router build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV ANVIL_ROUTER_PORT=8200

# Copy built output and package manifest
COPY --from=builder /build/services/anvil-router/dist ./dist
COPY --from=builder /build/services/anvil-router/package.json ./package.json
COPY --from=builder /build/services/anvil-router/node_modules ./node_modules

EXPOSE 8200

CMD ["node", "dist/index.js"]
