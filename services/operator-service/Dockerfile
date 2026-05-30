# ─── Build context: monorepo root ─────────────────────────────────────────────
# operator-service depends on @horus/auth and @horus/search (workspace
# siblings), so the build context must be the Horus monorepo root.
#
# Build:
#   docker build -f services/operator-service/Dockerfile \
#     -t ghcr.io/arjunkhera/horus/operator-service:0.1.0-alpha .
# ──────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/auth/package.json ./packages/auth/
COPY packages/search/package.json ./packages/search/
COPY services/operator-service/package.json ./services/operator-service/

RUN pnpm install --no-frozen-lockfile

COPY packages/auth/ ./packages/auth/
COPY packages/search/ ./packages/search/
COPY services/operator-service/ ./services/operator-service/

RUN pnpm --filter @horus/auth build \
    && pnpm --filter @horus/search build \
    && pnpm --filter @horus/operator-service build

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

LABEL org.opencontainers.image.title="Horus Operator Service" \
      org.opencontainers.image.description="Privileged provisioning — user mgmt, vault provisioning, key issuance" \
      org.opencontainers.image.source="https://github.com/arjunkhera/horus" \
      org.opencontainers.image.licenses="MIT"

RUN useradd -ms /bin/bash horus
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY packages/auth/package.json ./packages/auth/
COPY packages/search/package.json ./packages/search/
COPY services/operator-service/package.json ./services/operator-service/

RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --prod --no-frozen-lockfile

COPY --from=builder /build/packages/auth/dist ./packages/auth/dist
COPY --from=builder /build/packages/search/dist ./packages/search/dist
COPY --from=builder /build/services/operator-service/dist ./services/operator-service/dist

RUN mkdir -p /data && chown -R horus:horus /app /data
USER horus
WORKDIR /app/services/operator-service

EXPOSE 8090
ENV OPERATOR_PORT=8090 \
    OPERATOR_DB_PATH=/data/operator.db

ENTRYPOINT ["node", "dist/index.js"]
