"""
Tests for graph export/import functionality (layer2/graph_export.py).

Covers:
- test_export_graph_creates_file: mock graph, verify file written with correct structure
- test_export_graph_returns_stats: verify counts returned
- test_import_graph_skips_missing_file: verify graceful skip when no export file
- test_import_graph_idempotent: mock graph.query, verify MERGE called for each edge
- test_round_trip: export then import, verify same data
"""

import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock, call

from src.layer2.graph_export import export_graph, import_graph, commit_graph_export, EXPORT_FILE_RELATIVE


# ─── helpers ──────────────────────────────────────────────────────────────────

def _make_graph(nodes=None, edges=None):
    """Return a mock graph whose .query() returns the supplied node/edge lists."""
    graph = MagicMock()
    nodes = nodes or []
    edges = edges or []

    def _query_side_effect(cypher, *args, **kwargs):
        cypher_stripped = cypher.strip()
        if cypher_stripped.startswith("MATCH (p:Page)"):
            return nodes
        if cypher_stripped.startswith("MATCH (s:Page)-[r]->(t:Page)"):
            return edges
        # MERGE calls during import — return nothing meaningful
        return []

    graph.query.side_effect = _query_side_effect
    return graph


SAMPLE_NODES = [
    {"page_id": "page-1", "props": {"title": "Page One"}},
    {"page_id": "page-2", "props": {"title": "Page Two"}},
]

SAMPLE_EDGES = [
    {
        "source_id": "page-1",
        "target_id": "page-2",
        "edge_type": "DEPENDS_ON",
        "props": {"weight": 1},
    },
    {
        "source_id": "page-2",
        "target_id": "page-1",
        "edge_type": "RELATED",
        "props": {},
    },
]


# ─── tests ────────────────────────────────────────────────────────────────────

class TestExportGraph:
    def test_export_graph_creates_file(self, tmp_path):
        """export_graph writes a JSON file at <repo>/_graph/edges.json."""
        graph = _make_graph(nodes=SAMPLE_NODES, edges=SAMPLE_EDGES)

        export_graph(graph, str(tmp_path))

        export_file = tmp_path / EXPORT_FILE_RELATIVE
        assert export_file.exists(), "Export file should be created"

        data = json.loads(export_file.read_text())
        assert data["version"] == "1"
        assert isinstance(data["nodes"], list)
        assert isinstance(data["edges"], list)

    def test_export_graph_correct_structure(self, tmp_path):
        """Exported JSON has the correct node and edge structure."""
        graph = _make_graph(nodes=SAMPLE_NODES, edges=SAMPLE_EDGES)

        export_graph(graph, str(tmp_path))

        data = json.loads((tmp_path / EXPORT_FILE_RELATIVE).read_text())

        # Nodes include page_id and merged props
        node_ids = {n["page_id"] for n in data["nodes"]}
        assert node_ids == {"page-1", "page-2"}
        assert data["nodes"][0]["title"] == "Page One"

        # Edges have required fields
        edge = data["edges"][0]
        assert "source_id" in edge
        assert "target_id" in edge
        assert "edge_type" in edge
        assert "properties" in edge

    def test_export_graph_returns_stats(self, tmp_path):
        """export_graph returns a dict with node/edge counts and file path."""
        graph = _make_graph(nodes=SAMPLE_NODES, edges=SAMPLE_EDGES)

        stats = export_graph(graph, str(tmp_path))

        assert stats["nodes"] == 2
        assert stats["edges"] == 2
        assert stats["path"] == str(tmp_path / EXPORT_FILE_RELATIVE)

    def test_export_graph_empty_graph(self, tmp_path):
        """export_graph handles an empty graph gracefully."""
        graph = _make_graph(nodes=[], edges=[])

        stats = export_graph(graph, str(tmp_path))

        assert stats["nodes"] == 0
        assert stats["edges"] == 0
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        assert export_file.exists()
        data = json.loads(export_file.read_text())
        assert data["nodes"] == []
        assert data["edges"] == []

    def test_export_graph_creates_parent_dirs(self, tmp_path):
        """export_graph creates the _graph/ parent directory if it does not exist."""
        graph = _make_graph(nodes=SAMPLE_NODES, edges=SAMPLE_EDGES)
        nested_repo = tmp_path / "nested" / "repo"
        nested_repo.mkdir(parents=True)

        export_graph(graph, str(nested_repo))

        assert (nested_repo / EXPORT_FILE_RELATIVE).exists()


class TestImportGraph:
    def test_import_graph_skips_missing_file(self, tmp_path):
        """import_graph returns skipped=True when no export file exists."""
        graph = MagicMock()

        result = import_graph(graph, str(tmp_path))

        assert result["skipped"] is True
        assert result["nodes"] == 0
        assert result["edges"] == 0
        graph.query.assert_not_called()

    def test_import_graph_idempotent(self, tmp_path):
        """import_graph calls MERGE for each node and edge in the export file."""
        # Write an export file manually
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        export_file.parent.mkdir(parents=True, exist_ok=True)
        export_data = {
            "version": "1",
            "nodes": [
                {"page_id": "page-1", "title": "Page One"},
                {"page_id": "page-2", "title": "Page Two"},
            ],
            "edges": [
                {
                    "source_id": "page-1",
                    "target_id": "page-2",
                    "edge_type": "DEPENDS_ON",
                    "properties": {"weight": 1},
                }
            ],
        }
        export_file.write_text(json.dumps(export_data))

        graph = MagicMock()
        graph.query.return_value = []

        result = import_graph(graph, str(tmp_path))

        assert result["skipped"] is False
        assert result["nodes"] == 2
        assert result["edges"] == 1

        # Verify MERGE was called for both nodes and the edge
        assert graph.query.call_count == 3  # 2 node MERGEs + 1 edge MERGE

        # Node MERGE calls use the node MERGE query
        first_call_args = graph.query.call_args_list[0]
        assert "MERGE (p:Page {page_id: $page_id})" in first_call_args[0][0]
        assert first_call_args[0][1]["page_id"] == "page-1"

        # Edge MERGE call uses DEPENDS_ON edge type
        edge_call_args = graph.query.call_args_list[2]
        assert "DEPENDS_ON" in edge_call_args[0][0]

    def test_import_graph_returns_stats(self, tmp_path):
        """import_graph returns correct node/edge counts when import succeeds."""
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        export_file.parent.mkdir(parents=True, exist_ok=True)
        export_data = {
            "version": "1",
            "nodes": [{"page_id": "p1"}, {"page_id": "p2"}, {"page_id": "p3"}],
            "edges": [
                {"source_id": "p1", "target_id": "p2", "edge_type": "PART_OF", "properties": {}},
                {"source_id": "p2", "target_id": "p3", "edge_type": "SENDS_TO", "properties": {}},
            ],
        }
        export_file.write_text(json.dumps(export_data))

        graph = MagicMock()
        graph.query.return_value = []

        result = import_graph(graph, str(tmp_path))

        assert result["nodes"] == 3
        assert result["edges"] == 2
        assert result["skipped"] is False

    def test_import_graph_skips_nodes_without_page_id(self, tmp_path):
        """Nodes without a page_id are silently skipped."""
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        export_file.parent.mkdir(parents=True, exist_ok=True)
        export_data = {
            "version": "1",
            "nodes": [
                {"page_id": "valid-page"},
                {"title": "No page_id here"},  # should be skipped
            ],
            "edges": [],
        }
        export_file.write_text(json.dumps(export_data))

        graph = MagicMock()
        graph.query.return_value = []

        result = import_graph(graph, str(tmp_path))

        assert result["nodes"] == 1  # only the valid node counted
        assert graph.query.call_count == 1


class TestRoundTrip:
    def test_round_trip(self, tmp_path):
        """Export then import produces the same node and edge counts."""
        export_graph_obj = _make_graph(nodes=SAMPLE_NODES, edges=SAMPLE_EDGES)

        # Step 1: export
        export_stats = export_graph(export_graph_obj, str(tmp_path))
        assert export_stats["nodes"] == 2
        assert export_stats["edges"] == 2

        # Verify the file was written
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        assert export_file.exists()

        # Step 2: import using a fresh mock graph (simulating a clean instance)
        import_graph_obj = MagicMock()
        import_graph_obj.query.return_value = []

        import_stats = import_graph(import_graph_obj, str(tmp_path))

        assert import_stats["skipped"] is False
        assert import_stats["nodes"] == export_stats["nodes"]
        assert import_stats["edges"] == export_stats["edges"]

    def test_round_trip_preserves_edge_types(self, tmp_path):
        """Round-trip preserves the edge_type values from the original export."""
        nodes = [
            {"page_id": "a", "props": {}},
            {"page_id": "b", "props": {}},
        ]
        edges = [
            {"source_id": "a", "target_id": "b", "edge_type": "DOCS", "props": {}},
        ]
        graph = _make_graph(nodes=nodes, edges=edges)
        export_graph(graph, str(tmp_path))

        # Check the file retains edge type
        data = json.loads((tmp_path / EXPORT_FILE_RELATIVE).read_text())
        assert data["edges"][0]["edge_type"] == "DOCS"

        # On import, the MERGE query should reference the DOCS edge type
        import_mock = MagicMock()
        import_mock.query.return_value = []
        import_graph(import_mock, str(tmp_path))

        edge_call = import_mock.query.call_args_list[-1]  # last call is the edge MERGE
        assert "DOCS" in edge_call[0][0]


class TestCommitGraphExport:
    def test_commit_skips_when_no_changes(self, tmp_path):
        """commit_graph_export returns skipped=True when file is unchanged in git."""
        import subprocess
        # Init a git repo
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "test@test"], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "Test"], capture_output=True, check=True)
        # Create and commit the export file
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        export_file.parent.mkdir(parents=True, exist_ok=True)
        export_file.write_text('{"version":"1","nodes":[],"edges":[]}')
        subprocess.run(["git", "-C", str(tmp_path), "add", EXPORT_FILE_RELATIVE], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "commit", "-m", "init"], capture_output=True, check=True)

        # No changes — should skip
        result = commit_graph_export(str(tmp_path))
        assert result.get("skipped") is True
        assert result["committed"] is False

    def test_commit_succeeds_when_file_changed(self, tmp_path):
        """commit_graph_export commits when _graph/edges.json has new content."""
        import subprocess
        # Init a git repo with initial commit
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "test@test"], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "Test"], capture_output=True, check=True)
        readme = tmp_path / "README.md"
        readme.write_text("# test")
        subprocess.run(["git", "-C", str(tmp_path), "add", "."], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "commit", "-m", "init"], capture_output=True, check=True)

        # Write a new export file (untracked)
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        export_file.parent.mkdir(parents=True, exist_ok=True)
        export_file.write_text('{"version":"1","nodes":[{"page_id":"p1"}],"edges":[]}')

        # Should commit (push will fail since no remote, but commit succeeds)
        result = commit_graph_export(str(tmp_path))
        assert result["committed"] is True
        assert "sha" in result

    def test_commit_detects_content_change(self, tmp_path):
        """commit_graph_export detects when file content changes after initial commit."""
        import subprocess
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "test@test"], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "Test"], capture_output=True, check=True)
        export_file = tmp_path / EXPORT_FILE_RELATIVE
        export_file.parent.mkdir(parents=True, exist_ok=True)
        export_file.write_text('{"version":"1","nodes":[],"edges":[]}')
        subprocess.run(["git", "-C", str(tmp_path), "add", "."], capture_output=True, check=True)
        subprocess.run(["git", "-C", str(tmp_path), "commit", "-m", "init"], capture_output=True, check=True)

        # Modify the file
        export_file.write_text('{"version":"1","nodes":[{"page_id":"new"}],"edges":[]}')

        result = commit_graph_export(str(tmp_path))
        assert result["committed"] is True
