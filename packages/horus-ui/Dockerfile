# ── Builder stage ─────────────────────────────────────────────────────────────
# Builds the TypeScript workspace dependencies that horus-ui needs at runtime.
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /repo

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/search/package.json ./packages/search/
COPY packages/forge/packages/core/package.json ./packages/forge/packages/core/
COPY packages/forge/packages/mcp-server/package.json ./packages/forge/packages/mcp-server/
COPY packages/horus-ui/package.json ./packages/horus-ui/

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Copy sources and build
COPY packages/search/ ./packages/search/
COPY packages/forge/packages/core/ ./packages/forge/packages/core/
COPY packages/forge/packages/mcp-server/ ./packages/forge/packages/mcp-server/

RUN pnpm build --filter @horus/search --filter @forge/core --filter @forge/mcp-server

# ── Runner stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Copy the horus-ui application
COPY packages/horus-ui/ ./

# Copy compiled dist/ of workspace deps into node_modules symlink targets
RUN mkdir -p node_modules/@horus node_modules/@forge

COPY --from=builder /repo/packages/search/dist ./node_modules/@horus/search/dist
COPY --from=builder /repo/packages/search/package.json ./node_modules/@horus/search/package.json
COPY --from=builder /repo/packages/forge/packages/core/dist ./node_modules/@forge/core/dist
COPY --from=builder /repo/packages/forge/packages/core/package.json ./node_modules/@forge/core/package.json
COPY --from=builder /repo/packages/forge/packages/mcp-server/dist ./node_modules/@forge/mcp-server/dist
COPY --from=builder /repo/packages/forge/packages/mcp-server/package.json ./node_modules/@forge/mcp-server/package.json

# Copy transitive node_modules that the builder resolved (everything except
# workspace packages which are already above)
COPY --from=builder /repo/node_modules ./node_modules_root
# Install horus-ui's own non-workspace deps
RUN npm install --production --ignore-scripts 2>/dev/null || true

# Copy the horus-ui-client SPA (static assets)
COPY packages/horus-ui-client/ ./public/

ENV READER_STATIC=/app/public
ENV NODE_PATH=/app/node_modules

EXPOSE 8400
CMD ["node", "server.js"]
