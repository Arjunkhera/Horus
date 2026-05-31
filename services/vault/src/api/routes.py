"""
REST API routes for Vault Knowledge Service.

Read path (5 operations):
1. POST /resolve-context - Resolve operational pages for a repo
2. POST /search - Full-text + semantic search with progressive disclosure
3. POST /get-page - Retrieve full page by ID
4. POST /get-related - Follow links from a page
5. POST /list-by-scope - Browse/filter pages by scope

Write path (5 operations):
6. POST /validate-page - Validate page content against schema + registries
7. POST /suggest-metadata - Suggest frontmatter values from content analysis
8. POST /check-duplicates - Score content similarity against existing KB pages
9. GET  /schema - Return full schema definition + registries
10. POST /registry/add - Add a new entry to a registry

Graph path (4 operations):
11. POST /graph/edges - Create an edge between two pages
12. POST /graph/edges/get - Get all edges for a page
13. POST /graph/edges/delete - Delete an edge between two pages
14. POST /graph/traverse - Traverse graph from a starting page

Admin path (1 operation):
15. POST /reindex - Trigger a full re-index of all collections
"""

import asyncio
import logging
from fastapi import APIRouter, Depends, Request
from typing import Annotated, Any, Optional

from ..config.settings import VaultSettings
from ..layer1.interface import SearchStore
from ..layer2.frontmatter import parse_page, to_page_summary, to_page_full
from ..layer2.scope import resolve_scope, collect_operational_pages
from ..layer2.graph_resolver import resolve_context_from_graph, resolve_context_fallback
from ..layer2.mode_filter import (
    filter_by_mode,
    filter_by_type,
    filter_by_scope,
    filter_by_tags,
    to_summaries
)
from ..layer2.link_navigator import get_related_pages
from ..layer2.schema import SchemaLoader, PageValidator, RegistryEntry
from ..layer2.suggester import MetadataSuggester
from ..layer2.dedup import DuplicateChecker
from ..layer2.git_writer import GitWriter
from ..layer2.graph_export import export_graph, import_graph, commit_graph_export
from ..layer2.vault_repo_resolver import VaultRepoResolver
from ..errors import not_found, parse_error, schema_not_loaded, internal_error, registry_not_found, duplicate_entry, validation_error, VaultError, ErrorCode
from .graph_models import (
    CreateEdgeRequest,
    EdgeResponse,
    GetEdgesRequest,
    GetEdgesResponse,
    DeleteEdgeRequest,
    TraverseGraphRequest,
    TraverseGraphResponse,
)
from .models import (
    ResolveContextRequest,
    ResolveContextResponse,
    SearchRequest,
    SearchResponse,
    GetPageRequest,
    PageFull,
    PageSummary,
    GetRelatedRequest,
    GetRelatedResponse,
    ListByScopeRequest,
    ListByScopeResponse,
    ValidatePageRequest,
    ValidatePageResponse,
    ValidationErrorModel,
    ValidationWarningModel,
    SuggestMetadataRequest,
    SuggestMetadataResponse,
    CheckDuplicatesRequest,
    CheckDuplicatesResponse,
    DuplicateMatchModel,
    SchemaResponse,
    RegistryAddRequest,
    RegistryAddResponse,
    RegistryEntryModel,
    WritePageRequest,
    WritePageResponse,
    GraphExportResponse,
    GraphImportResponse,
)


import re

# UUID v4 pattern for detecting UUID-based identifiers
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)

# Create router
router = APIRouter()


def _resolve_id(page_id: str, registry) -> str:
    """
    Resolve a page identifier to a filesystem path (``pages/<uuid>.md``).

    If *page_id* looks like a UUID and a registry is available, resolve it
    to the corresponding flat path.  Otherwise return *page_id* unchanged
    (assumed to already be a flat/legacy path).
    """
    if registry and _UUID_RE.match(page_id):
        resolved = registry.resolve(page_id)
        if resolved:
            return resolved
    return page_id


def _resolve_id_to_uuid(page_id: str, registry) -> str:
    """
    Resolve a page identifier to its bare UUID (for graph/Neo4j calls).

    If *page_id* is already a UUID, return it as-is.
    If it is a file path, look it up in the registry to get the UUID.
    Falls back to *page_id* unchanged when no UUID can be found.
    """
    if _UUID_RE.match(page_id):
        return page_id
    if registry:
        uuid = registry.lookup(page_id)
        if uuid:
            return uuid
    return page_id


# Dependency to get SearchStore from app state
# This will be set up in main.py during app startup
def get_store() -> SearchStore:
    """
    Dependency injection for SearchStore.

    This is a placeholder that will be replaced with actual app.state.store
    via dependency_overrides in main.py.
    """
    raise NotImplementedError("SearchStore dependency not configured")


StoreDepends = Annotated[SearchStore, Depends(get_store)]

logger = logging.getLogger(__name__)


def get_graph() -> Any:
    """
    Dependency injection for Neo4j GraphClient.

    Returns None by default (graph unavailable). main.py overrides this
    via dependency_overrides when the graph client is available.
    """
    return None


GraphDepends = Annotated[Any, Depends(get_graph)]


def get_schema_loader() -> SchemaLoader:
    """
    Dependency injection for SchemaLoader.

    Placeholder replaced via dependency_overrides in main.py.
    """
    raise NotImplementedError("SchemaLoader dependency not configured")


SchemaLoaderDepends = Annotated[SchemaLoader, Depends(get_schema_loader)]


def get_settings() -> VaultSettings:
    """
    Dependency injection for VaultSettings.

    Placeholder replaced via dependency_overrides in main.py.
    """
    raise NotImplementedError("Settings dependency not configured")


SettingsDepends = Annotated[VaultSettings, Depends(get_settings)]


def get_uuid_registry():
    """
    Dependency injection for UUIDRegistry.

    Placeholder replaced via dependency_overrides in main.py.
    Returns None if registry is not configured.
    """
    return None


UUIDRegistryDepends = Annotated[Optional[Any], Depends(get_uuid_registry)]


def get_graph() -> Optional[Any]:
    """
    Dependency injection for the Neo4j graph client.

    Placeholder replaced via dependency_overrides in main.py when Neo4j is
    available. Returns None if the graph client is not configured, allowing
    routes to return 503 gracefully.
    """
    return None


GraphDepends = Annotated[Optional[Any], Depends(get_graph)]


def get_vault_namespace(request: Request) -> str:
    """Extract vault namespace from X-Vault-Namespace header (default: "default")."""
    return request.headers.get("x-vault-namespace", "default")


VaultNamespaceDepends = Annotated[str, Depends(get_vault_namespace)]


def get_vault_git_repo(request: Request) -> Optional[str]:
    """Extract per-vault GitHub repo slug from X-Vault-Git-Repo header."""
    return request.headers.get("x-vault-git-repo")


VaultGitRepoDepends = Annotated[Optional[str], Depends(get_vault_git_repo)]


def get_vault_repo_resolver() -> Optional[VaultRepoResolver]:
    """Dependency injection for VaultRepoResolver (writer-only).

    Placeholder replaced via dependency_overrides in main.py on the writer.
    Returns None on readers (they never write to git).
    """
    return None


RepoResolverDepends = Annotated[Optional[VaultRepoResolver], Depends(get_vault_repo_resolver)]


# ============================================================================
# Synchronous handler implementations.
# Each is called via asyncio.to_thread() from the async route handler so that
# blocking calls inside the search engine do not starve the
# uvicorn event loop.
# ============================================================================

def _find_repo_profile(repo: str, store: SearchStore, doc_cache: dict) -> "PageSummary | None":
    """
    Locate the repo-profile entry point for `repo`.

    Strategy:
    1. If the store is a TypesenseSearchEngine, use a deterministic filter query
       (scope_repo:={repo} && source_type:=repo-profile && source:=vault).
    2. Fall back to text search if the filter returns no results or the store
       does not support filter_search.
    """
    from ..layer1.typesense_engine import TypesenseSearchEngine

    # --- Typesense deterministic filter path ---
    if isinstance(store, TypesenseSearchEngine):
        filter_by = (
            f"scope_repo:={repo} && source_type:=repo-profile && source:=vault"
        )
        filter_results = store.filter_search(filter_by, limit=5)
        for result in filter_results:
            content = doc_cache.get(result.file_path)
            if not content:
                continue
            parsed = parse_page(content)
            if parsed.type == "repo-profile" and parsed.scope.get("repo") == repo:
                return to_page_summary(parsed, result.file_path)
        # If filter returned no match, fall through to text search below

    # --- Text search fallback (Typesense keyword search with no exact match) ---
    results = store.search(repo, limit=20)
    for result in results:
        content = doc_cache.get(result.file_path)
        if not content:
            continue
        parsed = parse_page(content)
        if parsed.type == "repo-profile" and parsed.scope.get("repo") == repo:
            return to_page_summary(parsed, result.file_path)

    return None


_SEARCH_THRESHOLD = 0.3   # minimum relevance score for search-mode results
_SEARCH_LIMIT = 5         # max operational pages returned in search mode
_KNOWLEDGE_PAGE_TYPES = {"repo-profile", "guide", "procedure", "concept", "learning", "keystone"}


def _resolve_context_search_sync(request: ResolveContextRequest, store: SearchStore) -> ResolveContextResponse:
    """Search-mode implementation: Typesense text query ranked by relevance."""
    search_results = store.search(request.repo, limit=(_SEARCH_LIMIT + 1) * 3)
    doc_cache = store.get_all_documents()

    entry_point: "PageSummary | None" = None
    op_page_tuples: list[tuple] = []  # (parsed, path, score)

    for result in search_results:
        if result.score < _SEARCH_THRESHOLD:
            continue

        content = doc_cache.get(result.file_path)
        if not content:
            continue

        parsed = parse_page(content)
        if parsed.type not in _KNOWLEDGE_PAGE_TYPES:
            continue

        if parsed.type == "repo-profile" and entry_point is None:
            entry_point = to_page_summary(parsed, result.file_path, result.score)
        elif parsed.type != "repo-profile" and len(op_page_tuples) < _SEARCH_LIMIT:
            op_page_tuples.append((parsed, result.file_path, result.score))

    scores: dict[str, float] = {path: score for _, path, score in op_page_tuples}
    pages_for_summaries = [(parsed, path) for parsed, path, _ in op_page_tuples]

    if request.include_full:
        operational_pages: "list[PageSummary | PageFull]" = [
            to_page_full(parsed, path) for parsed, path in pages_for_summaries
        ]
    else:
        operational_pages = to_summaries(pages_for_summaries, scores)

    scope_dict: dict = {"repo": request.repo}
    if entry_point and entry_point.scope:
        scope_dict = entry_point.scope

    match_type = "search" if (entry_point or operational_pages) else "none"
    return ResolveContextResponse(
        entry_point=entry_point,
        operational_pages=operational_pages,
        scope=scope_dict,
        match_type=match_type,
    )


def _resolve_context_sync(request: ResolveContextRequest, store: SearchStore, graph=None, vault_name: str = "default") -> ResolveContextResponse:
    """Synchronous implementation of resolve-context.

    Dispatches to search mode (default) or exact mode based on request.mode.

    Search mode: Typesense text query on repo name, ranked by relevance.
    Exact mode: scope.repo exact match via graph traversal or legacy fallback.
    """
    if request.mode == "search":
        return _resolve_context_search_sync(request, store)

    # exact mode — scope.repo == repo match (current behavior)
    doc_cache = store.get_all_documents()
    entry_point: PageSummary | None = _find_repo_profile(request.repo, store, doc_cache)
    scope_dict: dict = {}

    if graph is not None:
        # Graph path: resolve context via Neo4j traversal
        try:
            ctx = resolve_context_from_graph(request.repo, graph, vault_name=vault_name)
            scope_dict = {"repo": ctx.repo}
            if ctx.repo_profile_id:
                scope_dict["repo_profile_id"] = ctx.repo_profile_id

            # Load operational pages by ID from store
            operational_pages_tuples: list[tuple] = []
            for page_id in ctx.related_page_ids:
                content = doc_cache.get(page_id) or store.get_document(page_id)
                if content:
                    parsed = parse_page(content)
                    operational_pages_tuples.append((parsed, page_id))

        except Exception:
            logger.warning(
                "Graph-based resolve-context failed for '%s', falling back to legacy",
                request.repo,
                exc_info=True,
            )
            graph = None  # trigger fallback below

    if graph is None:
        # Legacy path-based fallback
        scope, operational_pages_tuples = resolve_context_fallback(
            request.repo, store, doc_cache=doc_cache
        )
        scope_dict = scope.to_dict()

    if request.include_full:
        operational_pages_list: list[PageFull] = [
            to_page_full(page, path)
            for page, path in operational_pages_tuples
        ]
        operational_pages: list[PageSummary | PageFull] = operational_pages_list  # type: ignore[assignment]
    else:
        operational_pages = to_summaries(operational_pages_tuples)

    match_type = "exact" if (entry_point or operational_pages) else "none"
    return ResolveContextResponse(
        entry_point=entry_point,
        operational_pages=operational_pages,
        scope=scope_dict,
        match_type=match_type,
    )


@router.post("/resolve-context", response_model=ResolveContextResponse)
async def resolve_context(
    request: ResolveContextRequest,
    store: StoreDepends,
    graph: GraphDepends,
    vault_ns: VaultNamespaceDepends,
) -> ResolveContextResponse:
    """
    Resolve the scope for a repo and return operational pages.

    Given a repo name:
    1. Resolves program membership (repo → program) via graph if available
    2. Finds all operational pages applicable to the repo or its program
    3. Returns the repo-profile page as entry_point
    4. Returns operational pages sorted by specificity (repo-level first)

    Uses Neo4j graph traversal when the graph client is available (injected
    via get_graph dependency, wired in main.py); falls back to legacy
    path-based scope resolution otherwise.
    """
    return await asyncio.to_thread(_resolve_context_sync, request, store, graph, vault_ns)


def _search_sync(request: SearchRequest, store: SearchStore) -> SearchResponse:
    """Synchronous implementation of search."""
    # BM25 keyword search. Hybrid disabled — see WI-4.
    search_results = store.search(request.query, limit=request.limit * 2)
    doc_cache = store.get_all_documents()

    # If both search and doc_cache returned nothing, this is likely a system
    # error (e.g. search index empty) rather than "no results".
    if not search_results and not doc_cache:
        logger.error(
            "Search returned zero results AND doc_cache is empty for query '%s'. "
            "Search engine may be non-functional. Store status: %s",
            request.query,
            store.status() if hasattr(store, "status") else "unknown",
        )

    pages_with_scores: list[tuple[Any, str, float]] = []

    for result in search_results:
        content = doc_cache.get(result.file_path)
        if not content:
            continue

        parsed = parse_page(content)
        pages_with_scores.append((parsed, result.file_path, result.score))

    pages: list[tuple[Any, str]] = [(page, path) for page, path, _ in pages_with_scores]

    if request.mode:
        pages = filter_by_mode(pages, request.mode)

    if request.type:
        pages = filter_by_type(pages, request.type)

    if request.scope:
        pages = filter_by_scope(pages, request.scope)

    pages = pages[:request.limit]

    scores: dict[str, float] = {path: score for _, path, score in pages_with_scores}
    summaries = to_summaries(pages, scores)

    return SearchResponse(
        results=summaries,
        total=len(summaries)
    )


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest, store: StoreDepends) -> SearchResponse:
    """
    Full-text and semantic search with progressive disclosure.

    Uses BM25 keyword search (hybrid disabled).
    Returns PageSummary objects (descriptions only) to enable filtering.
    """
    return await asyncio.to_thread(_search_sync, request, store)


def _get_page_sync(request: GetPageRequest, store: SearchStore, registry=None) -> PageFull:
    """Synchronous implementation of get-page."""
    file_path = _resolve_id(request.id, registry)
    content = store.get_document(file_path)

    if not content:
        raise not_found("Page", request.id)

    parsed = parse_page(content)
    return to_page_full(parsed, file_path)


@router.post("/get-page", response_model=PageFull)
async def get_page(request: GetPageRequest, store: StoreDepends, registry: UUIDRegistryDepends = None) -> PageFull:
    """Retrieve a full page by its identifier (UUID, file path, or title)."""
    return await asyncio.to_thread(_get_page_sync, request, store, registry)


def _get_related_sync(request: GetRelatedRequest, store: SearchStore, graph=None, registry=None, vault_name: str = "default") -> GetRelatedResponse:
    """Synchronous implementation of get-related.

    Tries graph-based edge traversal first (when graph client is available),
    then falls back to link_navigator frontmatter-based resolution.
    """
    file_path = _resolve_id(request.id, registry)
    content = store.get_document(file_path)

    if not content:
        raise not_found("Page", request.id)

    parsed = parse_page(content)
    source_summary = to_page_summary(parsed, file_path)

    # For graph queries: use the bare UUID (Neo4j page_id = UUID).
    graph_page_id = _resolve_id_to_uuid(request.id, registry)

    related_pages_tuples: list[tuple] = []

    if graph is not None:
        try:
            results = graph.query(
                """
                MATCH (p:Page {page_id: $page_id, vault_name: $vault_name})-[r:DOCS|PART_OF|RELATED|DEPENDS_ON|CONSUMED_BY|APPLIES_TO|MENTIONS|REFERENCES]-(q:Page {vault_name: $vault_name})
                RETURN DISTINCT q.page_id AS id
                LIMIT 50
                """,
                {"page_id": graph_page_id, "vault_name": vault_name}
            )
            doc_cache = store.get_all_documents()
            for row in results:
                related_uuid = row.get("id")
                if not related_uuid:
                    continue
                flat_path = f"pages/{related_uuid}.md" if _UUID_RE.match(related_uuid) else related_uuid
                page_content = doc_cache.get(flat_path) or store.get_document(related_uuid)
                if page_content:
                    rel_parsed = parse_page(page_content)
                    related_pages_tuples.append((rel_parsed, flat_path))
        except Exception:
            logger.warning(
                "Graph-based get-related failed for page '%s', falling back to link_navigator",
                file_path,
                exc_info=True,
            )
            graph = None  # trigger fallback

    if graph is None:
        # Legacy link_navigator fallback — follows frontmatter relationship fields
        related_pages_tuples = get_related_pages(parsed, store, registry)

    related_summaries = to_summaries(related_pages_tuples)

    return GetRelatedResponse(
        source=source_summary,
        related=related_summaries
    )


@router.post("/get-related", response_model=GetRelatedResponse)
async def get_related(
    request: GetRelatedRequest,
    store: StoreDepends,
    graph: GraphDepends,
    vault_ns: VaultNamespaceDepends,
    registry: UUIDRegistryDepends = None,
) -> GetRelatedResponse:
    """Follow links from a page to find related pages.

    Uses Neo4j graph edge traversal when the graph client is available;
    falls back to link_navigator (frontmatter-based) otherwise.
    """
    return await asyncio.to_thread(_get_related_sync, request, store, graph, registry, vault_ns)


def _list_by_scope_sync(request: ListByScopeRequest, store: SearchStore) -> ListByScopeResponse:
    """Synchronous implementation of list-by-scope."""
    doc_cache = store.get_all_documents()

    all_pages: list[tuple[Any, str]] = []
    for path, content in doc_cache.items():
        if not content:
            continue
        parsed = parse_page(content)
        all_pages.append((parsed, path))

    # Apply filters
    filtered = all_pages
    filtered = filter_by_scope(filtered, request.scope)

    if request.mode:
        filtered = filter_by_mode(filtered, request.mode)

    if request.type:
        filtered = filter_by_type(filtered, request.type)

    if request.tags:
        filtered = filter_by_tags(filtered, request.tags)

    filtered = filtered[:request.limit]
    summaries = to_summaries(filtered)

    return ListByScopeResponse(
        pages=summaries,
        total=len(summaries)
    )


@router.post("/list-by-scope", response_model=ListByScopeResponse)
async def list_by_scope(request: ListByScopeRequest, store: StoreDepends) -> ListByScopeResponse:
    """List and filter pages by scope, mode, type, and tags."""
    return await asyncio.to_thread(_list_by_scope_sync, request, store)


# ============================================================================
# Write-Path Operations
# ============================================================================

def _validate_page_sync(request: ValidatePageRequest, loader: SchemaLoader) -> ValidatePageResponse:
    """Synchronous implementation of validate-page."""
    import frontmatter as fm

    if not loader.page_types:
        raise schema_not_loaded("Schema has no page types loaded")

    try:
        post = fm.loads(request.content)
        metadata: dict[str, Any] = dict(post.metadata)
    except Exception as e:
        raise parse_error(
            f"Failed to parse YAML frontmatter: {e}",
            {"error_type": type(e).__name__}
        )

    validator = PageValidator(loader)
    result = validator.validate(metadata)

    return ValidatePageResponse(
        valid=result.valid,
        errors=[
            ValidationErrorModel(
                field=err.field_name,
                value=err.value,
                message=err.message,
                suggestions=err.suggestions,
                action_required=err.action_required,
            )
            for err in result.errors
        ],
        warnings=[
            ValidationWarningModel(field=w.field_name, message=w.message)
            for w in result.warnings
        ],
    )


@router.post("/validate-page", response_model=ValidatePageResponse)
async def validate_page(request: ValidatePageRequest, loader: SchemaLoaderDepends) -> ValidatePageResponse:
    """
    Validate a page against the schema and registries.

    Parses YAML frontmatter, runs all validation checks, and returns structured
    errors with fuzzy-match suggestions for unknown registry values.
    """
    return await asyncio.to_thread(_validate_page_sync, request, loader)


def _suggest_metadata_sync(request: SuggestMetadataRequest, loader: SchemaLoader, store: SearchStore) -> dict[str, Any]:
    """Synchronous implementation of suggest-metadata."""
    if not loader.page_types:
        raise schema_not_loaded("Schema has no page types loaded")

    suggester = MetadataSuggester(loader, store=store)
    result = suggester.suggest(request.content, hints=request.hints)
    return result.to_dict()


@router.post("/suggest-metadata", response_model=SuggestMetadataResponse)
async def suggest_metadata(
    request: SuggestMetadataRequest,
    loader: SchemaLoaderDepends,
    store: StoreDepends,
) -> SuggestMetadataResponse:
    """
    Suggest frontmatter metadata for a page.

    Analyses content, searches registries and the KB, and returns per-field
    suggestions with confidence levels and reasons.
    """
    result_dict = await asyncio.to_thread(_suggest_metadata_sync, request, loader, store)

    return SuggestMetadataResponse(
        kb_status=result_dict["kb_status"],
        suggestions=result_dict["suggestions"],
    )


def _check_duplicates_sync(request: CheckDuplicatesRequest, store: SearchStore) -> Any:
    """Synchronous implementation of check-duplicates."""
    try:
        checker = DuplicateChecker(store)
        threshold = request.threshold if request.threshold is not None else 0.75
        return checker.check(request.title, request.content, threshold=threshold)
    except Exception as e:
        logger.error("Duplicate check failed: %s", e, exc_info=True)
        raise internal_error(f"Duplicate check failed: {e}")


@router.post("/check-duplicates", response_model=CheckDuplicatesResponse)
async def check_duplicates(request: CheckDuplicatesRequest, store: StoreDepends) -> CheckDuplicatesResponse:
    """
    Check candidate page content against existing KB pages for overlap.

    Uses hybrid search with a two-query strategy (title + body excerpt).
    Returns scored matches with recommendations: "create" if the content is
    sufficiently novel (score >= threshold), "merge" if overlap is detected.
    """
    result = await asyncio.to_thread(_check_duplicates_sync, request, store)

    return CheckDuplicatesResponse(
        matches=[
            DuplicateMatchModel(
                page_path=m.page_path,
                title=m.title,
                similarity_score=m.similarity_score,
                recommendation=m.recommendation,
                matched_snippets=m.matched_snippets,
            )
            for m in result.matches
        ],
        has_conflicts=result.has_conflicts,
    )


def _get_schema_sync(loader: SchemaLoader) -> dict[str, Any]:
    """Synchronous implementation of get-schema."""
    if not loader.page_types:
        raise schema_not_loaded("Schema has no page types loaded")
    return loader.get_schema()


@router.get("/schema", response_model=SchemaResponse)
async def get_schema_endpoint(loader: SchemaLoaderDepends) -> SchemaResponse:
    """
    Return the full schema definition and all registry contents.

    Agents call this to discover available page types, field constraints,
    and known registry values before generating pages.
    """
    schema_dict = await asyncio.to_thread(_get_schema_sync, loader)
    return SchemaResponse(**schema_dict)


def _registry_add_sync(
    request: RegistryAddRequest,
    loader: SchemaLoader,
    settings: "VaultSettings | None" = None,
    resolver: Optional[VaultRepoResolver] = None,
    vault_namespace: str = "default",
    vault_git_repo: Optional[str] = None,
) -> RegistryAddResponse:
    """Synchronous implementation of registry/add."""
    if not loader.registries:
        raise schema_not_loaded("Schema has no registries loaded")

    registry = loader.get_registry(request.registry)
    if registry is None:
        raise registry_not_found(request.registry)

    # Check for duplicate entry
    existing = next((e for e in registry if e.id == request.entry.id), None)
    if existing is not None:
        raise duplicate_entry(request.registry, request.entry.id)

    entry = RegistryEntry(
        id=request.entry.id,
        description=request.entry.description or "",
        aliases=request.entry.aliases or [],
        scope_program=request.entry.scope_program,
    )

    try:
        loader.add_registry_entry(request.registry, entry)
    except ValueError as e:
        raise internal_error(str(e))

    total = len(loader.get_registry(request.registry))
    logger.info("Registry '%s': added '%s' (total: %d)", request.registry, entry.id, total)

    pr_url: str | None = None
    if request.via_pr:
        if not settings or not settings.github_token or not settings.github_repo:
            raise validation_error(
                "GitHub token and repo must be configured to use via_pr=True",
                details={"setting": "github_token / github_repo"},
            )
        from datetime import datetime
        from ..layer2.git_writer import GitWriter

        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        branch = f"registry/{request.registry}-{entry.id}-{timestamp}"
        registry_rel_path = f"_schema/registries/{request.registry}.yaml"
        yaml_content = loader._serialize_registry(request.registry)
        commit_message = f"chore(registry): add '{entry.id}' to {request.registry} registry"
        pr_title = f"Registry: add '{entry.id}' to {request.registry}"

        repo_path = resolver.resolve(vault_namespace, vault_git_repo) if resolver else settings.knowledge_repo_path
        github_repo = vault_git_repo or settings.github_repo
        writer = GitWriter(
            repo_path=repo_path,
            github_token=settings.github_token,
            github_repo=github_repo,
            base_branch=settings.github_base_branch,
            github_api_host=settings.github_api_host,
        )
        pr_url, _ = writer.write_page(
            page_path=registry_rel_path,
            content=yaml_content,
            branch=branch,
            commit_message=commit_message,
            pr_title=pr_title,
            pr_body=f"Auto-generated by Vault registry/add.\n\nAdded `{entry.id}` to `{request.registry}` registry.",
        )
        logger.info("Registry '%s': PR created for '%s' → %s", request.registry, entry.id, pr_url)

    return RegistryAddResponse(
        added=True,
        registry=request.registry,
        entry=RegistryEntryModel(
            id=entry.id,
            description=entry.description,
            aliases=entry.aliases,
            scope_program=entry.scope_program,
        ),
        total_entries=total,
        pr_url=pr_url,
    )


@router.post("/registry/add", response_model=RegistryAddResponse)
async def registry_add(
    request: RegistryAddRequest,
    loader: SchemaLoaderDepends,
    settings: SettingsDepends,
    vault_ns: VaultNamespaceDepends,
    vault_git_repo: VaultGitRepoDepends = None,
    resolver: RepoResolverDepends = None,
) -> RegistryAddResponse:
    """
    Add a new entry to a named registry.

    By default, writes the entry to the registry YAML file on disk and updates
    the in-memory registry. When `via_pr=True`, writes the updated registry to a
    new git branch and opens a GitHub PR for review instead.
    """
    return await asyncio.to_thread(
        _registry_add_sync, request, loader, settings,
        resolver, vault_ns, vault_git_repo,
    )


def _write_page_sync(
    request: WritePageRequest,
    loader: SchemaLoader,
    settings: VaultSettings,
    registry=None,
    resolver: Optional[VaultRepoResolver] = None,
    vault_namespace: str = "default",
    vault_git_repo: Optional[str] = None,
    graph: Any = None,
    store: Any = None,
) -> WritePageResponse:
    """Synchronous implementation of write-page."""
    import uuid as _uuid
    import frontmatter as fm
    import hashlib
    from datetime import datetime

    # Validate GitHub configuration
    if not settings.github_token:
        raise validation_error(
            "GitHub token not configured",
            details={"setting": "github_token"}
        )
    if not settings.github_repo:
        raise validation_error(
            "GitHub repo not configured",
            details={"setting": "github_repo"}
        )

    # Resolve the per-vault knowledge repo path
    if resolver:
        repo_path = resolver.resolve(vault_namespace, vault_git_repo)
    else:
        repo_path = settings.knowledge_repo_path

    # The GitHub repo slug for PRs: use per-vault git_repo if provided, else default
    github_repo = vault_git_repo or settings.github_repo

    # Parse and validate frontmatter
    try:
        post = fm.loads(request.content)
        metadata: dict[str, Any] = dict(post.metadata)
    except Exception as e:
        raise parse_error(
            f"Failed to parse YAML frontmatter: {e}",
            {"error_type": type(e).__name__}
        )

    # Ensure page has a UUID identity — generate one if missing
    if not metadata.get("id"):
        page_uuid = str(_uuid.uuid4())
        post.metadata["id"] = page_uuid
        # Re-serialize content with the new UUID in frontmatter
        request = WritePageRequest(
            path=request.path,
            content=fm.dumps(post),
            commit_message=request.commit_message,
            pr_title=request.pr_title,
            pr_body=request.pr_body,
        )

    # Validate against schema
    if not loader.page_types:
        raise schema_not_loaded("Schema has no page types loaded")

    validator = PageValidator(loader)
    result = validator.validate(metadata)
    if not result.valid:
        raise validation_error(
            "Page validation failed",
            details={
                "errors": [
                    {"field": e.field_name, "message": e.message}
                    for e in result.errors
                ]
            }
        )

    # Flat-UUID storage: canonical on-disk path is pages/<uuid>.md.
    # The request.path is now advisory only (kept for human context / PR title).
    # We always write to the flat UUID path derived from frontmatter.
    page_uuid = post.metadata.get("id")
    flat_path = f"pages/{page_uuid}.md" if page_uuid else None

    if flat_path is None:
        raise internal_error("Page has no UUID after stamping — cannot derive flat path")

    # Derive branch from UUID (short prefix) to avoid branch-name collisions.
    short_uuid = page_uuid[:8] if page_uuid else "unknown"
    branch = f"vault/write-{short_uuid}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

    commit_message = request.commit_message or f"Add/update page: {flat_path}"
    pr_title = request.pr_title or f"Add/update knowledge page: {flat_path}"

    writer = GitWriter(
        repo_path=repo_path,
        github_token=settings.github_token,
        github_repo=github_repo,
        base_branch=settings.github_base_branch,
        github_api_host=settings.github_api_host,
    )

    pr_url, commit_sha = writer.write_page(
        page_path=flat_path,
        content=request.content,
        branch=branch,
        commit_message=commit_message,
        pr_title=pr_title,
        pr_body=request.pr_body or "",
    )

    logger.info(
        "Page written and PR created: %s → %s",
        flat_path,
        pr_url,
        extra={"commit_sha": commit_sha}
    )

    # Update UUID registry: flat path is the canonical path.
    if registry and page_uuid:
        registry.register(page_uuid, flat_path)

    # Wiki-link auto-edge extraction (Section B): scan body for [[...]] links
    # and create MENTIONS edges in Neo4j.  Runs fire-and-forget — never blocks
    # the write response.
    if graph is not None and page_uuid and _GRAPH_EDGES_AVAILABLE:
        try:
            body_content = post.content  # markdown body without frontmatter
            search_fn = (lambda q: store.search(q, limit=5)) if store else (lambda q: [])
            _create_wiki_link_edges(
                graph, page_uuid, body_content, registry, search_fn,
                vault_name=vault_namespace,
            )
        except Exception as _wl_exc:
            logger.warning("Wiki-link edge extraction failed for %s: %s", page_uuid, _wl_exc)

    return WritePageResponse(
        pr_url=pr_url,
        branch=branch,
        commit_sha=commit_sha,
        path=flat_path,
    )


@router.post("/write-page", response_model=WritePageResponse)
async def write_page(
    request: WritePageRequest,
    loader: SchemaLoaderDepends,
    settings: SettingsDepends,
    store: StoreDepends,
    vault_ns: VaultNamespaceDepends,
    graph: GraphDepends,
    vault_git_repo: VaultGitRepoDepends = None,
    registry: UUIDRegistryDepends = None,
    resolver: RepoResolverDepends = None,
) -> WritePageResponse:
    """
    Write a validated knowledge page to the knowledge-base repo, commit it to a new branch,
    and open a GitHub PR for human review.

    This completes the write-path pipeline:
    1. Validate page content against schema + registries
    2. Derive flat-UUID branch and path (pages/<uuid>.md)
    3. Create feature branch
    4. Write page to disk and commit
    5. Push to GitHub
    6. Open PR
    7. Auto-extract wiki-links from body and create MENTIONS edges in Neo4j
    8. Return PR URL (human review gate)

    Requires GitHub configuration (GITHUB_TOKEN, GITHUB_REPO).
    """
    return await asyncio.to_thread(
        _write_page_sync, request, loader, settings, registry,
        resolver, vault_ns, vault_git_repo, graph, store,
    )


# ============================================================================
# Graph Path Operations (Neo4j-backed)
# These routes require the GraphClient (Wave 1). When the graph is not
# available (graph is None), they return HTTP 503.
# ============================================================================

try:
    from ..layer2.graph_edges import (
        Edge,
        EdgeType,
        EdgeProperties,
        create_edge as _create_edge,
        get_edges as _get_edges,
        delete_edge as _delete_edge,
        traverse_graph as _traverse_graph,
        create_wiki_link_edges as _create_wiki_link_edges,
    )
    _GRAPH_EDGES_AVAILABLE = True
except ImportError:
    _GRAPH_EDGES_AVAILABLE = False


_GRAPH_UNAVAILABLE_DETAIL = {
    "reason": "Neo4j GraphClient is not configured. "
              "Ensure the graph layer (Wave 1) is deployed and GRAPH_URI is set."
}


def _graph_unavailable_response():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=503,
        content={"error": True, "code": "SERVICE_UNAVAILABLE", "message": "Graph service is not available", "details": _GRAPH_UNAVAILABLE_DETAIL},
    )


def _create_edge_sync(request: CreateEdgeRequest, graph: Any, registry=None, vault_name: str = "default") -> EdgeResponse:
    """Synchronous implementation of POST /graph/edges."""
    source_id = _resolve_id_to_uuid(request.source_id, registry)
    target_id = _resolve_id_to_uuid(request.target_id, registry)
    edge_type = EdgeType.from_str(request.edge_type)
    props = EdgeProperties(
        mechanism=request.properties.mechanism,
        role=request.properties.role,
    )
    edge = Edge(
        source_id=source_id,
        target_id=target_id,
        edge_type=edge_type,
        properties=props,
    )
    _create_edge(graph, edge, vault_name=vault_name)
    return EdgeResponse(
        source_id=source_id,
        target_id=target_id,
        edge_type=edge_type.value,
        properties=props.to_dict(),
    )


@router.post("/graph/edges", response_model=EdgeResponse)
async def create_graph_edge(request: CreateEdgeRequest, graph: GraphDepends, vault_ns: VaultNamespaceDepends, registry: UUIDRegistryDepends = None) -> Any:
    """
    Create a directed edge between two knowledge pages in Neo4j.

    Nodes (Pages) are created if they do not already exist (MERGE semantics).
    Requires Neo4j GraphClient — returns 503 if graph is unavailable.
    """
    if graph is None:
        return _graph_unavailable_response()
    return await asyncio.to_thread(_create_edge_sync, request, graph, registry, vault_ns)


def _get_edges_sync(request: GetEdgesRequest, graph: Any, registry=None, vault_name: str = "default") -> GetEdgesResponse:
    """Synchronous implementation of POST /graph/edges/get.

    Returns edges with direction (outgoing|incoming) and display_label
    (inverse label for incoming directional edges).
    """
    page_id = _resolve_id_to_uuid(request.page_id, registry)
    edge_type: "EdgeType | None" = None
    if request.edge_type:
        edge_type = EdgeType.from_str(request.edge_type)
    raw_edges = _get_edges(graph, page_id, edge_type, vault_name=vault_name)
    edges = [
        EdgeResponse(
            # For outgoing: source=page_id, target=other_id
            # For incoming: source=other_id, target=page_id (shows the actual edge direction)
            source_id=page_id if e.get("direction") == "outgoing" else e["other_id"],
            target_id=e["other_id"] if e.get("direction") == "outgoing" else page_id,
            edge_type=e["edge_type"],
            properties={
                **e.get("properties", {}),
                "direction": e.get("direction", "outgoing"),
                "display_label": e.get("display_label", e["edge_type"]),
            },
        )
        for e in raw_edges
    ]
    return GetEdgesResponse(page_id=page_id, edges=edges)


@router.post("/graph/edges/get", response_model=GetEdgesResponse)
async def get_graph_edges(request: GetEdgesRequest, graph: GraphDepends, vault_ns: VaultNamespaceDepends, registry: UUIDRegistryDepends = None) -> Any:
    """
    Get all edges for a page, optionally filtered by edge type.

    Returns edges in both directions (outgoing and incoming).
    Requires Neo4j GraphClient — returns 503 if graph is unavailable.
    """
    if graph is None:
        return _graph_unavailable_response()
    return await asyncio.to_thread(_get_edges_sync, request, graph, registry, vault_ns)


def _delete_edge_sync(request: DeleteEdgeRequest, graph: Any, registry=None, vault_name: str = "default") -> dict:
    """Synchronous implementation of POST /graph/edges/delete."""
    source_id = _resolve_id_to_uuid(request.source_id, registry)
    target_id = _resolve_id_to_uuid(request.target_id, registry)
    edge_type = EdgeType.from_str(request.edge_type)
    _delete_edge(graph, source_id, target_id, edge_type, vault_name=vault_name)
    return {"deleted": True, "source_id": source_id, "target_id": target_id, "edge_type": edge_type.value}


@router.post("/graph/edges/delete")
async def delete_graph_edge(request: DeleteEdgeRequest, graph: GraphDepends, vault_ns: VaultNamespaceDepends, registry: UUIDRegistryDepends = None) -> Any:
    """
    Delete a specific directed edge between two pages.

    Requires Neo4j GraphClient — returns 503 if graph is unavailable.
    """
    if graph is None:
        return _graph_unavailable_response()
    return await asyncio.to_thread(_delete_edge_sync, request, graph, registry, vault_ns)


def _traverse_graph_sync(request: TraverseGraphRequest, graph: Any, registry=None, vault_name: str = "default") -> TraverseGraphResponse:
    """Synchronous implementation of POST /graph/traverse."""
    start_id = _resolve_id_to_uuid(request.start_page_id, registry)
    edge_types: "list[EdgeType] | None" = None
    if request.edge_types:
        edge_types = [EdgeType.from_str(et) for et in request.edge_types]
    pages = _traverse_graph(graph, start_id, edge_types, request.max_depth, vault_name=vault_name)
    return TraverseGraphResponse(
        start_page_id=start_id,
        pages=pages,
        depth=request.max_depth,
    )


@router.post("/graph/traverse", response_model=TraverseGraphResponse)
async def traverse_knowledge_graph(request: TraverseGraphRequest, graph: GraphDepends, vault_ns: VaultNamespaceDepends, registry: UUIDRegistryDepends = None) -> Any:
    """
    Traverse the knowledge graph from a starting page up to max_depth hops.

    Returns all reachable pages within the depth limit. Optionally filter
    by edge type(s). Requires Neo4j GraphClient — returns 503 if unavailable.
    """
    if graph is None:
        return _graph_unavailable_response()
    return await asyncio.to_thread(_traverse_graph_sync, request, graph, registry, vault_ns)


# ============================================================================
# Graph Export/Import Operations
# ============================================================================

def _service_unavailable(resource: str) -> VaultError:
    return VaultError(ErrorCode.SERVICE_UNAVAILABLE, f"{resource} is not available")


@router.post("/graph/export", response_model=GraphExportResponse)
async def graph_export(
    graph: GraphDepends,
    settings: SettingsDepends,
    vault_ns: VaultNamespaceDepends,
    vault_git_repo: VaultGitRepoDepends = None,
    resolver: RepoResolverDepends = None,
) -> GraphExportResponse:
    """
    Export Neo4j graph nodes and edges for the current vault to a JSON file.

    The export is written to ``_graph/edges.json`` inside the knowledge-base repo,
    enabling git-backed cloud sync and bootstrapping of new instances.

    Returns export stats (node count, edge count, file path).
    Returns 503 if the graph client is not available.
    """
    if graph is None:
        raise _service_unavailable("Graph client")
    repo_path = resolver.resolve(vault_ns, vault_git_repo) if resolver else settings.knowledge_repo_path
    stats = await asyncio.to_thread(export_graph, graph, repo_path, vault_name=vault_ns)
    commit_result = await asyncio.to_thread(
        commit_graph_export, repo_path, settings.github_base_branch
    )
    stats["git"] = commit_result
    return GraphExportResponse(**stats)


@router.post("/graph/import", response_model=GraphImportResponse)
async def graph_import(
    graph: GraphDepends,
    settings: SettingsDepends,
    vault_ns: VaultNamespaceDepends,
    vault_git_repo: VaultGitRepoDepends = None,
    resolver: RepoResolverDepends = None,
) -> GraphImportResponse:
    """
    Import/seed Neo4j from the JSON export file in the knowledge-base repo.

    Reads ``_graph/edges.json`` and MERGEs all nodes and edges into Neo4j.
    Idempotent — safe to call multiple times.

    Returns import stats. If the export file does not exist, returns
    ``skipped: true`` with zero counts rather than raising an error.
    Returns 503 if the graph client is not available.
    """
    if graph is None:
        raise _service_unavailable("Graph client")
    repo_path = resolver.resolve(vault_ns, vault_git_repo) if resolver else settings.knowledge_repo_path
    stats = await asyncio.to_thread(import_graph, graph, repo_path, vault_name=vault_ns)
    return GraphImportResponse(**stats)


# ============================================================================
# Admin Operations
# ============================================================================

def _reindex_sync(store: SearchStore) -> dict:
    """Synchronous implementation of POST /reindex."""
    return store.reindex()


@router.post("/reindex")
async def reindex(store: StoreDepends) -> dict:
    """
    Trigger a full re-index of all vault collections.

    Scans all collection paths and rebuilds the search index from the filesystem.
    Returns a summary of how many documents were indexed and how many errors occurred.

    Returns 501 if the configured store does not support reindexing.
    """
    if not hasattr(store, "reindex") or not callable(getattr(store, "reindex")):
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=501,
            content={"error": True, "code": "NOT_IMPLEMENTED", "message": "This store does not support reindexing"},
        )
    result = await asyncio.to_thread(_reindex_sync, store)
    logger.info(
        "Reindex complete: indexed=%d errors=%d duration_ms=%.1f",
        result.get("indexed", 0),
        result.get("errors", 0),
        result.get("duration_ms", 0.0),
    )
    return {
        "indexed": result.get("indexed", 0),
        "errors": result.get("errors", 0),
        "duration_ms": result.get("duration_ms", 0.0),
    }
