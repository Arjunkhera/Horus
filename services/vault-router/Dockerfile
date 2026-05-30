# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/build/deps -r requirements.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim

# Non-root user for security
RUN useradd --system --uid 1001 --no-create-home router
USER router

# Copy installed deps from builder
COPY --from=builder /build/deps /usr/local

# Copy application source
WORKDIR /app
COPY --chown=router:router src/ ./src/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

EXPOSE 8400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://localhost:%s/health' % os.getenv('VAULT_ROUTER_PORT','8400'))"

# Honor VAULT_ROUTER_PORT (default 8400) so the bind port matches deploy config.
CMD ["sh", "-c", "exec python -m uvicorn src.main:app --host 0.0.0.0 --port ${VAULT_ROUTER_PORT:-8400}"]
