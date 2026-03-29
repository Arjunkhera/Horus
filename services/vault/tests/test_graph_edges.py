"""
Unit tests for layer2/graph_edges.py.

Covers:
- EdgeType.from_str() — valid and invalid inputs
- create_edge() — mock graph, verify correct Cypher params
- get_edges() — mock graph, verify response format
- traverse_graph() — mock graph, verify depth limit in query
"""

import pytest
from unittest.mock import MagicMock, call

from src.layer2.graph_edges import (
    EdgeType,
    EdgeProperties,
    Edge,
    create_edge,
    get_edges,
    delete_edge,
    traverse_graph,
)


# ============================================================================
# EdgeType.from_str()
# ============================================================================

class TestEdgeTypeFromStr:
    def test_valid_lowercase(self):
        assert EdgeType.from_str("depends_on") == EdgeType.DEPENDS_ON

    def test_valid_uppercase(self):
        assert EdgeType.from_str("PART_OF") == EdgeType.PART_OF

    def test_valid_mixed_case(self):
        assert EdgeType.from_str("Sends_To") == EdgeType.SENDS_TO

    def test_valid_docs(self):
        assert EdgeType.from_str("docs") == EdgeType.DOCS

    def test_valid_related(self):
        assert EdgeType.from_str("related") == EdgeType.RELATED

    def test_invalid_raises_value_error(self):
        with pytest.raises(ValueError) as exc_info:
            EdgeType.from_str("INVALID_TYPE")
        assert "Invalid edge type" in str(exc_info.value)
        assert "INVALID_TYPE" in str(exc_info.value)

    def test_empty_string_raises_value_error(self):
        with pytest.raises(ValueError):
            EdgeType.from_str("")

    def test_error_message_lists_valid_types(self):
        with pytest.raises(ValueError) as exc_info:
            EdgeType.from_str("UNKNOWN")
        error_msg = str(exc_info.value)
        assert "PART_OF" in error_msg
        assert "DEPENDS_ON" in error_msg


# ============================================================================
# EdgeProperties.to_dict()
# ============================================================================

class TestEdgeProperties:
    def test_empty_props_returns_empty_dict(self):
        props = EdgeProperties()
        assert props.to_dict() == {}

    def test_mechanism_only(self):
        props = EdgeProperties(mechanism="kafka-topic")
        assert props.to_dict() == {"mechanism": "kafka-topic"}

    def test_role_only(self):
        props = EdgeProperties(role="producer")
        assert props.to_dict() == {"role": "producer"}

    def test_both_fields(self):
        props = EdgeProperties(mechanism="sqs-queue", role="consumer")
        assert props.to_dict() == {"mechanism": "sqs-queue", "role": "consumer"}

    def test_extra_fields_included(self):
        props = EdgeProperties(extra={"weight": 0.9})
        assert props.to_dict() == {"weight": 0.9}

    def test_all_fields(self):
        props = EdgeProperties(mechanism="grpc", role="client", extra={"version": "v1"})
        result = props.to_dict()
        assert result == {"mechanism": "grpc", "role": "client", "version": "v1"}


# ============================================================================
# create_edge()
# ============================================================================

class TestCreateEdge:
    def _make_graph(self):
        graph = MagicMock()
        graph.query = MagicMock(return_value=[])
        return graph

    def test_returns_true_on_success(self):
        graph = self._make_graph()
        edge = Edge(source_id="page-a", target_id="page-b", edge_type=EdgeType.DEPENDS_ON)
        result = create_edge(graph, edge)
        assert result is True

    def test_calls_graph_query_once(self):
        graph = self._make_graph()
        edge = Edge(source_id="page-a", target_id="page-b", edge_type=EdgeType.DEPENDS_ON)
        create_edge(graph, edge)
        assert graph.query.call_count == 1

    def test_passes_correct_params(self):
        graph = self._make_graph()
        edge = Edge(
            source_id="repos/anvil.md",
            target_id="repos/vault.md",
            edge_type=EdgeType.DEPENDS_ON,
            properties=EdgeProperties(mechanism="http"),
        )
        create_edge(graph, edge)
        _, kwargs_or_args = graph.query.call_args[0], graph.query.call_args
        # call_args is (args, kwargs); we called positionally
        call_args = graph.query.call_args[0]
        cypher, params = call_args[0], call_args[1]
        assert "DEPENDS_ON" in cypher
        assert "MERGE" in cypher
        assert params["source_id"] == "repos/anvil.md"
        assert params["target_id"] == "repos/vault.md"
        assert params["props"] == {"mechanism": "http"}

    def test_empty_props_passed_as_empty_dict(self):
        graph = self._make_graph()
        edge = Edge(source_id="a", target_id="b", edge_type=EdgeType.RELATED)
        create_edge(graph, edge)
        params = graph.query.call_args[0][1]
        assert params["props"] == {}

    def test_cypher_uses_correct_edge_type_label(self):
        for edge_type in EdgeType:
            graph = self._make_graph()
            edge = Edge(source_id="x", target_id="y", edge_type=edge_type)
            create_edge(graph, edge)
            cypher = graph.query.call_args[0][0]
            assert edge_type.value in cypher


# ============================================================================
# get_edges()
# ============================================================================

class TestGetEdges:
    def _make_graph(self, results=None):
        graph = MagicMock()
        graph.query = MagicMock(return_value=results or [])
        return graph

    def test_returns_empty_list_when_no_edges(self):
        graph = self._make_graph([])
        result = get_edges(graph, "page-a")
        assert result == []

    def test_response_format_has_required_keys(self):
        raw = [
            {"target_id": "page-b", "edge_type": "DEPENDS_ON", "props": {"mechanism": "http"}},
        ]
        graph = self._make_graph(raw)
        edges = get_edges(graph, "page-a")
        assert len(edges) == 1
        edge = edges[0]
        assert "target_id" in edge
        assert "edge_type" in edge
        assert "properties" in edge

    def test_response_values_match_query_result(self):
        raw = [
            {"target_id": "repos/vault.md", "edge_type": "PART_OF", "props": {}},
        ]
        graph = self._make_graph(raw)
        edges = get_edges(graph, "repos/anvil.md")
        assert edges[0]["target_id"] == "repos/vault.md"
        assert edges[0]["edge_type"] == "PART_OF"
        assert edges[0]["properties"] == {}

    def test_without_edge_type_filter_uses_unfiltered_cypher(self):
        graph = self._make_graph()
        get_edges(graph, "page-a")
        cypher = graph.query.call_args[0][0]
        # Unfiltered query should not have a specific type label in the rel pattern
        assert "[r]->" in cypher or "[r]->" in cypher.replace(" ", "")

    def test_with_edge_type_filter_uses_typed_cypher(self):
        graph = self._make_graph()
        get_edges(graph, "page-a", EdgeType.DEPENDS_ON)
        cypher = graph.query.call_args[0][0]
        assert "DEPENDS_ON" in cypher

    def test_props_defaults_to_empty_dict_when_missing(self):
        raw = [
            {"target_id": "page-b", "edge_type": "RELATED"},
            # no "props" key
        ]
        graph = self._make_graph(raw)
        edges = get_edges(graph, "page-a")
        assert edges[0]["properties"] == {}

    def test_multiple_edges_returned(self):
        raw = [
            {"target_id": "page-b", "edge_type": "DEPENDS_ON", "props": {}},
            {"target_id": "page-c", "edge_type": "RELATED", "props": {}},
        ]
        graph = self._make_graph(raw)
        edges = get_edges(graph, "page-a")
        assert len(edges) == 2


# ============================================================================
# delete_edge()
# ============================================================================

class TestDeleteEdge:
    def test_returns_true(self):
        graph = MagicMock()
        graph.query = MagicMock(return_value=[])
        result = delete_edge(graph, "page-a", "page-b", EdgeType.DEPENDS_ON)
        assert result is True

    def test_calls_query_with_correct_params(self):
        graph = MagicMock()
        graph.query = MagicMock(return_value=[])
        delete_edge(graph, "page-a", "page-b", EdgeType.SENDS_TO)
        cypher, params = graph.query.call_args[0]
        assert "SENDS_TO" in cypher
        assert "DELETE" in cypher
        assert params["source_id"] == "page-a"
        assert params["target_id"] == "page-b"


# ============================================================================
# traverse_graph()
# ============================================================================

class TestTraverseGraph:
    def _make_graph(self, results=None):
        graph = MagicMock()
        graph.query = MagicMock(return_value=results or [])
        return graph

    def test_returns_empty_list_when_no_results(self):
        graph = self._make_graph([])
        result = traverse_graph(graph, "page-a")
        assert result == []

    def test_default_depth_used_in_query(self):
        graph = self._make_graph()
        traverse_graph(graph, "page-a")
        cypher = graph.query.call_args[0][0]
        assert "*1..3" in cypher

    def test_custom_depth_in_query(self):
        graph = self._make_graph()
        traverse_graph(graph, "page-a", max_depth=5)
        cypher = graph.query.call_args[0][0]
        assert "*1..5" in cypher

    def test_edge_type_filter_included_in_query(self):
        graph = self._make_graph()
        traverse_graph(graph, "page-a", edge_types=[EdgeType.DEPENDS_ON, EdgeType.PART_OF])
        cypher = graph.query.call_args[0][0]
        assert "DEPENDS_ON" in cypher
        assert "PART_OF" in cypher

    def test_no_edge_type_filter_uses_generic_rel(self):
        graph = self._make_graph()
        traverse_graph(graph, "page-a")
        cypher = graph.query.call_args[0][0]
        # Generic pattern: [r*1..N] — no specific type label
        assert "[r*1.." in cypher

    def test_response_format(self):
        raw = [
            {"page_id": "page-b", "page_type": "guide", "mode": "operational"},
        ]
        graph = self._make_graph(raw)
        result = traverse_graph(graph, "page-a")
        assert len(result) == 1
        assert result[0]["page_id"] == "page-b"
        assert result[0]["type"] == "guide"
        assert result[0]["mode"] == "operational"

    def test_start_id_passed_as_param(self):
        graph = self._make_graph()
        traverse_graph(graph, "repos/anvil.md")
        params = graph.query.call_args[0][1]
        assert params["start_id"] == "repos/anvil.md"

    def test_none_type_and_mode_in_result(self):
        """page_type and mode may be None for nodes without those properties."""
        raw = [
            {"page_id": "page-b"},
        ]
        graph = self._make_graph(raw)
        result = traverse_graph(graph, "page-a")
        assert result[0]["type"] is None
        assert result[0]["mode"] is None
