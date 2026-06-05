"""Tests for read/write split routing + X-Horus-Principal forwarding.

The vault-router must:
  - route reads to the reader pool and writes to the writer pool (AC4), and
  - forward the X-Horus-Principal header to upstreams (without it, principal-
    authenticated writes fail closed with 401 at the writer).

These exercise the route handlers with a recording fake VaultClient — no network.
"""

from typing import Any, Optional

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routes import router
from src.registry import VaultRegistry, parse_registry
from src.settings import VaultRouterSettings

PRINCIPAL = "eyJ.principal.jwt"

REGISTRY_YAML = """
vaults:
  default:
    reader_endpoint: http://reader:8000
    writer_endpoint: http://writer:8000
"""


class FakeResponse:
    def __init__(self, payload: dict[str, Any]):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return dict(self._payload)


class RecordingClient:
    """Captures every upstream call (url, json, headers)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def post(self, url: str, json: Any, headers: Optional[dict] = None) -> FakeResponse:
        self.calls.append({"method": "POST", "url": url, "json": json, "headers": headers or {}})
        return FakeResponse({"results": [], "ok": True})

    async def get(self, url: str, headers: Optional[dict] = None) -> FakeResponse:
        self.calls.append({"method": "GET", "url": url, "headers": headers or {}})
        return FakeResponse({"types": []})


class FakeUUIDRegistry:
    def resolve(self, page_id: str) -> Optional[str]:
        return None

    def status(self) -> dict[str, Any]:
        return {}


def _build(*, with_registry: bool) -> tuple[TestClient, RecordingClient]:
    app = FastAPI()
    app.include_router(router)
    client = RecordingClient()
    app.state.settings = VaultRouterSettings(
        vault_endpoints={"default": "http://name-based:8000"}, vault_default="default"
    )
    app.state.vault_client = client
    app.state.uuid_registry = FakeUUIDRegistry()
    if with_registry:
        reg = VaultRegistry("/does/not/exist")
        reg._entries = parse_registry(REGISTRY_YAML)
        app.state.vault_registry = reg
    return TestClient(app), client


def _hdr() -> dict[str, str]:
    return {"x-horus-principal": PRINCIPAL}


def test_read_routes_to_reader_pool_and_forwards_principal():
    tc, client = _build(with_registry=True)
    resp = tc.post("/get-page", json={"page_id": "p1"}, headers=_hdr())
    assert resp.status_code == 200
    call = client.calls[-1]
    assert call["url"] == "http://reader:8000/get-page"
    assert call["headers"].get("x-horus-principal") == PRINCIPAL


def test_write_routes_to_writer_pool_and_forwards_principal():
    tc, client = _build(with_registry=True)
    resp = tc.post("/write-page", json={"path": "x.md", "content": "hi"}, headers=_hdr())
    assert resp.status_code == 200
    call = client.calls[-1]
    assert call["url"] == "http://writer:8000/write-page"
    assert call["headers"].get("x-horus-principal") == PRINCIPAL


def test_fanout_search_targets_reader_pool_only():
    tc, client = _build(with_registry=True)
    resp = tc.post("/search", json={"query": "q"}, headers=_hdr())
    assert resp.status_code == 200
    urls = [c["url"] for c in client.calls]
    assert urls == ["http://reader:8000/search"]
    assert client.calls[-1]["headers"].get("x-horus-principal") == PRINCIPAL


def test_graph_create_is_write_graph_get_is_read():
    tc, client = _build(with_registry=True)
    tc.post("/graph/edges", json={"from": "a", "to": "b"}, headers=_hdr())
    assert client.calls[-1]["url"] == "http://writer:8000/graph/edges"
    tc.post("/graph/traverse", json={"start": "a"}, headers=_hdr())
    assert client.calls[-1]["url"] == "http://reader:8000/graph/traverse"


def test_fallback_to_name_based_when_no_registry():
    tc, client = _build(with_registry=False)
    tc.post("/write-page", json={"path": "x.md"}, headers=_hdr())
    call = client.calls[-1]
    assert call["url"] == "http://name-based:8000/write-page"
    # principal is still forwarded in the fallback path
    assert call["headers"].get("x-horus-principal") == PRINCIPAL


# ---------------------------------------------------------------------------
# Regression: a failed fan-out sub-request must NOT be swallowed into an empty
# 200. Previously a writer 422 (e.g. limit > 100) was caught and the vault
# dropped, so the gateway returned {"pages": [], "total": 0} and callers could
# not tell "empty" from "failed".
# ---------------------------------------------------------------------------

TWO_VAULT_REGISTRY_YAML = """
vaults:
  default:
    reader_endpoint: http://reader:8000
    writer_endpoint: http://writer:8000
  other:
    reader_endpoint: http://reader2:8000
    writer_endpoint: http://writer2:8000
"""


class FailingClient:
    """Every upstream POST raises (simulates a writer 422/5xx)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def post(self, url: str, json: Any, headers: Optional[dict] = None) -> FakeResponse:
        self.calls.append({"url": url, "json": json})
        raise RuntimeError("Client error '422 Unprocessable Entity'")

    async def get(self, url: str, headers: Optional[dict] = None) -> FakeResponse:
        raise RuntimeError("Client error '422 Unprocessable Entity'")


class PartialClient:
    """Returns pages for the primary vault, fails for the 'other' vault.

    Non-default vaults are fanned out to their WRITER endpoint (see
    routes._read_endpoints), so the failing target is writer2, not reader2.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def post(self, url: str, json: Any, headers: Optional[dict] = None) -> FakeResponse:
        self.calls.append({"url": url, "json": json})
        if "writer2" in url or "reader2" in url:
            raise RuntimeError("Client error '422 Unprocessable Entity'")
        return FakeResponse({"pages": [{"id": "u1", "title": "Page 1"}]})

    async def get(self, url: str, headers: Optional[dict] = None) -> FakeResponse:
        return FakeResponse({})


def _build_with_client(client: Any, registry_yaml: str) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.settings = VaultRouterSettings(
        vault_endpoints={"default": "http://name-based:8000"}, vault_default="default"
    )
    app.state.vault_client = client
    app.state.uuid_registry = FakeUUIDRegistry()
    reg = VaultRegistry("/does/not/exist")
    reg._entries = parse_registry(registry_yaml)
    app.state.vault_registry = reg
    return TestClient(app)


def test_list_by_scope_all_vaults_fail_returns_non_2xx_not_empty_200():
    tc = _build_with_client(FailingClient(), REGISTRY_YAML)
    resp = tc.post("/list-by-scope", json={"scope": {}, "limit": 200}, headers=_hdr())
    # Must surface the failure, not masquerade as a successful empty result.
    assert resp.status_code == 502, resp.text
    detail = resp.json()["detail"]
    assert "errors" in detail
    assert "default" in detail["errors"]


def test_list_by_scope_partial_failure_surfaces_errors_with_pages():
    tc = _build_with_client(PartialClient(), TWO_VAULT_REGISTRY_YAML)
    resp = tc.post("/list-by-scope", json={"scope": {}, "limit": 200}, headers=_hdr())
    # One vault returned pages → still 200, but the failed vault is observable.
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["pages"]) == 1
    assert body["pages"][0]["id"] == "u1"
    assert "errors" in body
    assert "other" in body["errors"]
