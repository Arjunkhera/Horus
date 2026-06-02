"""
Tests for write-page flat-UUID path derivation.

Flat-UUID redesign: write-page always writes to pages/<uuid>.md regardless
of the input path.  The branch is derived from the UUID (vault/write-<short-uuid>-...)
rather than the legacy path-based name.

Supersedes the old prefix-stripping tests (Bug 47c4f206), which are updated
here to verify the new flat-UUID behavior.
"""

import pytest
import re
from unittest.mock import MagicMock, patch

from src.api.routes import _write_page_sync
from src.api.models import WritePageRequest
from src.layer2.schema import SchemaLoader


# A valid page with a fixed UUID so tests are deterministic.
_TEST_UUID = "12345678-1234-4234-8234-123456789abc"

VALID_CONTENT_WITH_UUID = f"""---
type: repo-profile
title: Foo Repo
id: {_TEST_UUID}
description: A test repository for unit testing write-page flat-UUID path handling
scope:
  repo: foo
  program: test-program
mode: reference
tags: [test]
owner: tester
---
# Foo Repo

Test content.
"""

VALID_CONTENT_NO_UUID = """---
type: repo-profile
title: Bar Repo
description: A page without a pre-existing UUID
scope:
  repo: bar
  program: test-program
mode: reference
tags: [test]
owner: tester
---
# Bar Repo

Test content.
"""


@pytest.fixture
def mock_loader():
    loader = MagicMock(spec=SchemaLoader)
    loader.page_types = {"repo-profile": MagicMock()}
    validator_result = MagicMock()
    validator_result.valid = True
    validator_result.errors = []
    with patch("src.api.routes.PageValidator") as MockValidator:
        MockValidator.return_value.validate.return_value = validator_result
        yield loader


@pytest.fixture
def mock_settings():
    settings = MagicMock()
    settings.github_token = "fake-token"
    settings.github_repo = "owner/repo"
    settings.github_base_branch = "main"
    settings.knowledge_repo_path = "/fake/repo"
    return settings


def _run(path, content, mock_loader, mock_settings):
    request = WritePageRequest(path=path, content=content)
    with patch("src.api.routes.PageValidator") as MockValidator, \
         patch("src.api.routes.GitWriter") as MockWriter:
        validator_result = MagicMock()
        validator_result.valid = True
        validator_result.errors = []
        MockValidator.return_value.validate.return_value = validator_result
        MockWriter.return_value.write_page.return_value = ("https://github.com/pr/1", "abc123")
        response = _write_page_sync(request, mock_loader, mock_settings)
        call_args = MockWriter.return_value.write_page.call_args
        return call_args, response


class TestWritePageFlatUUID:
    """Flat-UUID path derivation: page is always written to pages/<uuid>.md."""

    def test_known_uuid_writes_to_flat_path(self, mock_loader, mock_settings):
        """Page with known UUID is written to pages/<uuid>.md."""
        call_args, response = _run("repos/foo.md", VALID_CONTENT_WITH_UUID, mock_loader, mock_settings)
        page_path = call_args.kwargs.get("page_path") or call_args[1].get("page_path") or call_args[0][0]
        assert page_path == f"pages/{_TEST_UUID}.md"

    def test_shared_prefix_input_still_writes_to_flat_path(self, mock_loader, mock_settings):
        """Even if caller passes 'shared/repos/foo.md', page goes to pages/<uuid>.md."""
        call_args, response = _run("shared/repos/foo.md", VALID_CONTENT_WITH_UUID, mock_loader, mock_settings)
        page_path = call_args.kwargs.get("page_path") or call_args[1].get("page_path") or call_args[0][0]
        assert page_path == f"pages/{_TEST_UUID}.md"

    def test_workspace_prefix_input_still_writes_to_flat_path(self, mock_loader, mock_settings):
        """Even if caller passes 'workspace/docs/bar.md', page goes to pages/<uuid>.md."""
        call_args, response = _run("workspace/docs/bar.md", VALID_CONTENT_WITH_UUID, mock_loader, mock_settings)
        page_path = call_args.kwargs.get("page_path") or call_args[1].get("page_path") or call_args[0][0]
        assert page_path == f"pages/{_TEST_UUID}.md"

    def test_response_path_is_flat_uuid_path(self, mock_loader, mock_settings):
        """WritePageResponse.path reflects the flat UUID path."""
        _, response = _run("repos/foo.md", VALID_CONTENT_WITH_UUID, mock_loader, mock_settings)
        assert response.path == f"pages/{_TEST_UUID}.md"

    def test_auto_generated_uuid_produces_valid_flat_path(self, mock_loader, mock_settings):
        """Page without UUID gets one auto-stamped; resulting path is pages/<new-uuid>.md."""
        _, response = _run("repos/new.md", VALID_CONTENT_NO_UUID, mock_loader, mock_settings)
        assert response.path.startswith("pages/")
        assert response.path.endswith(".md")
        # Extracted UUID should be a valid v4 UUID
        uuid_part = response.path[len("pages/"):-len(".md")]
        assert re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            uuid_part,
            re.IGNORECASE,
        ), f"Expected UUIDv4 path, got: {response.path}"

    def test_branch_name_derived_from_uuid(self, mock_loader, mock_settings):
        """Branch name uses UUID short prefix: vault/write-<8chars>-<timestamp>."""
        call_args, _ = _run("repos/foo.md", VALID_CONTENT_WITH_UUID, mock_loader, mock_settings)
        branch = call_args.kwargs.get("branch") or call_args[1].get("branch") or call_args[0][2]
        assert branch.startswith("vault/write-"), f"Branch should start with 'vault/write-', got: {branch}"
        # Short UUID is first 8 chars of our test UUID
        assert _TEST_UUID[:8] in branch, f"Branch should contain UUID prefix, got: {branch}"


def _run_with_store(content, mock_loader, mock_settings, store, vault_namespace="default"):
    """Run _write_page_sync with an injected (vault-scoped) store and return it."""
    request = WritePageRequest(path="repos/foo.md", content=content)
    with patch("src.api.routes.PageValidator") as MockValidator, \
         patch("src.api.routes.GitWriter") as MockWriter:
        validator_result = MagicMock()
        validator_result.valid = True
        validator_result.errors = []
        MockValidator.return_value.validate.return_value = validator_result
        MockWriter.return_value.write_page.return_value = ("https://github.com/pr/1", "abc123")
        response = _write_page_sync(
            request, mock_loader, mock_settings,
            store=store, vault_namespace=vault_namespace,
        )
        return response


class TestWritePageIndexOnWrite:
    """Index-on-write: a successful write upserts the page into the (vault-scoped)
    search engine immediately so it is searchable without waiting for PR merge +
    the periodic reindex. This is what makes provisioned per-vault pages
    searchable (they have no per-vault sync loop)."""

    def test_write_upserts_into_search_index(self, mock_loader, mock_settings):
        """The page is upserted to the injected store at pages/<uuid>.md."""
        store = MagicMock()
        response = _run_with_store(VALID_CONTENT_WITH_UUID, mock_loader, mock_settings, store)
        store.upsert_document.assert_called_once()
        args, _ = store.upsert_document.call_args
        assert args[0] == f"pages/{_TEST_UUID}.md"
        # The content passed is the full page markdown (used to build the doc).
        assert "Foo Repo" in args[1]
        assert response.path == f"pages/{_TEST_UUID}.md"

    def test_write_uses_vault_scoped_store(self, mock_loader, mock_settings):
        """For a provisioned vault, the upsert goes to the vault-scoped store
        (get_store_override hands write_page a per-vault engine), so the doc lands
        in the right collection."""
        vault_store = MagicMock()
        _run_with_store(
            VALID_CONTENT_WITH_UUID, mock_loader, mock_settings,
            vault_store, vault_namespace="vault-office",
        )
        vault_store.upsert_document.assert_called_once()

    def test_index_on_write_failure_does_not_fail_write(self, mock_loader, mock_settings):
        """A failing upsert must not break the write (the PR was already opened)."""
        store = MagicMock()
        store.upsert_document.side_effect = RuntimeError("typesense down")
        # Should not raise — fire-and-forget.
        response = _run_with_store(VALID_CONTENT_WITH_UUID, mock_loader, mock_settings, store)
        assert response.pr_url == "https://github.com/pr/1"

    def test_no_store_is_tolerated(self, mock_loader, mock_settings):
        """When no store is injected, write still succeeds (no index step)."""
        response = _run_with_store(VALID_CONTENT_WITH_UUID, mock_loader, mock_settings, store=None)
        assert response.path == f"pages/{_TEST_UUID}.md"
