"""
Vault Router routes — all HTTP endpoints.

Infrastructure (B1):  GET /health, GET /registry-status
Fan-out reads (B3):   POST /search, /resolve-context, /list-by-scope,
                      /check-duplicates, /suggest-metadata
Routed reads (B4):    POST /get-page, /get-related, /schema
Routed writes (B4):   POST /write-page, /validate-page, /registry/add
Graph path:           POST /graph/edges, /graph/edges/get, /graph/edges/delete,
                      /graph/traverse, /graph/export, /graph/import
Admin path:           POST /reindex
"""

import logging
import asyncio
from typing import Any, Annotated, Optional

from fastapi import APIRouter, Request, Depends, HTTPException

from .client import VaultClient
from .settings import VaultRouterSettings
from .uuid_registry import CrossVaultUUIDRegistry
from .registry import VaultRegistry
from .fan_out import fan_out

logger = logging.getLogger(__name__)

router = APIRouter()

# Request headers forwarded verbatim to upstream vaults. X-Horus-Principal is the
# short-lived JWT the gateway mints; the upstream vault verifies it before serving
# writes (reads on the reader pool are not principal-gated). Without forwarding it,
# principal-authenticated writes fail closed with 401 at the writer.
_FORWARD_HEADERS = ("x-horus-principal",)


# ── Dependency helpers ────────────────────────────────────────────────────────

def get_settings(request: Request) -> VaultRouterSettings:
    return request.app.state.settings


def get_vault_client(request: Request) -> VaultClient:
    return request.app.state.vault_client


def get_uuid_registry(request: Request) -> CrossVaultUUIDRegistry:
    return request.app.state.uuid_registry


def get_vault_registry(request: Request) -> Optional[VaultRegistry]:
    """The namespace→reader/writer routing table, or None when unconfigured."""
    return getattr(request.app.state, "vault_registry", None)


SettingsDepends = Annotated[VaultRouterSettings, Depends(get_settings)]
ClientDepends = Annotated[VaultClient, Depends(get_vault_client)]
UUIDRegistryDepends = Annotated[CrossVaultUUIDRegistry, Depends(get_uuid_registry)]
RegistryDepends = Annotated[Optional[VaultRegistry], Depends(get_vault_registry)]


# ── Health check ──────────────────────────────────────────────────────────────

@router.get("/health")
async def health(settings: SettingsDepends, vault_client: ClientDepends) -> dict[str, Any]:
    """
    Health check for the router and all upstream vault instances.

    Returns:
      - status: "healthy" if all vaults are reachable, "degraded" if some are down
      - vaults: per-vault health status with latency
    """
    health_tasks = [
        vault_client.health_check(name, url)
        for name, url in settings.vault_endpoints.items()
    ]
    health_results = await asyncio.gather(*health_tasks)

    vault_statuses: dict[str, Any] = {}
    for name, result in zip(settings.vault_endpoints.keys(), health_results):
        vault_statuses[name] = result

    overall = (
        "healthy"
        if all(v["status"] == "healthy" for v in vault_statuses.values())
        else "degraded"
    )

    return {
        "status": overall,
        "router": "healthy",
        "vaults": vault_statuses,
    }


# ── Registry status ───────────────────────────────────────────────────────────

@router.get("/registry-status")
async def registry_status(
    settings: SettingsDepends,
    uuid_registry: UUIDRegistryDepends,
) -> dict[str, Any]:
    """Show UUID registry status: per-vault page counts and last refresh time."""
    status = uuid_registry.status()
    status["default_vault"] = settings.vault_default
    return status


# ── Vault discovery ─────────────────────────────────────────────────────────

# GET for direct/curl/ops use; POST so the in-process MCP adapters (vault-mcp,
# horus-ui's vendored vault-local-mcp), which forward every tool call as a POST
# to /api/v1/vault/<path>, can reach it too.
@router.api_route("/vaults", methods=["GET", "POST"])
async def list_vaults(
    settings: SettingsDepends,
    uuid_registry: UUIDRegistryDepends,
    registry: RegistryDepends,
) -> dict[str, Any]:
    """Enumerate every vault this control plane serves.

    Backed by the live VaultRegistry when configured (the k8s control plane),
    falling back to the static VAULT_ENDPOINTS map (self-host compose). This is
    the discovery surface any client can call to learn which vaults exist at
    call time — a vault provisioned after a client's connection bundle was
    minted appears here immediately, honoring the "every user sees every vault"
    contract. Reads are not principal-gated, so no per-caller filtering applies.
    """
    if registry is not None and registry.namespaces():
        names = registry.namespaces()
    else:
        names = list(settings.vault_endpoints.keys())

    # Per-vault page counts from the UUID registry status, when available.
    status_vaults = uuid_registry.status().get("vaults", {})

    vaults: list[dict[str, Any]] = []
    for name in names:
        entry: dict[str, Any] = {
            "namespace": name,
            "default": name == settings.vault_default,
        }
        info = status_vaults.get(name)
        if isinstance(info, dict) and "page_count" in info:
            entry["page_count"] = info["page_count"]
        vaults.append(entry)

    # Default vault first, then alphabetical — stable, predictable ordering.
    vaults.sort(key=lambda v: (not v["default"], v["namespace"]))

    return {
        "vaults": vaults,
        "default_vault": settings.vault_default,
        "total": len(vaults),
    }


# ── Fan-out helper ────────────────────────────────────────────────────────────

def _parse_vault_filter(body: dict[str, Any]) -> Optional[list[str]]:
    """Extract optional vault filter from request body."""
    vault = body.get("vault")
    if vault is None:
        return None
    if isinstance(vault, str):
        return [vault]
    if isinstance(vault, list):
        return vault
    return None


def _resolve_vault_for_write(
    body: dict[str, Any],
    uuid_registry: CrossVaultUUIDRegistry,
    settings: VaultRouterSettings,
) -> str:
    """
    Determine which vault to route a write to.

    Priority:
      1. Explicit ?vault=name in body
      2. UUID lookup via registry (page_id field)
      3. Default vault
    """
    if "vault" in body and body["vault"]:
        return str(body["vault"])
    page_id = body.get("page_id") or body.get("id")
    if page_id:
        vault_name = uuid_registry.resolve(str(page_id))
        if vault_name:
            return vault_name
    return settings.vault_default


def _forward_headers(request: Request) -> dict[str, str]:
    """Extract the allow-listed headers to propagate to upstream vaults."""
    out: dict[str, str] = {}
    for name in _FORWARD_HEADERS:
        value = request.headers.get(name)
        if value:
            out[name] = value
    return out


def _vault_context_headers(
    vault_name: str,
    registry: Optional[VaultRegistry],
) -> dict[str, str]:
    """Build X-Vault-* headers so downstream vault services select the
    correct per-vault Typesense collection and Neo4j scope."""
    hdrs: dict[str, str] = {"x-vault-namespace": vault_name}
    if registry:
        entry = registry.get(vault_name)
        if entry:
            if entry.typesense_collection:
                hdrs["x-vault-collection"] = entry.typesense_collection
            if entry.git_repo:
                hdrs["x-vault-git-repo"] = entry.git_repo
    return hdrs


def _build_per_vault_headers(
    registry: Optional[VaultRegistry],
    endpoints: dict[str, str],
) -> dict[str, dict[str, str]]:
    """Build per-vault X-Vault-* header overrides for fan-out requests."""
    if registry is None:
        return {}
    per_vault: dict[str, dict[str, str]] = {}
    for ns in endpoints:
        # _all_endpoints() keys reader/writer pools as "<ns>#reader"/"<ns>#writer".
        # Strip the suffix so the registry lookup (and the X-Vault-* header values)
        # use the real namespace — otherwise the writer gets no x-vault-collection
        # and indexes per-vault content into the default collection.
        base_ns = ns.split("#", 1)[0]
        per_vault[ns] = _vault_context_headers(base_ns, registry)
    return per_vault


def _read_endpoints(
    settings: VaultRouterSettings, registry: Optional[VaultRegistry]
) -> dict[str, str]:
    """Fan-out read targets. The default vault uses the READER pool. Non-default
    vaults use the WRITER: only it holds the per-vault git clone, and the search/
    list endpoints reconstruct page content from the local filesystem
    (get_all_documents) — stateless readers have no per-vault clone, so their
    doc-cache lookup drops every per-vault hit. Routing per-vault reads to the
    writer keeps content + index on the same pod."""
    if registry is not None and registry.namespaces():
        return {
            ns: (entry.reader_endpoint if ns == settings.vault_default else entry.writer_endpoint)
            for ns in registry.namespaces()
            if (entry := registry.get(ns)) is not None
        }
    return settings.vault_endpoints


def _all_endpoints(
    settings: VaultRouterSettings, registry: Optional[VaultRegistry]
) -> dict[str, str]:
    """Every distinct upstream (reader + writer pools) — used by admin fan-out
    (reindex) and health, where both pools must be reached."""
    if registry is not None and registry.namespaces():
        out: dict[str, str] = {}
        for ns in registry.namespaces():
            entry = registry.get(ns)
            if entry is None:
                continue
            out[f"{ns}#reader"] = entry.reader_endpoint
            if entry.writer_endpoint and entry.writer_endpoint != entry.reader_endpoint:
                out[f"{ns}#writer"] = entry.writer_endpoint
        return out or settings.vault_endpoints
    return settings.vault_endpoints


def _resolve_endpoint(
    body: dict[str, Any],
    *,
    write: bool,
    settings: VaultRouterSettings,
    registry: Optional[VaultRegistry],
    uuid_registry: CrossVaultUUIDRegistry,
) -> tuple[str, Optional[str]]:
    """Resolve (vault_label, base_url) for a routed request, honoring the
    read/write split: when a registry entry exists, reads go to its reader
    endpoint and writes to its writer endpoint. Falls back to the name-based
    VAULT_ENDPOINTS map when no registry entry matches."""
    name = _resolve_vault_for_write(body, uuid_registry, settings)
    if registry is not None:
        endpoint = registry.resolve(name, write=write)
        if endpoint:
            return name, endpoint
    return name, settings.vault_endpoints.get(name)


# ── Fan-out read endpoints (B3) ───────────────────────────────────────────────

@router.post("/search")
async def search(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Fan-out search to all (or filtered) vault instances.

    Merges results by relevance_score, deduplicates by UUID (highest score wins),
    and tags each result with source_vault.
    """
    body = await request.json()
    vault_filter = _parse_vault_filter(body)
    registry = get_vault_registry(request)
    headers = _forward_headers(request)

    read_eps = _read_endpoints(settings, registry)
    results = await fan_out(vault_client, read_eps, "/search", body, vault_filter, headers=headers, per_vault_headers=_build_per_vault_headers(registry, read_eps))

    all_pages: list[dict[str, Any]] = []
    seen_uuids: set[str] = set()

    for vault_name, data in results.items():
        if "error" in data:
            continue
        for page in data.get("results", []):
            page_id = page.get("id")
            if page_id and page_id in seen_uuids:
                continue
            page["source_vault"] = vault_name
            all_pages.append(page)
            if page_id:
                seen_uuids.add(page_id)

    all_pages.sort(key=lambda p: p.get("relevance_score", 0.0), reverse=True)

    limit = body.get("limit", 10)
    return {"results": all_pages[:limit], "total": len(all_pages)}


@router.post("/resolve-context")
async def resolve_context(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Fan-out resolve-context to all (or filtered) vault instances.

    Picks the best entry_point by relevance_score and merges all operational_pages.
    """
    body = await request.json()
    vault_filter = _parse_vault_filter(body)
    registry = get_vault_registry(request)
    headers = _forward_headers(request)

    read_eps = _read_endpoints(settings, registry)
    results = await fan_out(vault_client, read_eps, "/resolve-context", body, vault_filter, headers=headers, per_vault_headers=_build_per_vault_headers(registry, read_eps))

    best_entry: Optional[dict[str, Any]] = None
    best_score: float = -1.0
    best_match_type: str = "none"
    all_operational: list[dict[str, Any]] = []
    merged_scope: dict[str, Any] = {}

    for vault_name, data in results.items():
        if "error" in data:
            continue
        entry = data.get("entry_point")
        if entry:
            score = entry.get("relevance_score") or 0.0
            if score > best_score:
                best_score = score
                best_entry = {**entry, "source_vault": vault_name}
                best_match_type = data.get("match_type", "none")
        for page in data.get("operational_pages", []):
            all_operational.append({**page, "source_vault": vault_name})
        if data.get("scope"):
            merged_scope.update(data["scope"])
        # If no entry_point but pages found, still capture match_type
        if not entry and data.get("operational_pages") and best_match_type == "none":
            best_match_type = data.get("match_type", "none")

    return {
        "entry_point": best_entry,
        "operational_pages": all_operational,
        "scope": merged_scope,
        "match_type": best_match_type,
    }


@router.post("/list-by-scope")
async def list_by_scope(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Fan-out list-by-scope to all (or filtered) vault instances.

    Merges all results, deduplicates by UUID, and applies router-level pagination.
    """
    body = await request.json()
    vault_filter = _parse_vault_filter(body)
    registry = get_vault_registry(request)
    headers = _forward_headers(request)

    read_eps = _read_endpoints(settings, registry)
    results = await fan_out(vault_client, read_eps, "/list-by-scope", body, vault_filter, headers=headers, per_vault_headers=_build_per_vault_headers(registry, read_eps))

    seen_uuids: set[str] = set()
    all_pages: list[dict[str, Any]] = []
    errors: dict[str, Any] = {}

    for vault_name, data in results.items():
        if isinstance(data, dict) and "error" in data:
            # Do NOT silently drop a failed sub-request: a writer 422/5xx used to
            # be swallowed here, turning a failure into an empty 200. Record it so
            # callers can distinguish "empty" from "failed".
            errors[vault_name] = {
                "error": data.get("error"),
                "status": data.get("status", "failed"),
            }
            continue
        # Vault returns {"pages": [...]}, not {"results": [...]}
        for page in data.get("pages", data.get("results", [])):
            page_id = page.get("id")
            if page_id and page_id in seen_uuids:
                continue
            page["source_vault"] = vault_name
            all_pages.append(page)
            if page_id:
                seen_uuids.add(page_id)

    # If every targeted vault failed, surface a clear non-2xx instead of a
    # misleading empty 200. Partial failures still return 200 with an `errors`
    # map alongside the pages that did come back.
    if results and errors and len(errors) == len(results):
        raise HTTPException(
            status_code=502,
            detail={"message": "All vault sub-requests failed", "errors": errors},
        )

    limit = body.get("limit", 20)
    offset = body.get("offset", 0)
    paginated = all_pages[offset: offset + limit]
    response: dict[str, Any] = {"pages": paginated, "total": len(all_pages)}
    if errors:
        response["errors"] = errors
    return response


@router.post("/check-duplicates")
async def check_duplicates(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Fan-out check-duplicates to all (or filtered) vault instances.

    Merges all matches from all vaults and tags each with source_vault.
    If any vault recommends "merge", that recommendation is surfaced.
    """
    body = await request.json()
    vault_filter = _parse_vault_filter(body)
    registry = get_vault_registry(request)
    headers = _forward_headers(request)

    read_eps = _read_endpoints(settings, registry)
    results = await fan_out(vault_client, read_eps, "/check-duplicates", body, vault_filter, headers=headers, per_vault_headers=_build_per_vault_headers(registry, read_eps))

    all_matches: list[dict[str, Any]] = []
    recommendation = "create"

    for vault_name, data in results.items():
        if "error" in data:
            continue
        for match in data.get("matches", []):
            all_matches.append({**match, "source_vault": vault_name})
        if data.get("recommendation") == "merge":
            recommendation = "merge"

    all_matches.sort(key=lambda m: m.get("similarity", 0.0), reverse=True)

    return {"matches": all_matches, "recommendation": recommendation}


@router.post("/suggest-metadata")
async def suggest_metadata(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Fan-out suggest-metadata to all (or filtered) vault instances.

    Merges suggestions — higher confidence wins for the same field.
    Each winning suggestion is tagged with source_vault.
    """
    body = await request.json()
    vault_filter = _parse_vault_filter(body)
    registry = get_vault_registry(request)
    headers = _forward_headers(request)

    read_eps = _read_endpoints(settings, registry)
    results = await fan_out(vault_client, read_eps, "/suggest-metadata", body, vault_filter, headers=headers, per_vault_headers=_build_per_vault_headers(registry, read_eps))

    merged: dict[str, Any] = {}

    for vault_name, data in results.items():
        if "error" in data:
            continue
        for field_name, suggestion in data.items():
            if not isinstance(suggestion, dict):
                continue
            current_confidence = merged.get(field_name, {}).get("confidence", -1.0)
            new_confidence = suggestion.get("confidence", 0.0)
            if new_confidence > current_confidence:
                merged[field_name] = {**suggestion, "source_vault": vault_name}

    return merged


# ── Routed read endpoints (B4) ────────────────────────────────────────────────

@router.post("/get-page")
async def get_page(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
    uuid_registry: UUIDRegistryDepends,
) -> dict[str, Any]:
    """
    Route GET /get-page to the vault that owns the requested page UUID.

    If vault= is specified explicitly, route there. Otherwise look up the UUID
    in the registry. Falls back to default vault if UUID is not found.
    """
    body = await request.json()
    registry = get_vault_registry(request)
    # Filesystem-read op: non-default vaults live only on the writer's per-vault
    # clone (readers are stateless), so route those to the writer. Default vault
    # stays on the reader pool.
    _name = _resolve_vault_for_write(body, uuid_registry, settings)
    _use_writer = bool(registry and _name != settings.vault_default and registry.get(_name))
    vault_name, base_url = _resolve_endpoint(
        body, write=_use_writer, settings=settings, registry=registry, uuid_registry=uuid_registry
    )
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    # Did we actually resolve the owning vault, or just fall back to the default?
    # The fallback happens when the caller pinned no vault AND the UUID registry
    # could not map the page id (e.g. a non-default page whose UUID the registry
    # hasn't indexed). In that case a 404 from the default vault is inconclusive,
    # so we fan out to the remaining vaults rather than reporting "not found".
    _page_id = body.get("page_id") or body.get("id")
    _resolved = uuid_registry.resolve(str(_page_id)) if _page_id else None
    uncertain = not body.get("vault") and _resolved is None

    base_fwd = _forward_headers(request)
    fwd = {**base_fwd, **_vault_context_headers(vault_name, registry)}
    url = f"{base_url.rstrip('/')}/get-page"
    try:
        response = await vault_client.post(url, json=body, headers=fwd)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")

    if response.status_code == 404 and uncertain:
        # Owning vault unknown and default doesn't have it — search the rest.
        read_eps = _read_endpoints(settings, registry)
        others = {n: u for n, u in read_eps.items() if n != vault_name}
        if others:
            results = await fan_out(
                vault_client, others, "/get-page", body,
                headers=base_fwd,
                per_vault_headers=_build_per_vault_headers(registry, others),
            )
            for cand_name, data in results.items():
                if isinstance(data, dict) and "error" not in data and data.get("id"):
                    data["source_vault"] = cand_name
                    return data

    if response.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Page '{_page_id}' not found")
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream vault '{vault_name}' error: HTTP {response.status_code}",
        )

    data = response.json()
    data["source_vault"] = vault_name
    return data


@router.post("/get-related")
async def get_related(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
    uuid_registry: UUIDRegistryDepends,
) -> dict[str, Any]:
    """
    Route /get-related to the vault that owns the source page UUID.

    Cross-vault references are not supported in v1 — related pages resolve
    within the same vault only.
    """
    body = await request.json()
    registry = get_vault_registry(request)
    # Filesystem-read op: non-default vaults live only on the writer's per-vault
    # clone (readers are stateless), so route those to the writer.
    _name = _resolve_vault_for_write(body, uuid_registry, settings)
    _use_writer = bool(registry and _name != settings.vault_default and registry.get(_name))
    vault_name, base_url = _resolve_endpoint(
        body, write=_use_writer, settings=settings, registry=registry, uuid_registry=uuid_registry
    )
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    url = f"{base_url.rstrip('/')}/get-related"
    fwd = _forward_headers(request)
    fwd.update(_vault_context_headers(vault_name, registry))
    try:
        response = await vault_client.post(url, json=body, headers=fwd)
        response.raise_for_status()
        data = response.json()
        data["source_vault"] = vault_name
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")


@router.post("/schema")
async def schema(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Route /schema to the default vault (schema is assumed uniform across vaults).

    If vault= is specified in the body, route to that vault instead.
    Proxies to upstream as GET /schema (knowledge-service uses GET for schema).
    """
    body = await request.json()
    registry = get_vault_registry(request)
    vault_name, base_url = _resolve_endpoint(
        body, write=False, settings=settings, registry=registry, uuid_registry=request.app.state.uuid_registry
    )
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    url = f"{base_url.rstrip('/')}/schema"
    fwd = _forward_headers(request)
    fwd.update(_vault_context_headers(vault_name, registry))
    try:
        response = await vault_client.get(url, headers=fwd)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")


# ── Routed write endpoints (B4) ───────────────────────────────────────────────

@router.post("/write-page")
async def write_page(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
    uuid_registry: UUIDRegistryDepends,
) -> dict[str, Any]:
    """
    Route /write-page to the vault that owns the page (by UUID) or to default.

    After a successful write, the UUID registry will pick up the new page
    on its next refresh cycle (or immediately on a create, via the default vault).
    """
    body = await request.json()
    registry = get_vault_registry(request)
    vault_name, base_url = _resolve_endpoint(
        body, write=True, settings=settings, registry=registry, uuid_registry=uuid_registry
    )
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    url = f"{base_url.rstrip('/')}/write-page"
    fwd = _forward_headers(request)
    fwd.update(_vault_context_headers(vault_name, registry))
    try:
        response = await vault_client.post(url, json=body, headers=fwd)
        response.raise_for_status()
        data = response.json()
        data["source_vault"] = vault_name
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")


@router.post("/validate-page")
async def validate_page(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
    uuid_registry: UUIDRegistryDepends,
) -> dict[str, Any]:
    """
    Route /validate-page to the owning vault (by UUID) or to default.
    """
    body = await request.json()
    registry = get_vault_registry(request)
    vault_name, base_url = _resolve_endpoint(
        body, write=True, settings=settings, registry=registry, uuid_registry=uuid_registry
    )
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    url = f"{base_url.rstrip('/')}/validate-page"
    fwd = _forward_headers(request)
    fwd.update(_vault_context_headers(vault_name, registry))
    try:
        response = await vault_client.post(url, json=body, headers=fwd)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")


@router.post("/registry/add")
async def registry_add(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
    uuid_registry: UUIDRegistryDepends,
) -> dict[str, Any]:
    """
    Route /registry/add to the vault that owns the page (by UUID) or to default.

    Used by vault-mcp after a successful write to register the page in the
    vault's internal registry.
    """
    body = await request.json()
    registry = get_vault_registry(request)
    vault_name, base_url = _resolve_endpoint(
        body, write=True, settings=settings, registry=registry, uuid_registry=uuid_registry
    )
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    url = f"{base_url.rstrip('/')}/registry/add"
    fwd = _forward_headers(request)
    fwd.update(_vault_context_headers(vault_name, registry))
    try:
        response = await vault_client.post(url, json=body, headers=fwd)
        response.raise_for_status()
        data = response.json()
        data["source_vault"] = vault_name
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")


# ── Graph Path endpoints ──────────────────────────────────────────────────────
# Graph operations are backed by a single Neo4j instance shared across vaults.
# All graph routes forward to the default vault (or an explicit vault= in body).


def _resolve_vault_for_graph(body: dict[str, Any], settings: "VaultRouterSettings") -> str:
    """Determine which vault to route a graph request to.

    Defaults to the configured default vault. An explicit ``vault`` key in the
    request body overrides this.
    """
    vault = body.get("vault")
    if vault and isinstance(vault, str):
        return vault
    return settings.vault_default


async def _proxy_graph(
    path: str,
    request: Request,
    settings: "VaultRouterSettings",
    vault_client: "VaultClient",
    *,
    write: bool,
) -> dict[str, Any]:
    """Forward a graph request to the appropriate upstream vault.

    Mutating graph operations route to the writer pool; read-only traversals to
    the reader pool. X-Horus-Principal is forwarded so the upstream can verify it.
    """
    body = await request.json()
    registry = get_vault_registry(request)
    vault_name = _resolve_vault_for_graph(body, settings)
    base_url = None
    if registry is not None:
        base_url = registry.resolve(vault_name, write=write)
    if not base_url:
        base_url = settings.vault_endpoints.get(vault_name)
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Vault '{vault_name}' not configured")

    url = f"{base_url.rstrip('/')}{path}"
    fwd = _forward_headers(request)
    fwd.update(_vault_context_headers(vault_name, registry))
    try:
        response = await vault_client.post(url, json=body, headers=fwd)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream vault '{vault_name}' error: {e}")


@router.post("/graph/edges")
async def graph_create_edge(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """Create a directed edge between two knowledge pages in Neo4j."""
    return await _proxy_graph("/graph/edges", request, settings, vault_client, write=True)


@router.post("/graph/edges/get")
async def graph_get_edges(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """Get all edges for a knowledge page, optionally filtered by edge type."""
    return await _proxy_graph("/graph/edges/get", request, settings, vault_client, write=False)


@router.post("/graph/edges/delete")
async def graph_delete_edge(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """Delete a specific directed edge between two knowledge pages."""
    return await _proxy_graph("/graph/edges/delete", request, settings, vault_client, write=True)


@router.post("/graph/traverse")
async def graph_traverse(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """Traverse the knowledge graph from a starting page up to max_depth hops."""
    return await _proxy_graph("/graph/traverse", request, settings, vault_client, write=False)


@router.post("/graph/export")
async def graph_export(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """Export all Neo4j graph nodes and edges to the knowledge-base repo."""
    return await _proxy_graph("/graph/export", request, settings, vault_client, write=True)


@router.post("/graph/import")
async def graph_import(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """Import/seed Neo4j from the graph export file in the knowledge-base repo."""
    return await _proxy_graph("/graph/import", request, settings, vault_client, write=True)


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.post("/reindex")
async def reindex(
    request: Request,
    settings: SettingsDepends,
    vault_client: ClientDepends,
) -> dict[str, Any]:
    """
    Trigger a full re-index on all (or filtered) vault instances.

    Fan-out to every configured vault (or only those matching an optional
    ``vault`` filter in the request body). Merges ``indexed``, ``errors``,
    and ``duration_ms`` totals from all responses.

    Returns 200 with merged summary JSON:
      ``{ "indexed": int, "errors": int, "duration_ms": float, "vaults": {...} }``
    """
    # Accept an empty body (curl -X POST with no JSON payload)
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        body = {}

    vault_filter = _parse_vault_filter(body)
    registry = get_vault_registry(request)
    headers = _forward_headers(request)
    all_eps = _all_endpoints(settings, registry)
    results = await fan_out(vault_client, all_eps, "/reindex", body, vault_filter, headers=headers, per_vault_headers=_build_per_vault_headers(registry, all_eps))

    total_indexed = 0
    total_errors = 0
    total_duration_ms = 0.0
    per_vault: dict[str, Any] = {}

    for vault_name, data in results.items():
        if "error" in data:
            per_vault[vault_name] = data
            continue
        vault_indexed = data.get("indexed", 0)
        vault_errors = data.get("errors", 0)
        vault_duration_ms = data.get("duration_ms", 0.0)
        total_indexed += vault_indexed
        total_errors += vault_errors
        total_duration_ms += vault_duration_ms
        per_vault[vault_name] = {
            "indexed": vault_indexed,
            "errors": vault_errors,
            "duration_ms": vault_duration_ms,
        }

    logger.info(
        "Router reindex complete: indexed=%d errors=%d duration_ms=%.1f vaults=%s",
        total_indexed, total_errors, total_duration_ms, list(per_vault.keys()),
    )

    return {
        "indexed": total_indexed,
        "errors": total_errors,
        "duration_ms": total_duration_ms,
        "vaults": per_vault,
    }
