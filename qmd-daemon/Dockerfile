# ─── QMD Daemon ─────────────────────────────────────────────────────────────
# Long-lived QMD MCP HTTP server shared by Anvil and Vault.
# Keeps models warm in memory. Anvil and Vault mount the same qmd-daemon-data
# volume to share the SQLite index and run subprocess reindex calls.
FROM node:22-bookworm-slim

# Build dependencies for node-llama-cpp native GGUF model loading
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    make \
    g++ \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user. QMD stores its database and model cache in ~/.cache/qmd
# — mount qmd-daemon-data volume at /home/qmd/.cache/qmd for persistence.
RUN useradd -ms /bin/bash qmd

# Install QMD from upstream git (v1.1.0+ with REST /query endpoint).
# Clone → build → pack tarball → install globally (avoids symlink issues).
RUN git clone --depth 1 https://github.com/tobi/qmd.git /tmp/qmd && \
    cd /tmp/qmd && npm install && npm run build && \
    npm pack && npm install -g tobilu-qmd-*.tgz && \
    rm -rf /tmp/qmd && \
    chmod -R a+rwX /usr/local/lib/node_modules/@tobilu/qmd/node_modules/node-llama-cpp/ || \
    echo "QMD llama-cpp permission fix failed (non-fatal)"

# QMD's HTTP server hardcodes "localhost" as the bind address, making it
# unreachable from other containers on the same Docker network.
# Patch mcp.js to respect QMD_BIND_HOST (default: 0.0.0.0) so that Docker
# service-to-service calls work while localhost-only is still possible via env var.
RUN sed -i \
    's/httpServer\.listen(port, "localhost",/httpServer.listen(port, process.env.QMD_BIND_HOST || "0.0.0.0",/' \
    /usr/local/lib/node_modules/@tobilu/qmd/dist/mcp/server.js

RUN mkdir -p /home/qmd/.cache/qmd && chown -R qmd:qmd /home/qmd/.cache

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER qmd

EXPOSE 8181

# start-period covers first-boot model download (~1-2 GB GGUF) and initial embed
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
  CMD curl -f http://localhost:8181/health || exit 1

CMD ["/entrypoint.sh"]
