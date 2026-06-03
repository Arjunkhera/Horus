"""Unit tests for the X-Horus-Principal enforcement middleware (b8fae51a)."""

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm

from src.security.principal import (
    build_verifier,
    install_principal_middleware,
    load_public_jwk_from_env,
    PrincipalError,
    PrincipalMiddleware,
)


@pytest.fixture
def keypair():
    priv = ec.generate_private_key(ec.SECP256R1())
    priv_pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub_jwk = ECAlgorithm.to_jwk(priv.public_key(), as_dict=True)
    return priv_pem, pub_jwk


def _mint(priv_pem, *, exp_offset=60, **claims):
    now = int(time.time())
    payload = {"tenant": "acme", "user": "alice", "role": "admin", "iat": now, "exp": now + exp_offset}
    payload.update(claims)
    return jwt.encode(payload, priv_pem, algorithm="ES256")


def test_verifier_accepts_valid_token_and_extracts_principal(keypair):
    priv_pem, pub_jwk = keypair
    verify = build_verifier(pub_jwk)
    principal = verify(_mint(priv_pem))
    assert (principal.tenant, principal.user, principal.role) == ("acme", "alice", "admin")


def test_verifier_rejects_bad_signature(keypair):
    _, pub_jwk = keypair
    other = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    verify = build_verifier(pub_jwk)
    with pytest.raises(PrincipalError):
        verify(_mint(other))


def test_verifier_rejects_expired_beyond_skew(keypair):
    priv_pem, pub_jwk = keypair
    verify = build_verifier(pub_jwk)
    with pytest.raises(PrincipalError):
        verify(_mint(priv_pem, exp_offset=-60))  # 60s past, beyond 30s leeway


def test_verifier_allows_within_clock_skew(keypair):
    priv_pem, pub_jwk = keypair
    verify = build_verifier(pub_jwk)
    # exp 20s in the past, inside the 30s leeway window → still valid
    principal = verify(_mint(priv_pem, exp_offset=-20))
    assert principal.user == "alice"


def _app_with_principal(pub_jwk):
    app = FastAPI()

    # /write-page is in WRITE_PATHS → principal-gated. /search and /health are
    # reads → never gated (the design contract; see PrincipalMiddleware).
    @app.get("/write-page")
    async def write_page(request: Request):
        p = request.state.principal
        return {"user": p.user, "tenant": p.tenant, "role": p.role}

    @app.get("/search")
    async def search():
        return {"results": []}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    app.add_middleware(PrincipalMiddleware, verifier=build_verifier(pub_jwk))
    return app


def test_middleware_rejects_missing_header_on_write(keypair):
    _, pub_jwk = keypair
    client = TestClient(_app_with_principal(pub_jwk))
    res = client.get("/write-page")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_middleware_allows_valid_token_on_write(keypair):
    priv_pem, pub_jwk = keypair
    client = TestClient(_app_with_principal(pub_jwk))
    res = client.get("/write-page", headers={"X-Horus-Principal": _mint(priv_pem)})
    assert res.status_code == 200
    assert res.json() == {"user": "alice", "tenant": "acme", "role": "admin"}


def test_middleware_allows_read_path_without_token(keypair):
    """Reads are not principal-gated — the multi-vault read fix (bug 281e98ed)."""
    _, pub_jwk = keypair
    client = TestClient(_app_with_principal(pub_jwk))
    res = client.get("/search")  # no header
    assert res.status_code == 200
    assert res.json() == {"results": []}


def test_middleware_skips_health(keypair):
    priv_pem, pub_jwk = keypair
    client = TestClient(_app_with_principal(pub_jwk))
    assert client.get("/health").status_code == 200  # no header, still allowed


def test_install_is_noop_without_key():
    app = FastAPI()
    assert install_principal_middleware(app, env={}) is False


def test_install_enables_with_inline_jwk(keypair):
    _, pub_jwk = keypair
    app = FastAPI()
    enabled = install_principal_middleware(app, env={"HORUS_PRINCIPAL_PUBLIC_JWK": json.dumps(pub_jwk)})
    assert enabled is True


def test_load_public_jwk_from_env_inline(keypair):
    _, pub_jwk = keypair
    loaded = load_public_jwk_from_env({"HORUS_PRINCIPAL_PUBLIC_JWK": json.dumps(pub_jwk)})
    assert loaded["kty"] == "EC"
    assert load_public_jwk_from_env({}) is None
