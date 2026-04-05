"""
Knowledge graph edge operations for Vault.
Manages edges between knowledge pages in Neo4j.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Any


class EdgeType(str, Enum):
    PART_OF = "PART_OF"
    DEPENDS_ON = "DEPENDS_ON"
    SENDS_TO = "SENDS_TO"
    DOCS = "DOCS"
    RELATED = "RELATED"

    @classmethod
    def from_str(cls, value: str) -> "EdgeType":
        try:
            return cls(value.upper())
        except ValueError:
            raise ValueError(f"Invalid edge type: {value!r}. Must be one of: {[e.value for e in cls]}")


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


def create_edge(graph: Any, edge: Edge) -> bool:
    """Create an edge between two page nodes. Creates nodes if they don't exist (MERGE)."""
    graph.query("""
        MERGE (s:Page {page_id: $source_id})
        MERGE (t:Page {page_id: $target_id})
        MERGE (s)-[r:%s]->(t)
        SET r += $props
    """ % edge.edge_type.value, {
        "source_id": edge.source_id,
        "target_id": edge.target_id,
        "props": edge.properties.to_dict(),
    })
    return True


def get_edges(graph: Any, page_id: str, edge_type: Optional[EdgeType] = None) -> list[dict]:
    """Get all edges for a page, optionally filtered by type."""
    if edge_type:
        results = graph.query("""
            MATCH (p:Page {page_id: $page_id})-[r:%s]->(t:Page)
            RETURN t.page_id AS target_id, type(r) AS edge_type, properties(r) AS props
            UNION
            MATCH (s:Page)-[r:%s]->(p:Page {page_id: $page_id})
            RETURN s.page_id AS target_id, type(r) AS edge_type, properties(r) AS props
        """ % (edge_type.value, edge_type.value), {"page_id": page_id})
    else:
        results = graph.query("""
            MATCH (p:Page {page_id: $page_id})-[r]->(t:Page)
            RETURN t.page_id AS target_id, type(r) AS edge_type, properties(r) AS props
            UNION
            MATCH (s:Page)-[r]->(p:Page {page_id: $page_id})
            RETURN s.page_id AS target_id, type(r) AS edge_type, properties(r) AS props
        """, {"page_id": page_id})
    return [
        {"target_id": r["target_id"], "edge_type": r["edge_type"], "properties": r.get("props", {})}
        for r in results
    ]


def delete_edge(graph: Any, source_id: str, target_id: str, edge_type: EdgeType) -> bool:
    """Delete a specific edge between two pages."""
    graph.query("""
        MATCH (s:Page {page_id: $source_id})-[r:%s]->(t:Page {page_id: $target_id})
        DELETE r
    """ % edge_type.value, {"source_id": source_id, "target_id": target_id})
    return True


def traverse_graph(
    graph: Any,
    start_page_id: str,
    edge_types: Optional[list[EdgeType]] = None,
    max_depth: int = 3,
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
        MATCH (start:Page {{page_id: $start_id}})-{rel_pattern}-(page:Page)
        WHERE page.page_id <> $start_id
        RETURN DISTINCT page.page_id AS page_id, page.type AS page_type, page.mode AS mode
        LIMIT 100
    """, {"start_id": start_page_id})

    return [{"page_id": r["page_id"], "type": r.get("page_type"), "mode": r.get("mode")} for r in results]
