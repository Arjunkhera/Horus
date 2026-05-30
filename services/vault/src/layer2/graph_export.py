"""
Graph export/import for Vault.
Serializes the Neo4j knowledge graph to a JSON file in the knowledge-base repo
for git-backed cloud sync and new instance bootstrapping.
"""
import json
import logging
import subprocess
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

EXPORT_FILE_RELATIVE = "_graph/edges.json"


def export_graph(graph: Any, knowledge_repo_path: str, vault_name: str = "default") -> dict:
    """
    Export nodes and edges for a vault from Neo4j to a JSON file.
    Returns export stats.
    """
    edges = graph.query("""
        MATCH (s:Page {vault_name: $vault_name})-[r]->(t:Page {vault_name: $vault_name})
        RETURN s.page_id AS source_id,
               t.page_id AS target_id,
               type(r) AS edge_type,
               properties(r) AS props
    """, {"vault_name": vault_name})

    nodes = graph.query("""
        MATCH (p:Page {vault_name: $vault_name})
        RETURN p.page_id AS page_id, properties(p) AS props
    """, {"vault_name": vault_name})

    export_data = {
        "version": "1",
        "nodes": [{"page_id": n["page_id"], **n.get("props", {})} for n in nodes],
        "edges": [
            {
                "source_id": e["source_id"],
                "target_id": e["target_id"],
                "edge_type": e["edge_type"],
                "properties": e.get("props", {}),
            }
            for e in edges
        ],
    }

    export_path = Path(knowledge_repo_path) / EXPORT_FILE_RELATIVE
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_text(json.dumps(export_data, indent=2))

    logger.info(
        "Graph exported: %d nodes, %d edges → %s",
        len(export_data["nodes"]), len(export_data["edges"]), export_path,
    )
    return {"nodes": len(export_data["nodes"]), "edges": len(export_data["edges"]), "path": str(export_path)}


def import_graph(graph: Any, knowledge_repo_path: str, vault_name: str = "default") -> dict:
    """
    Import/seed Neo4j from the JSON export file. Idempotent — uses MERGE.
    Returns import stats.
    """
    export_path = Path(knowledge_repo_path) / EXPORT_FILE_RELATIVE
    if not export_path.exists():
        logger.warning("No graph export file found at %s — skipping import", export_path)
        return {"nodes": 0, "edges": 0, "skipped": True}

    data = json.loads(export_path.read_text())

    node_count = 0
    for node in data.get("nodes", []):
        page_id = node.get("page_id")
        if not page_id:
            continue
        props = {k: v for k, v in node.items() if k != "page_id"}
        props["vault_name"] = vault_name
        graph.query(
            "MERGE (p:Page {page_id: $page_id, vault_name: $vault_name}) SET p += $props",
            {"page_id": page_id, "vault_name": vault_name, "props": props},
        )
        node_count += 1

    edge_count = 0
    for edge in data.get("edges", []):
        edge_type = edge.get("edge_type", "RELATED")
        props = edge.get("properties", {})
        graph.query(
            """
            MERGE (s:Page {page_id: $source_id, vault_name: $vault_name})
            MERGE (t:Page {page_id: $target_id, vault_name: $vault_name})
            MERGE (s)-[r:%s]->(t)
            SET r += $props
            """ % edge_type,
            {
                "source_id": edge["source_id"],
                "target_id": edge["target_id"],
                "vault_name": vault_name,
                "props": props,
            },
        )
        edge_count += 1

    logger.info("Graph imported: %d nodes, %d edges from %s", node_count, edge_count, export_path)
    return {"nodes": node_count, "edges": edge_count, "skipped": False}


def commit_graph_export(knowledge_repo_path: str, base_branch: str = "master") -> dict:
    """
    Commit and push _graph/edges.json to the base branch if it has changed.
    Returns commit stats or {"skipped": True} if nothing changed.
    """
    export_rel = EXPORT_FILE_RELATIVE

    def _git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", knowledge_repo_path] + list(args),
            capture_output=True, text=True,
        )

    # Stage the export file
    result = _git("add", export_rel)
    if result.returncode != 0:
        logger.error("git add failed: %s", result.stderr)
        return {"committed": False, "error": result.stderr}

    # Check if there are staged changes for this file
    result = _git("diff", "--cached", "--quiet", "--", export_rel)
    if result.returncode == 0:
        logger.info("Graph export unchanged — skipping commit")
        return {"committed": False, "skipped": True}

    # Commit
    result = _git("commit", "-m", "chore: update graph export (edges.json)")
    if result.returncode != 0:
        logger.error("git commit failed: %s", result.stderr)
        return {"committed": False, "error": result.stderr}

    commit_sha = _git("rev-parse", "HEAD").stdout.strip()
    logger.info("Graph export committed: %s", commit_sha)

    # Push
    result = _git("push", "origin", base_branch)
    if result.returncode != 0:
        logger.error("git push failed: %s", result.stderr)
        return {"committed": True, "pushed": False, "sha": commit_sha, "error": result.stderr}

    logger.info("Graph export pushed to %s", base_branch)
    return {"committed": True, "pushed": True, "sha": commit_sha}
