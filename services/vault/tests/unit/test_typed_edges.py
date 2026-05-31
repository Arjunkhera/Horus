"""
Tests for typed, inverse-labelled edges (Section C).

Covers:
- Intent registry: each EdgeType has an IntentDefinition
- _display_label(): outgoing uses edge_type; incoming directional uses inverse_label;
  incoming bidirectional uses edge_type
- get_edges(): direction field + display_label for each edge
- EdgeType.MENTIONS added with bidirectional intent
- EdgeType.REFERENCES added with directional intent → REFERENCED_BY inverse
"""

import pytest
from unittest.mock import MagicMock

from src.layer2.graph_edges import (
    EdgeType,
    _display_label,
    _INTENT_REGISTRY,
    get_intent,
    get_edges,
    IntentDefinition,
)


_PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_PAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


# ── Intent registry ───────────────────────────────────────────────────────────

class TestIntentRegistry:
    def test_all_edge_types_have_intent(self):
        """Every EdgeType value has a corresponding IntentDefinition."""
        for et in EdgeType:
            intent = get_intent(et.value)
            assert intent is not None, f"EdgeType {et.value} has no intent registered"

    def test_mentions_is_bidirectional(self):
        intent = get_intent("MENTIONS")
        assert intent is not None
        assert intent.direction == "bidirectional"
        assert intent.inverse_label is None

    def test_references_is_directional_with_inverse(self):
        intent = get_intent("REFERENCES")
        assert intent is not None
        assert intent.direction == "directional"
        assert intent.inverse_label == "REFERENCED_BY"

    def test_part_of_has_inverse_contains(self):
        intent = get_intent("PART_OF")
        assert intent.direction == "directional"
        assert intent.inverse_label == "CONTAINS"

    def test_depends_on_has_inverse_required_by(self):
        intent = get_intent("DEPENDS_ON")
        assert intent.inverse_label == "REQUIRED_BY"

    def test_related_is_bidirectional(self):
        intent = get_intent("RELATED")
        assert intent.direction == "bidirectional"
        assert intent.inverse_label is None

    def test_docs_has_inverse(self):
        intent = get_intent("DOCS")
        assert intent.direction == "directional"
        assert intent.inverse_label is not None

    def test_unknown_intent_returns_none(self):
        assert get_intent("UNKNOWN_XYZ") is None


# ── _display_label ────────────────────────────────────────────────────────────

class TestDisplayLabel:
    def test_outgoing_directional_returns_edge_type(self):
        assert _display_label("REFERENCES", "outgoing") == "REFERENCES"

    def test_incoming_directional_returns_inverse(self):
        assert _display_label("REFERENCES", "incoming") == "REFERENCED_BY"

    def test_outgoing_bidirectional_returns_edge_type(self):
        assert _display_label("MENTIONS", "outgoing") == "MENTIONS"

    def test_incoming_bidirectional_returns_edge_type(self):
        """Bidirectional edges have the same label in both directions."""
        assert _display_label("MENTIONS", "incoming") == "MENTIONS"

    def test_incoming_related_same_label(self):
        assert _display_label("RELATED", "incoming") == "RELATED"

    def test_incoming_part_of_returns_contains(self):
        assert _display_label("PART_OF", "incoming") == "CONTAINS"

    def test_incoming_depends_on_returns_required_by(self):
        assert _display_label("DEPENDS_ON", "incoming") == "REQUIRED_BY"

    def test_unknown_edge_type_returns_itself(self):
        """Graceful fallback for edge types not in the intent registry."""
        assert _display_label("LEGACY_EDGE", "incoming") == "LEGACY_EDGE"
        assert _display_label("LEGACY_EDGE", "outgoing") == "LEGACY_EDGE"


# ── get_edges direction/display_label ─────────────────────────────────────────

class TestGetEdgesWithDirection:
    def _make_graph(self, results):
        g = MagicMock()
        g.query = MagicMock(return_value=results)
        return g

    def test_outgoing_edge_has_direction_outgoing(self):
        raw = [{"other_id": _PAGE_B, "edge_type": "REFERENCES", "props": {}, "direction": "outgoing"}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["direction"] == "outgoing"

    def test_incoming_edge_has_direction_incoming(self):
        raw = [{"other_id": _PAGE_B, "edge_type": "REFERENCES", "props": {}, "direction": "incoming"}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["direction"] == "incoming"

    def test_outgoing_directional_display_label_is_edge_type(self):
        raw = [{"other_id": _PAGE_B, "edge_type": "REFERENCES", "props": {}, "direction": "outgoing"}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["display_label"] == "REFERENCES"

    def test_incoming_directional_display_label_is_inverse(self):
        raw = [{"other_id": _PAGE_B, "edge_type": "REFERENCES", "props": {}, "direction": "incoming"}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["display_label"] == "REFERENCED_BY"

    def test_incoming_bidirectional_display_label_is_same(self):
        raw = [{"other_id": _PAGE_B, "edge_type": "MENTIONS", "props": {}, "direction": "incoming"}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["display_label"] == "MENTIONS"

    def test_other_id_and_target_id_both_present(self):
        """Backward-compat: both other_id and target_id carry the endpoint UUID."""
        raw = [{"other_id": _PAGE_B, "edge_type": "DOCS", "props": {}, "direction": "outgoing"}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["other_id"] == _PAGE_B
        assert edges[0]["target_id"] == _PAGE_B

    def test_legacy_result_with_target_id_key(self):
        """Results using old 'target_id' key (mocks/legacy) still work."""
        raw = [{"target_id": _PAGE_B, "edge_type": "RELATED", "props": {}}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["target_id"] == _PAGE_B
        assert edges[0]["other_id"] == _PAGE_B

    def test_direction_defaults_to_outgoing_when_missing(self):
        """Rows without a 'direction' key default to 'outgoing'."""
        raw = [{"target_id": _PAGE_B, "edge_type": "DOCS", "props": {}}]
        graph = self._make_graph(raw)
        edges = get_edges(graph, _PAGE_A)
        assert edges[0]["direction"] == "outgoing"

    def test_cypher_includes_direction_column(self):
        """Verify the Cypher query returns a direction column."""
        graph = self._make_graph([])
        get_edges(graph, _PAGE_A)
        cypher = graph.query.call_args[0][0]
        assert "direction" in cypher

    def test_cypher_includes_outgoing_and_incoming_union(self):
        """Both outgoing and incoming legs appear in the Cypher (UNION)."""
        graph = self._make_graph([])
        get_edges(graph, _PAGE_A)
        cypher = graph.query.call_args[0][0]
        assert "outgoing" in cypher
        assert "incoming" in cypher
        assert "UNION" in cypher.upper()


# ── EdgeType enum includes new values ─────────────────────────────────────────

class TestEdgeTypeEnum:
    def test_mentions_in_enum(self):
        assert EdgeType.MENTIONS.value == "MENTIONS"

    def test_references_in_enum(self):
        assert EdgeType.REFERENCES.value == "REFERENCES"

    def test_from_str_mentions(self):
        assert EdgeType.from_str("mentions") == EdgeType.MENTIONS

    def test_from_str_references(self):
        assert EdgeType.from_str("references") == EdgeType.REFERENCES

    def test_error_message_includes_all_types(self):
        """Error on invalid type should list all current EdgeType values."""
        with pytest.raises(ValueError) as exc_info:
            EdgeType.from_str("INVALID")
        msg = str(exc_info.value)
        assert "MENTIONS" in msg
        assert "REFERENCES" in msg
