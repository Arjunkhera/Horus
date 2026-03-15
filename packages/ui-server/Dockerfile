# ── Stage 1: build React/Vite frontend ────────────────────────────────────────
FROM node:20-alpine AS client-build
WORKDIR /build

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/ui-client/package.json ./packages/ui-client/
COPY packages/ui-server/package.json ./packages/ui-server/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

COPY packages/ui-client ./packages/ui-client
COPY packages/shared ./packages/shared

RUN pnpm --filter @horus/ui-client build

# ── Stage 2: production server ─────────────────────────────────────────────────
FROM node:20-alpine AS server
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/ui-server/package.json ./packages/ui-server/

RUN corepack enable && pnpm install --filter @horus/ui-server --prod --frozen-lockfile --ignore-scripts

COPY packages/ui-server ./packages/ui-server

# Copy built static assets from stage 1
COPY --from=client-build /build/packages/ui-client/dist ./packages/ui-server/public

EXPOSE 8400
CMD ["node", "packages/ui-server/src/server.js"]
