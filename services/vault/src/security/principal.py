"""
Principal-enforcement middleware (b8fae51a / ADR-0008 §H).

horus-service mints a short-lived internal JWT carrying the verified principal
and injects it as the `X-Horus-Principal` header. This middleware verifies that
JWT's *signature* using the internal signing key's PUBLIC half (distributed as a
K8s Secret), extracts the canonical Principal into request.state, and rejects
(401, fail-closed) when the header is missing or invalid.

Enforcement is enabled only when a public key is configured (env). Absent a key
(local/single-tenant dev), the middleware is a no-op so the service stays usable
behind a trusted boundary — mirroring the gateway's "verify only when configured"
posture.

Defense-in-depth: this sits alongside K8s NetworkPolicy, not in place of it.
Alpha scope: no per-vault role checks — the deployment boundary is the tenancy
boundary.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import jwt
from jwt.algorithms import ECAlgorithm, RSAAlgorithm
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

PRINCIPAL_HEADER = "x-horus-principal"
CLOCK_SKEW_LEEWAY_SECONDS = 30

# Paths that never require a principal (liveness/readiness, docs, root).
DEFAULT_SKIP_PATHS = frozenset(
    {"/health", "/status", "/", "/docs", "/redoc", "/openapi.json", "/favicon.ico"}
)


@dataclass
class Principal:
    tenant: str
    user: str
    role: str
    roles: list[str] = field(default_factory=list)
    claims: dict[str, Any] = field(default_factory=dict)


class PrincipalError(Exception):
    """Raised when an X-Horus-Principal token cannot be verified."""


def _load_public_key(jwk: dict) -> tuple[Any, str]:
    """Return (public_key_obj, algorithm) for the given public JWK."""
    kty = jwk.get("kty")
    if kty == "EC":
        return ECAlgorithm.from_jwk(json.dumps(jwk)), "ES256"
    if kty == "RSA":
        return RSAAlgorithm.from_jwk(json.dumps(jwk)), "RS256"
    raise ValueError(f"unsupported JWK kty: {kty!r}")


def build_verifier(
    public_jwk: dict,
    *,
    leeway: int = CLOCK_SKEW_LEEWAY_SECONDS,
) -> Callable[[str], Principal]:
    """Build a verifier that validates a compact JWT and returns its Principal."""
    key, algorithm = _load_public_key(public_jwk)

    def verify(token: str) -> Principal:
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                leeway=leeway,
                options={"verify_aud": False, "require": ["exp"]},
            )
        except jwt.PyJWTError as exc:  # expired, bad signature, malformed, etc.
            raise PrincipalError(str(exc)) from exc

        tenant, user, role = payload.get("tenant"), payload.get("user"), payload.get("role")
        if not (isinstance(tenant, str) and isinstance(user, str) and isinstance(role, str)):
            raise PrincipalError("token missing required claims: tenant, user, role")

        standard = {"tenant", "user", "role", "roles", "iat", "exp", "nbf", "aud", "iss"}
        return Principal(
            tenant=tenant,
            user=user,
            role=role,
            roles=payload.get("roles", []) if isinstance(payload.get("roles"), list) else [],
            claims={k: v for k, v in payload.items() if k not in standard},
        )

    return verify


def load_public_jwk_from_env(env: Optional[dict] = None) -> Optional[dict]:
    """Resolve the principal public JWK from env: inline JSON or a file path."""
    env = env if env is not None else os.environ
    inline = env.get("HORUS_PRINCIPAL_PUBLIC_JWK")
    if inline:
        return json.loads(inline)
    path = env.get("HORUS_PRINCIPAL_PUBLIC_JWK_FILE")
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return None


def _unauthorized(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={
            "error": {
                "code": "UNAUTHORIZED",
                "message": message,
                "request_id": str(uuid.uuid4()),
            }
        },
    )


class PrincipalMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, verifier: Callable[[str], Principal], skip_paths=DEFAULT_SKIP_PATHS):
        super().__init__(app)
        self._verify = verifier
        self._skip = skip_paths

    async def dispatch(self, request: Request, call_next):
        if request.url.path in self._skip:
            return await call_next(request)
        token = request.headers.get(PRINCIPAL_HEADER)
        if not token:
            return _unauthorized("missing X-Horus-Principal header")
        try:
            principal = self._verify(token)
        except PrincipalError as exc:
            return _unauthorized(f"invalid X-Horus-Principal: {exc}")
        request.state.principal = principal
        return await call_next(request)


def install_principal_middleware(app: FastAPI, env: Optional[dict] = None) -> bool:
    """
    Install the middleware iff a public JWK is configured. Returns True when
    enforcement is active. No key configured → no-op (local/dev), returns False.
    """
    jwk = load_public_jwk_from_env(env)
    if jwk is None:
        return False
    verifier = build_verifier(jwk)
    app.add_middleware(PrincipalMiddleware, verifier=verifier)
    return True
