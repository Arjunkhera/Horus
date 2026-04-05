"""
Graph-based context resolution for Vault.
Replaces the path-based scope resolution (scope.py) with Neo4j graph traversal.
"""
from dataclasses import dataclass
from typing import Optional, Any, Protocol


class GraphClientProtocol(Protocol):
    def query(self, cypher: str, params: dict = None) -> list[dict]: ...


@dataclass
class ResolvedContext:
    repo: str
    repo_profile_id: Optional[str] = None
    related_page_ids: list[str] = None

    def __post_init__(self):
        if self.related_page_ids is None:
            self.related_page_ids = []


def resolve_context_from_graph(
    repo: str,
    graph: GraphClientProtocol,
) -> ResolvedContext:
    """
    Resolve context for a repo using the Neo4j knowledge graph.

    1. Find the repo-profile node for this repo
    2. Traverse docs, part_of, related edges to find relevant pages
    3. Return IDs of relevant pages (caller loads content)
    """
    ctx = ResolvedContext(repo=repo)

    # Find repo-profile node
    results = graph.query(
        "MATCH (p:Page {repo: $repo, type: 'repo-profile'}) RETURN p.page_id AS id LIMIT 1",
        {"repo": repo}
    )
    if results:
        ctx.repo_profile_id = results[0]["id"]

    if not ctx.repo_profile_id:
        return ctx

    # Traverse relevant edges (docs, part_of, related) for operational pages
    related = graph.query("""
        MATCH (p:Page {page_id: $page_id})-[r:DOCS|PART_OF|RELATED]-(q:Page)
        WHERE q.mode = 'operational'
        RETURN DISTINCT q.page_id AS id
        LIMIT 50
    """, {"page_id": ctx.repo_profile_id})

    ctx.related_page_ids = [r["id"] for r in related]
    return ctx


def resolve_context_fallback(
    repo: str,
    store: Any,  # SearchStore
    doc_cache: Optional[dict] = None,
) -> tuple[Optional[Any], list[tuple[Any, str]]]:
    """
    Fallback to path-based resolution when graph is unavailable.
    Delegates to legacy scope.py functions.
    """
    from .scope import resolve_scope, collect_operational_pages
    scope = resolve_scope(repo, store, doc_cache)
    pages = collect_operational_pages(scope, store, doc_cache)
    return scope, pages
