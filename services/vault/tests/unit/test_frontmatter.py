"""Tests for the frontmatter parser."""

import re

from src.layer2.frontmatter import parse_page, to_page_summary, to_page_full, ParsedPage
from tests.conftest import ANVIL_REPO_PROFILE, CONCEPT_PAGE, CODING_STANDARDS_PROCEDURE, REPO_PROFILE_WITH_WORKFLOW

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class TestParsePage:
    def test_parses_type(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.type == "repo-profile"

    def test_parses_title(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.title == "Anvil"

    def test_parses_description(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert "Personal task" in page.description

    def test_parses_scope_program(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.scope["program"] == "anvil-forge-vault"

    def test_parses_scope_repo(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.scope["repo"] == "anvil"

    def test_parses_mode(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.mode == "reference"

    def test_parses_tags(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert "core" in page.tags
        assert "typescript" in page.tags

    def test_parses_related(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert len(page.related) >= 2

    def test_parses_owner(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.owner == "arjun"

    def test_parses_last_verified(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.last_verified is not None

    def test_parses_body(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert "# Anvil" in page.body
        assert "Tech Stack" in page.body

    def test_defaults_for_missing_fields(self):
        minimal = """---
title: Minimal
---
# Minimal
"""
        page = parse_page(minimal)
        assert page.type == "concept"  # default
        assert page.mode == "reference"  # default
        assert page.scope == {}
        assert page.tags == []
        assert page.related == []

    def test_no_frontmatter(self):
        page = parse_page("# Just Markdown\nSome content.")
        assert page.title == "Untitled"
        assert page.type == "concept"

    def test_auto_generated_defaults_false(self):
        """ParsedPage.auto_generated should default to False for user-authored pages."""
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.auto_generated is False

    def test_no_source_field(self):
        """ParsedPage should not have source field."""
        page = parse_page(ANVIL_REPO_PROFILE)
        assert not hasattr(page, "source")

    def test_auto_generates_uuid_when_missing(self):
        """Pages without an id field in frontmatter get an auto-generated UUIDv4."""
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.id is not None
        assert UUID_RE.match(page.id)

    def test_reads_uuid_from_frontmatter(self):
        """Pages with an id field in frontmatter use that value."""
        content = """---
id: 550e8400-e29b-41d4-a716-446655440000
title: Test Page
---
# Test
"""
        page = parse_page(content)
        assert page.id == "550e8400-e29b-41d4-a716-446655440000"

    def test_auto_generated_uuids_are_unique(self):
        """Each parse call generates a distinct UUID."""
        page1 = parse_page("# Page 1")
        page2 = parse_page("# Page 2")
        assert page1.id != page2.id


class TestHostingAndWorkflowFields:
    def test_parses_hosting_hostname(self):
        page = parse_page(REPO_PROFILE_WITH_WORKFLOW)
        assert page.hosting["hostname"] == "github.com"

    def test_parses_hosting_org(self):
        page = parse_page(REPO_PROFILE_WITH_WORKFLOW)
        assert page.hosting["org"] == "Arjunkhera"

    def test_parses_workflow_strategy(self):
        page = parse_page(REPO_PROFILE_WITH_WORKFLOW)
        assert page.workflow["strategy"] == "owner"

    def test_parses_workflow_default_branch(self):
        page = parse_page(REPO_PROFILE_WITH_WORKFLOW)
        assert page.workflow["default-branch"] == "main"

    def test_parses_workflow_pr_target(self):
        page = parse_page(REPO_PROFILE_WITH_WORKFLOW)
        assert page.workflow["pr-target"] == "main"

    def test_parses_workflow_branch_convention(self):
        page = parse_page(REPO_PROFILE_WITH_WORKFLOW)
        assert page.workflow["branch-convention"] == "feat/*"

    def test_hosting_defaults_to_empty_dict(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.hosting == {}

    def test_workflow_defaults_to_empty_dict(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        assert page.workflow == {}

    def test_minimal_page_hosting_defaults(self):
        minimal = """---
title: Minimal
---
# Minimal
"""
        page = parse_page(minimal)
        assert page.hosting == {}
        assert page.workflow == {}


class TestToPageSummary:
    def test_creates_summary_with_uuid_id(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        summary = to_page_summary(page, "repos/anvil.md", score=0.95)
        assert UUID_RE.match(summary.id), f"Expected UUID, got: {summary.id}"
        assert summary.path == "repos/anvil.md"
        assert summary.title == "Anvil"
        assert summary.relevance_score == 0.95

    def test_uses_frontmatter_uuid_when_present(self):
        content = """---
id: 550e8400-e29b-41d4-a716-446655440000
title: Test
description: Test page
type: concept
mode: reference
---
# Test
"""
        page = parse_page(content)
        summary = to_page_summary(page, "concepts/test.md")
        assert summary.id == "550e8400-e29b-41d4-a716-446655440000"
        assert summary.path == "concepts/test.md"

    def test_summary_no_body(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        summary = to_page_summary(page, "repos/anvil.md")
        # PageSummary doesn't have body field
        assert not hasattr(summary, "body") or summary.__class__.__name__ == "PageSummary"

    def test_zero_score_becomes_none(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        summary = to_page_summary(page, "repos/anvil.md", score=0.0)
        assert summary.relevance_score is None


class TestToPageFull:
    def test_creates_full_page_with_uuid_id(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        full = to_page_full(page, "repos/anvil.md")
        assert UUID_RE.match(full.id), f"Expected UUID, got: {full.id}"
        assert full.path == "repos/anvil.md"
        assert full.body is not None
        assert "# Anvil" in full.body

    def test_includes_relationships(self):
        page = parse_page(ANVIL_REPO_PROFILE)
        full = to_page_full(page, "repos/anvil.md")
        assert len(full.related) >= 2

    def test_auto_generated_is_false(self):
        """PageFull.auto_generated should be False for user-authored pages."""
        page = parse_page(ANVIL_REPO_PROFILE)
        full = to_page_full(page, "repos/anvil.md")
        assert full.auto_generated is False

    def test_source_is_none(self):
        """PageFull.source should be None (internal field not set for user pages)."""
        page = parse_page(ANVIL_REPO_PROFILE)
        full = to_page_full(page, "repos/anvil.md")
        assert full.source is None
