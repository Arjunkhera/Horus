"""Tests for the CrossVaultUUIDRegistry build across all provisioned vaults.

Bug c14f92d7: list_vaults reported page_count: undefined for non-default vaults
because the UUID-registry refresh only iterated VAULT_ENDPOINTS (default only).
The fix drives build() from the live registry's count-source endpoints (default →
reader, non-default → writer) and threads per-vault X-Vault-* headers so the writer
counts against the correct per-vault clone/collection.

These exercise build()/_fetch_vault with a fake client — no network.
"""

import asyncio
from typing import Any, Optional

from src.uuid_registry import CrossVaultUUIDRegistry


class FakeResponse:
    def __init__(self, payload: dict[str, Any]):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return dict(self._payload)


class CountingClient:
    """Returns pages keyed off the X-Vault-Namespace header, with real pagination.

    Modeling the writer: it only serves a vault's pages when told which namespace
    to select. A call with no/unknown namespace header gets an empty set — exactly
    the failure mode the fix avoids.
    """

    def __init__(self, pages_by_namespace: dict[str, list[str]]) -> None:
        self.pages_by_namespace = pages_by_namespace
        self.calls: list[dict[str, Any]] = []

    async def post(self, url: str, json: Any, headers: Optional[dict] = None) -> FakeResponse:
        self.calls.append({"url": url, "json": json, "headers": headers or {}})
        ns = (headers or {}).get("x-vault-namespace")
        ids = self.pages_by_namespace.get(ns, [])
        offset = json.get("offset", 0)
        limit = json.get("limit", 100)
        window = ids[offset: offset + limit]
        return FakeResponse({"pages": [{"id": pid} for pid in window], "total": len(ids)})


def test_build_counts_every_provisioned_vault_via_per_vault_headers():
    reg = CrossVaultUUIDRegistry()
    client = CountingClient({
        "default": ["d1"],
        "vault-office": [f"o{i}" for i in range(38)],
    })
    endpoints = {
        "default": "http://reader:8000",
        "vault-office": "http://writer:8000",
    }
    per_vault_headers = {
        "default": {"x-vault-namespace": "default"},
        "vault-office": {"x-vault-namespace": "vault-office", "x-vault-collection": "vault_office"},
    }

    asyncio.run(reg.build(endpoints, client, per_vault_headers=per_vault_headers))

    status_vaults = reg.status()["vaults"]
    # Both vaults have a numeric page_count — the bug left vault-office absent.
    assert status_vaults["default"]["page_count"] == 1
    assert status_vaults["vault-office"]["page_count"] == 38
    # The non-default vault was counted from the writer endpoint with its namespace header.
    office_calls = [c for c in client.calls if c["headers"].get("x-vault-namespace") == "vault-office"]
    assert office_calls and office_calls[0]["url"] == "http://writer:8000/list-by-scope"


def test_build_paginates_at_limit_100_without_exceeding_cap():
    # 150 pages forces a second page; limit must never exceed 100 (writer 422s above).
    reg = CrossVaultUUIDRegistry()
    client = CountingClient({"vault-office": [f"p{i}" for i in range(150)]})
    asyncio.run(reg.build(
        {"vault-office": "http://writer:8000"},
        client,
        per_vault_headers={"vault-office": {"x-vault-namespace": "vault-office"}},
    ))

    assert reg.status()["vaults"]["vault-office"]["page_count"] == 150
    assert all(c["json"]["limit"] <= 100 for c in client.calls)
    assert len(client.calls) == 2  # 100 + 50


def test_build_without_headers_falls_back_to_no_context():
    # Static self-host path: no registry, no per-vault headers — call still works,
    # headers passed as None (default vault served by its own endpoint).
    reg = CrossVaultUUIDRegistry()
    client = CountingClient({None: ["d1", "d2"]})
    asyncio.run(reg.build({"default": "http://vault:8000"}, client))

    assert reg.status()["vaults"]["default"]["page_count"] == 2
    assert client.calls[0]["headers"] == {}
