"""
Knowledge graph edge operations for Vault.
Manages edges between knowledge pages in Neo4j.

Flat-UUID redesign: page_id values stored in Neo4j are bare UUIDs.

Intent registry (Section C):
Each intent has an id, direction (directional|bidirectional), and an
inverse_label used when displaying incoming edges.  ``get_edges`` now
returns, for each edge:
  - ``other_id``:     the UUID of the OTHER endpoint
  - ``edge_type``:    the Neo4j relationship type label
  - ``direction``:    "outgoing" | "incoming"
  - ``display_label``: edge_type for outgoing; inverse_label for incoming
                       directional edges; edge_type for bidirectional
  - ``properties``:   edge property dict

``target_id`` is kept as an alias for ``other_id`` for backward compatibility
with existing callers that read the ``target_id`` key.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Any


# ---------------------------------------------------------------------------
# EdgeType enum — keep existing types for backward compatibility
# ---------------------------------------------------------------------------

class EdgeType(str, Enum):
    PART_OF = "PART_OF"
    DEPENDS_ON = "DEPENDS_ON"
    SENDS_TO = "SENDS_TO"
    DOCS = "DOCS"
    RELATED = "RELATED"
    MENTIONS = "MENTIONS"
    REFERENCES = "REFERENCES"

    @classmethod
    def from_str(cls, value: str) -> "EdgeType":
        try:
            return cls(value.upper())
        except ValueError:
            raise ValueError(f"Invalid edge type: {value!r}. Must be one of: {[e.value for e in cls]}")


# ---------------------------------------------------------------------------
# Intent registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IntentDefinition:
    """Definition of a registered edge intent."""
    id: str
    direction: str          # "directional" | "bidirectional"
    inverse_label: Optional[str]   # label used for incoming edges; None → bidirectional
    description: str


# The intent set mirrors Anvil's MVP intents plus Vault-specific additions.
# Each EdgeType value maps to one intent.
_INTENT_REGISTRY: dict[str, IntentDefinition] = {
    "MENTIONS": IntentDefinition(
        id="MENTIONS",
        direction="bidirectional",
        inverse_label=None,
        description="General association — auto-extracted from wiki-links in body",
    ),
    "REFERENCES": IntentDefinition(
        id="REFERENCES",
        direction="directional",
        inverse_label="REFERENCED_BY",
        description="Formal citation — source formally references target",
    ),
    "PART_OF": IntentDefinition(
        id="PART_OF",
        direction="directional",
        inverse_label="CONTAINS",
        description="Membership — source is part of target",
    ),
    "DEPENDS_ON": IntentDefinition(
        id="DEPENDS_ON",
        direction="directional",
        inverse_label="REQUIRED_BY",
        description="Dependency — source depends on target",
    ),
    "DOCS": IntentDefinition(
        id="DOCS",
        direction="directional",
        inverse_label="DOCUMENTED_BY",
        description="Documentation — source documents target service/package",
    ),
    "RELATED": IntentDefinition(
        id="RELATED",
        direction="bidirectional",
        inverse_label=None,
        description="Generic relationship — bidirectional association",
    ),
    "SENDS_TO": IntentDefinition(
        id="SENDS_TO",
        direction="directional",
        inverse_label="RECEIVES_FROM",
        description="Data flow — source sends data to target",
    ),
}


def get_intent(edge_type: str) -> Optional[IntentDefinition]:
    """Look up an intent by its edge type string."""
    return _INTENT_REGISTRY.get(edge_type.upper())


def _display_label(edge_type: str, direction: str) -> str:
    """
    Resolve the display label for an edge given its direction context.

    For outgoing edges → edge_type (the intent id).
    For incoming edges on directional intents → inverse_label.
    For incoming edges on bidirectional intents → edge_type (same label).
    """
    intent = _INTENT_REGISTRY.get(edge_type.upper())
    if not intent:
        return edge_type  # unknown intent — use raw type
    if direction == "outgoing":
        return edge_type
    # Incoming
    if intent.direction == "directional" and intent.inverse_label:
        return intent.inverse_label
    return edge_type  # bidirectional — same label in both directions


# ---------------------------------------------------------------------------
# Edge model
# ---------------------------------------------------------------------------

@dataclass
class EdgeProperties:
    mechanism: Optional[str] = None   # e.g., queue name, npm package
    role: Optional[str] = None        # e.g., producer, consumer
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = {}
        if self.mechanism:
            d["mechanism"] = self.mechanism
        if self.role:
            d["role"] = self.role
        d.update(self.extra)
        return d


@dataclass
class Edge:
    source_id: str
    target_id: str
    edge_type: EdgeType
    properties: EdgeProperties = field(default_factory=EdgeProperties)


# ---------------------------------------------------------------------------
# Graph operations
# ---------------------------------------------------------------------------

def create_edge(graph: Any, edge: Edge, vault_name: str = "default") -> bool:
    """Create an edge between two page nodes. Creates nodes if they don't exist (MERGE)."""
    graph.query("""
        MERGE (s:Page {page_id: $source_id, vault_name: $vault_name})
        MERGE (t:Page {page_id: $target_id, vault_name: $vault_name})
        MERGE (s)-[r:%s]->(t)
        SET r += $props
    """ % edge.edge_type.value, {
        "source_id": edge.source_id,
        "target_id": edge.target_id,
        "vault_name": vault_name,
        "props": edge.properties.to_dict(),
    })
    return True


def get_edges(
    graph: Any,
    page_id: str,
    edge_type: Optional[EdgeType] = None,
    vault_name: str = "default",
) -> list[dict]:
    """
    Get all edges for a page, optionally filtered by type.

    Returns a list of dicts, each containing:
    - ``other_id``:     UUID of the other endpoint
    - ``target_id``:    alias for ``other_id`` (backward compatibility)
    - ``edge_type``:    Neo4j relationship type label
    - ``direction``:    "outgoing" | "incoming"
    - ``display_label``: human-readable label respecting edge directionality
    - ``properties``:   edge property dict
    """
    if edge_type:
        et = edge_type.value
        results = graph.query("""
            MATCH (p:Page {page_id: $page_id, vault_name: $vault_name})-[r:%s]->(t:Page)
            RETURN t.page_id AS other_id, type(r) AS edge_type, properties(r) AS props,
                   'outgoing' AS direction
            UNION
            MATCH (s:Page)-[r:%s]->(p:Page {page_id: $page_id, vault_name: $vault_name})
            RETURN s.page_id AS other_id, type(r) AS edge_type, properties(r) AS props,
                   'incoming' AS direction
        """ % (et, et), {"page_id": page_id, "vault_name": vault_name})
    else:
        results = graph.query("""
            MATCH (p:Page {page_id: $page_id, vault_name: $vault_name})-[r]->(t:Page)
            RETURN t.page_id AS other_id, type(r) AS edge_type, properties(r) AS props,
                   'outgoing' AS direction
            UNION
            MATCH (s:Page)-[r]->(p:Page {page_id: $page_id, vault_name: $vault_name})
            RETURN s.page_id AS other_id, type(r) AS edge_type, properties(r) AS props,
                   'incoming' AS direction
        """, {"page_id": page_id, "vault_name": vault_name})

    edges = []
    for r in results:
        et_str = r["edge_type"]
        dir_str = r.get("direction", "outgoing")
        # Accept both "other_id" (new Cypher) and "target_id" (legacy/mock compat)
        other = r.get("other_id") or r.get("target_id", "")
        label = _display_label(et_str, dir_str)
        edges.append({
            "other_id": other,
            "target_id": other,   # backward-compat alias
            "edge_type": et_str,
            "direction": dir_str,
            "display_label": label,
            "properties": r.get("props", {}),
        })
    return edges


def delete_edge(graph: Any, source_id: str, target_id: str, edge_type: EdgeType, vault_name: str = "default") -> bool:
    """Delete a specific edge between two pages."""
    graph.query("""
        MATCH (s:Page {page_id: $source_id, vault_name: $vault_name})-[r:%s]->(t:Page {page_id: $target_id, vault_name: $vault_name})
        DELETE r
    """ % edge_type.value, {"source_id": source_id, "target_id": target_id, "vault_name": vault_name})
    return True


def traverse_graph(
    graph: Any,
    start_page_id: str,
    edge_types: Optional[list[EdgeType]] = None,
    max_depth: int = 3,
    vault_name: str = "default",
) -> list[dict]:
    """
    Traverse the graph from a starting page up to max_depth hops.
    Returns list of reachable pages with their distance and edge path.
    """
    if edge_types:
        type_filter = "|".join(e.value for e in edge_types)
        rel_pattern = f"[r:{type_filter}*1..{max_depth}]"
    else:
        rel_pattern = f"[r*1..{max_depth}]"

    results = graph.query(f"""
        MATCH (start:Page {{page_id: $start_id, vault_name: $vault_name}})-{rel_pattern}-(page:Page {{vault_name: $vault_name}})
        WHERE page.page_id <> $start_id
        RETURN DISTINCT page.page_id AS page_id, page.type AS page_type, page.mode AS mode
        LIMIT 100
    """, {"start_id": start_page_id, "vault_name": vault_name})

    return [{"page_id": r["page_id"], "type": r.get("page_type"), "mode": r.get("mode")} for r in results]


# ---------------------------------------------------------------------------
# Wiki-link auto-edge extraction (Section B)
# ---------------------------------------------------------------------------

import re as _re

# Regex to find wiki-links: [[target]] or [[target|display]]
_WIKILINK_RE = _re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
# Regex for fenced code blocks
_FENCED_CODE_RE = _re.compile(r"```[\s\S]*?```", _re.MULTILINE)
# Regex for inline code
_INLINE_CODE_RE = _re.compile(r"`[^`]*`")
# UUID pattern (v4)
_UUID_RE = _re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    _re.IGNORECASE,
)


def extract_wiki_links(body: str) -> list[str]:
    """
    Extract all wiki-link targets from a markdown body.

    Strips fenced and inline code blocks first to avoid matching links inside
    code.  Handles ``[[Target]]`` and ``[[Target|Display]]`` syntax.

    Returns a deduplicated list of target strings (without brackets or aliases).
    """
    # Strip code blocks
    cleaned = _FENCED_CODE_RE.sub("", body)
    cleaned = _INLINE_CODE_RE.sub("", cleaned)

    seen: set[str] = set()
    results: list[str] = []
    for m in _WIKILINK_RE.finditer(cleaned):
        target = m.group(1).strip()
        if target and target not in seen:
            seen.add(target)
            results.append(target)
    return results


def create_wiki_link_edges(
    graph: Any,
    source_uuid: str,
    body: str,
    registry: Any,
    search_fn: Any,
    vault_name: str = "default",
) -> list[str]:
    """
    Scan *body* for wiki-links and create MENTIONS edges in Neo4j.

    Resolution strategy:
    1. If target is a bare UUID → resolve directly via registry.
    2. Otherwise → search by title via *search_fn* (first result used).

    Edges are created from *source_uuid* to each resolved target UUID.
    Unresolvable targets are logged and skipped (never raises).

    Args:
        graph:       Neo4j graph client (with .query()).
        source_uuid: UUID of the page being written/indexed.
        body:        Markdown body to scan.
        registry:    UUIDRegistry instance.
        search_fn:   Callable(query: str) → list[SearchResult] for title resolution.
        vault_name:  Vault namespace.

    Returns:
        List of successfully created target UUIDs.
    """
    import logging
    _logger = logging.getLogger(__name__)

    targets = extract_wiki_links(body)
    created: list[str] = []

    for target in targets:
        try:
            target_uuid: Optional[str] = None

            if _UUID_RE.match(target):
                # Direct UUID reference
                target_uuid = target
            else:
                # Title-based resolution via search — require exact case-insensitive title match
                try:
                    results = search_fn(target)
                    match = next(
                        (r for r in results
                         if getattr(r, "title", None)
                         and r.title.strip().lower() == target.strip().lower()
                         and r.id),
                        None,
                    )
                    if match:
                        target_uuid = match.id
                except Exception as search_exc:
                    _logger.debug("Wiki-link title search failed for %r: %s", target, search_exc)

            if not target_uuid:
                _logger.debug(
                    "Wiki-link target %r could not be resolved for page %s — skipping",
                    target, source_uuid,
                )
                continue

            if target_uuid == source_uuid:
                continue  # skip self-references

            # Create MENTIONS edge (bidirectional intent — one directed edge suffices)
            edge = Edge(
                source_id=source_uuid,
                target_id=target_uuid,
                edge_type=EdgeType.MENTIONS,
            )
            create_edge(graph, edge, vault_name=vault_name)
            created.append(target_uuid)

        except Exception as exc:
            _logger.warning(
                "Failed to create wiki-link edge from %s to %r: %s",
                source_uuid, target, exc,
            )

    return created
