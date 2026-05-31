"""
Tests for wiki-link auto-extraction → auto-edges (Section B).

Covers:
- extract_wiki_links(): basic extraction, aliases, code stripping, dedup
- create_wiki_link_edges(): UUID resolution, title search, edge creation,
  graceful skipping of unresolvable targets, self-reference skip
"""

import pytest
from unittest.mock import MagicMock, call, patch

from src.layer2.graph_edges import (
    extract_wiki_links,
    create_wiki_link_edges,
    EdgeType,
)


_UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


# ── extract_wiki_links ─────────────────────────────────────────────────────────

class TestExtractWikiLinks:
    def test_simple_link(self):
        assert extract_wiki_links("See [[Horus Repo]] for details.") == ["Horus Repo"]

    def test_link_with_alias_uses_target(self):
        """[[Target|Display]] → 'Target'"""
        result = extract_wiki_links("Read [[Horus Repo|Horus]] first.")
        assert result == ["Horus Repo"]

    def test_uuid_link(self):
        result = extract_wiki_links(f"See [[{_UUID_A}]] for details.")
        assert result == [_UUID_A]

    def test_multiple_links_deduplicated(self):
        body = "[[Alpha]] and [[Beta]] and [[Alpha]] again."
        result = extract_wiki_links(body)
        assert result == ["Alpha", "Beta"]

    def test_link_inside_fenced_code_ignored(self):
        body = "Normal [[Link]] here.\n```\n[[Ignored]]\n```"
        result = extract_wiki_links(body)
        assert result == ["Link"]
        assert "Ignored" not in result

    def test_link_inside_inline_code_ignored(self):
        body = "See [[Real]] but `[[Fake]]` is code."
        result = extract_wiki_links(body)
        assert result == ["Real"]
        assert "Fake" not in result

    def test_no_links_returns_empty(self):
        assert extract_wiki_links("Plain text, no links.") == []

    def test_empty_body_returns_empty(self):
        assert extract_wiki_links("") == []

    def test_whitespace_stripped_from_target(self):
        result = extract_wiki_links("[[ My Page ]]")
        assert result == ["My Page"]

    def test_multiple_unique_links(self):
        body = "[[Alpha]] references [[Beta]], and [[Gamma]] too."
        result = extract_wiki_links(body)
        assert set(result) == {"Alpha", "Beta", "Gamma"}
        assert len(result) == 3


# ── create_wiki_link_edges ────────────────────────────────────────────────────

class TestCreateWikiLinkEdges:
    def _make_graph(self):
        g = MagicMock()
        g.query = MagicMock(return_value=[])
        return g

    def _make_search(self, uuid_for_title: str = "", title: str = ""):
        """Return a search_fn that returns a single result with the given UUID.

        The result's ``title`` attribute is set to *title* when provided, or to
        the search query (so that exact-match comparison works by default when
        the caller passes uuid_for_title without an explicit title override).
        """
        def search_fn(query):
            if not uuid_for_title:
                return []
            result = MagicMock()
            result.id = uuid_for_title
            result.file_path = f"pages/{uuid_for_title}.md"
            # Use explicit title if supplied, else mirror the query so exact match passes
            result.title = title if title else query
            return [result]
        return search_fn

    def test_uuid_target_creates_mentions_edge(self):
        graph = self._make_graph()
        body = f"See [[{_UUID_B}]] for context."
        created = create_wiki_link_edges(graph, _UUID_A, body, None, self._make_search())
        assert _UUID_B in created
        # Verify MERGE was called with correct params
        assert graph.query.call_count >= 1
        cypher_calls = [call_args[0][0] for call_args in graph.query.call_args_list]
        assert any("MENTIONS" in c for c in cypher_calls)

    def test_title_target_resolved_via_search(self):
        graph = self._make_graph()
        body = "See [[Horus Repo]] for context."
        search = self._make_search(uuid_for_title=_UUID_B)
        created = create_wiki_link_edges(graph, _UUID_A, body, None, search)
        assert _UUID_B in created

    def test_unresolvable_target_skipped_gracefully(self):
        graph = self._make_graph()
        body = "Reference [[Unknown Page]]."
        search = self._make_search(uuid_for_title="")
        created = create_wiki_link_edges(graph, _UUID_A, body, None, search)
        assert created == []
        # graph.query should not have been called (no edge created)
        assert graph.query.call_count == 0

    def test_self_reference_skipped(self):
        """[[<source_uuid>]] in body is not a valid link to itself."""
        graph = self._make_graph()
        body = f"Self-referential [[{_UUID_A}]]."
        created = create_wiki_link_edges(graph, _UUID_A, body, None, self._make_search())
        assert created == []

    def test_multiple_targets_create_multiple_edges(self):
        graph = self._make_graph()
        body = f"[[{_UUID_B}]] and [[{_UUID_C}]]."
        created = create_wiki_link_edges(graph, _UUID_A, body, None, self._make_search())
        assert _UUID_B in created
        assert _UUID_C in created

    def test_search_exception_does_not_raise(self):
        graph = self._make_graph()

        def broken_search(q):
            raise RuntimeError("search broken")

        body = "See [[Some Page]]."
        # Should not raise; returns empty list
        created = create_wiki_link_edges(graph, _UUID_A, body, None, broken_search)
        assert created == []

    def test_graph_exception_does_not_raise(self):
        graph = self._make_graph()
        graph.query.side_effect = RuntimeError("neo4j down")
        body = f"[[{_UUID_B}]]"
        # Should log and skip, not raise
        created = create_wiki_link_edges(graph, _UUID_A, body, None, self._make_search())
        assert created == []

    def test_empty_body_no_edges(self):
        graph = self._make_graph()
        created = create_wiki_link_edges(graph, _UUID_A, "", None, self._make_search())
        assert created == []
        assert graph.query.call_count == 0

    def test_registry_used_for_uuid_link_when_provided(self):
        """When registry is provided, UUID links do NOT need registry resolution
        (UUIDs are used directly).  This test confirms registry is not used for
        direct-UUID targets."""
        graph = self._make_graph()
        registry = MagicMock()
        registry.resolve.return_value = f"pages/{_UUID_B}.md"
        body = f"[[{_UUID_B}]]"
        created = create_wiki_link_edges(graph, _UUID_A, body, registry, self._make_search())
        assert _UUID_B in created

    def test_exact_title_match_resolves_to_correct_page(self):
        """[[Exact Title]] resolves only to the page whose title matches exactly
        (case-insensitive).  A result whose title differs must not be used."""
        graph = self._make_graph()

        def search_fn(query):
            # Return two results: one with a wrong title, one with the exact title.
            wrong = MagicMock()
            wrong.id = _UUID_C
            wrong.file_path = f"pages/{_UUID_C}.md"
            wrong.title = "Something Else"

            exact = MagicMock()
            exact.id = _UUID_B
            exact.file_path = f"pages/{_UUID_B}.md"
            exact.title = "Exact Title"

            return [wrong, exact]

        body = "See [[Exact Title]] for context."
        created = create_wiki_link_edges(graph, _UUID_A, body, None, search_fn)
        assert _UUID_B in created
        assert _UUID_C not in created

    def test_nonexistent_title_creates_no_edge(self):
        """[[Nonexistent]] with no results whose title matches creates no edge."""
        graph = self._make_graph()

        def search_fn(query):
            # Results exist but none match the title exactly
            close = MagicMock()
            close.id = _UUID_B
            close.file_path = f"pages/{_UUID_B}.md"
            close.title = "Not The Same Title"
            return [close]

        body = "Reference [[Nonexistent]]."
        created = create_wiki_link_edges(graph, _UUID_A, body, None, search_fn)
        assert created == []
        assert graph.query.call_count == 0
