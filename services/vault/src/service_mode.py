"""
Vault Reader/Writer mode (#8).

A Vault pod runs as a stateless READER (serves reads from Typesense + Neo4j; no
git, no sync daemon, no PVC) or the single WRITER (PVC + git, sole mutator).
Default is "writer" so a standalone single-node Vault behaves exactly as before.

The split is primarily deployment topology (see deploy/base/vault.yaml); this
module adds the in-process behavior: readers skip the git sync daemon and reject
write requests (defense-in-depth — vault-router routes writes to the writer, so
a write reaching a reader is a misroute).
"""

from __future__ import annotations

import os
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Exact paths that mutate state — rejected on a reader pod.
WRITE_PATHS = frozenset(
    {
        "/write-page",
        "/registry/add",
        "/reindex",
        "/graph/edges",
        "/graph/edges/delete",
        "/graph/export",
        "/graph/import",
    }
)


def get_vault_mode(env: dict | None = None) -> str:
    """Return 'reader' or 'writer' (default 'writer')."""
    env = env if env is not None else os.environ
    mode = (env.get("VAULT_MODE") or "writer").strip().lower()
    return "reader" if mode == "reader" else "writer"


def is_reader(mode: str) -> bool:
    return mode == "reader"


def should_run_sync(mode: str) -> bool:
    """Readers are stateless — no git pull loop / workspace watcher."""
    return not is_reader(mode)


class ReadOnlyGuardMiddleware(BaseHTTPMiddleware):
    """On a reader pod, reject write endpoints with 503 (misrouted write)."""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path in WRITE_PATHS:
            return JSONResponse(
                status_code=503,
                content={
                    "error": {
                        "code": "READER_WRITE_REJECTED",
                        "message": f"{request.url.path} is a write endpoint; route writes to the vault-writer",
                        "request_id": str(uuid.uuid4()),
                    }
                },
            )
        return await call_next(request)


def install_read_only_guard(app: FastAPI, mode: str) -> bool:
    """Install the write-guard iff running as a reader. Returns True when active."""
    if not is_reader(mode):
        return False
    app.add_middleware(ReadOnlyGuardMiddleware)
    return True
