"""
Tests for flat-UUID storage redesign.

Covers:
A. Flat path computation — pages/<uuid>.md
B. Bare-UUID Typesense id (_build_document)
C. Full-body indexing — no truncation
D. uuid_registry maps to pages/<uuid>.md
E. get_document resolves bare UUID and flat paths
F. _uuid_to_flat_path helper
"""

import time
import pytest
from unittest.mock import MagicMock, patch
from pathlib import Path

from src.layer1.typesense_engine import TypesenseSearchEngine, _uuid_to_flat_path
from src.layer2.uuid_registry import UUIDRegistry


# ── helpers ───────────────────────────────────────────────────────────────────

_TEST_UUID = "aaaabbbb-cccc-4ddd-aeee-ffffffffffff"
_LONG_BODY = "A" * 25_000  # exceeds old BODY_MAX_CHARS = 20_000

_PAGE_WITH_UUID = f"""---
type: guide
title: Test Guide
id: {_TEST_UUID}
description: A test guide
scope:
  program: test
mode: reference
tags: [test]
---
{_LONG_BODY}
"""

_PAGE_NO_UUID = """---
type: concept
title: No UUID Page
description: Page without a UUID in frontmatter
mode: reference
---
Body of a page without UUID.
"""


# ── Section A/B/C: _build_document ────────────────────────────────────────────

class TestBuildDocument:
    def _make_engine(self) -> TypesenseSearchEngine:
        return TypesenseSearchEngine(collection_paths={"shared": "/fake/root"})

    def _parse(self, content: str):
        from src.layer2.frontmatter import parse_page
        return parse_page(content)

    def test_id_is_bare_uuid_from_frontmatter(self):
        """Typesense doc id == bare frontmatter UUID."""
        engine = self._make_engine()
        parsed = self._parse(_PAGE_WITH_UUID)
        doc = engine._build_document("shared/guides/test.md", parsed)
        assert doc["id"] == _TEST_UUID

    def test_page_uuid_equals_id(self):
        """page_uuid field == id field (backward compat)."""
        engine = self._make_engine()
        parsed = self._parse(_PAGE_WITH_UUID)
        doc = engine._build_document("shared/guides/test.md", parsed)
        assert doc["page_uuid"] == doc["id"]

    def test_fallback_to_file_path_when_no_uuid(self):
        """When no UUID in frontmatter, id falls back to the provided file_path."""
        engine = self._make_engine()
        parsed = self._parse(_PAGE_NO_UUID)
        # parse_page auto-generates a UUID, so override id to empty for this test
        parsed.id = ""
        doc = engine._build_document("shared/concepts/no-id.md", parsed)
        assert doc["id"] == "shared/concepts/no-id.md"

    def test_full_body_indexed_no_truncation(self):
        """Body longer than old BODY_MAX_CHARS (20_000) is indexed in full."""
        engine = self._make_engine()
        parsed = self._parse(_PAGE_WITH_UUID)
        doc = engine._build_document("shared/guides/test.md", parsed)
        # The body in the doc should be the full long body, not truncated.
        assert len(doc["body"]) == len(_LONG_BODY)
        assert doc["body"] == _LONG_BODY

    def test_short_body_unchanged(self):
        """Short body is preserved as-is."""
        engine = self._make_engine()
        parsed = self._parse(_PAGE_WITH_UUID)
        parsed.body = "Short body."
        doc = engine._build_document("shared/guides/test.md", parsed)
        assert doc["body"] == "Short body."

    def test_source_type_from_frontmatter(self):
        engine = self._make_engine()
        parsed = self._parse(_PAGE_WITH_UUID)
        doc = engine._build_document("shared/guides/test.md", parsed)
        assert doc["source_type"] == "guide"


# ── Section D: UUIDRegistry maps to flat paths ────────────────────────────────

class TestUUIDRegistryFlatPaths:
    def test_resolve_returns_flat_path(self, tmp_path: Path):
        """Registry.resolve(uuid) returns pages/<uuid>.md."""
        pages_dir = tmp_path / "pages"
        pages_dir.mkdir()
        md = pages_dir / f"{_TEST_UUID}.md"
        md.write_text(_PAGE_WITH_UUID, encoding="utf-8")

        reg = UUIDRegistry()
        reg.build(str(tmp_path))
        result = reg.resolve(_TEST_UUID)
        assert result == f"pages/{_TEST_UUID}.md"

    def test_lookup_flat_path_returns_uuid(self, tmp_path: Path):
        """Registry.lookup('pages/<uuid>.md') returns UUID."""
        pages_dir = tmp_path / "pages"
        pages_dir.mkdir()
        md = pages_dir / f"{_TEST_UUID}.md"
        md.write_text(_PAGE_WITH_UUID, encoding="utf-8")

        reg = UUIDRegistry()
        reg.build(str(tmp_path))
        result = reg.lookup(f"pages/{_TEST_UUID}.md")
        assert result == _TEST_UUID

    def test_legacy_path_also_registered_as_alias(self, tmp_path: Path):
        """Legacy collection-prefixed path is registered as an alias for backward compat."""
        # Simulate a page under shared/guides/ (legacy layout)
        guides_dir = tmp_path / "guides"
        guides_dir.mkdir()
        md = guides_dir / "test.md"
        md.write_text(_PAGE_WITH_UUID, encoding="utf-8")

        reg = UUIDRegistry()
        reg.build(str(tmp_path), collection_paths={"shared": str(tmp_path)})
        # Canonical path resolves
        assert reg.resolve(_TEST_UUID) == f"pages/{_TEST_UUID}.md"
        # Legacy alias also resolves to the UUID
        assert reg.lookup("shared/guides/test.md") == _TEST_UUID

    def test_page_without_uuid_is_skipped(self, tmp_path: Path):
        """Pages with no UUID (parse_page auto-generates one but file content has none)."""
        pages_dir = tmp_path / "pages"
        pages_dir.mkdir()
        # Page whose parse produces an auto-generated UUID — that UUID won't
        # match any filename; registry should still register it using the parsed id.
        md = pages_dir / "no-uuid.md"
        md.write_text(_PAGE_NO_UUID, encoding="utf-8")

        reg = UUIDRegistry()
        reg.build(str(tmp_path))
        # The auto-generated UUID is registered (we can't know its value,
        # but count should be 1).
        assert reg.count() == 1

    def test_register_updates_both_maps(self):
        reg = UUIDRegistry()
        reg.register(_TEST_UUID, f"pages/{_TEST_UUID}.md")
        assert reg.resolve(_TEST_UUID) == f"pages/{_TEST_UUID}.md"
        assert reg.lookup(f"pages/{_TEST_UUID}.md") == _TEST_UUID


# ── Section E: get_document resolves flat and UUID paths ──────────────────────

class TestGetDocumentFlatUUID:
    def _make_engine_with_root(self, root: Path) -> TypesenseSearchEngine:
        return TypesenseSearchEngine(collection_paths={"shared": str(root)})

    def test_flat_path_resolved_against_store_root(self, tmp_path: Path):
        pages_dir = tmp_path / "pages"
        pages_dir.mkdir()
        md = pages_dir / f"{_TEST_UUID}.md"
        md.write_text("# content", encoding="utf-8")

        engine = self._make_engine_with_root(tmp_path)
        result = engine.get_document(f"pages/{_TEST_UUID}.md")
        assert result == "# content"

    def test_bare_uuid_resolved_to_flat_path(self, tmp_path: Path):
        pages_dir = tmp_path / "pages"
        pages_dir.mkdir()
        md = pages_dir / f"{_TEST_UUID}.md"
        md.write_text("UUID content", encoding="utf-8")

        engine = self._make_engine_with_root(tmp_path)
        result = engine.get_document(_TEST_UUID)
        assert result == "UUID content"

    def test_missing_flat_path_returns_none(self, tmp_path: Path):
        engine = self._make_engine_with_root(tmp_path)
        result = engine.get_document(f"pages/nonexistent-{_TEST_UUID}.md")
        assert result is None

    def test_legacy_collection_prefixed_path_still_works(self, tmp_path: Path):
        """Backward compat: 'shared/guides/foo.md' still resolves."""
        guides_dir = tmp_path / "guides"
        guides_dir.mkdir()
        md = guides_dir / "foo.md"
        md.write_text("legacy content", encoding="utf-8")

        engine = self._make_engine_with_root(tmp_path)
        result = engine.get_document("shared/guides/foo.md")
        assert result == "legacy content"


# ── Section F: _uuid_to_flat_path helper ──────────────────────────────────────

class TestUuidToFlatPath:
    def test_valid_uuid_returns_flat_path(self):
        assert _uuid_to_flat_path(_TEST_UUID) == f"pages/{_TEST_UUID}.md"

    def test_non_uuid_returned_unchanged(self):
        assert _uuid_to_flat_path("shared/repos/horus.md") == "shared/repos/horus.md"

    def test_already_flat_path_returned_unchanged(self):
        fp = f"pages/{_TEST_UUID}.md"
        assert _uuid_to_flat_path(fp) == fp  # not a UUID itself

    def test_empty_string_returned_unchanged(self):
        assert _uuid_to_flat_path("") == ""

    def test_uuid_v4_pattern_required(self):
        """Only proper UUIDv4 triggers the flat-path conversion."""
        # Not a v4 UUID (version nibble is '1', not '4')
        non_v4 = "aaaabbbb-cccc-1ddd-aeee-ffffffffffff"
        assert _uuid_to_flat_path(non_v4) == non_v4
