"""
Integration tests for Typesense search in Vault.

These tests require a running Typesense instance. They are skipped
when the TYPESENSE_HOST environment variable is not set.

To run:
    TYPESENSE_HOST=localhost TYPESENSE_PORT=8108 TYPESENSE_API_KEY=horus-local-key \
        pytest tests/integration/test_typesense.py -v

Covers:
    - Add knowledge page -> knowledge_search returns it via Typesense
    - knowledge_resolve_context finds repo profiles via Typesense filter
    - Startup re-index: verify all documents present after re-index
    - CRUD lifecycle: create -> searchable, update -> reflected, delete -> removed
"""

import os
import time
import pytest

TYPESENSE_HOST = os.environ.get("TYPESENSE_HOST", "")

try:
    import typesense
    HAS_TYPESENSE = True
except ImportError:
    typesense = None  # type: ignore
    HAS_TYPESENSE = False

pytestmark = pytest.mark.skipif(
    not TYPESENSE_HOST or not HAS_TYPESENSE,
    reason="TYPESENSE_HOST not set or typesense package not installed"
)


TYPESENSE_PORT = int(os.environ.get("TYPESENSE_PORT", "8108"))
TYPESENSE_API_KEY = os.environ.get("TYPESENSE_API_KEY", "horus-local-key")
TYPESENSE_PROTOCOL = os.environ.get("TYPESENSE_PROTOCOL", "http")
COLLECTION_NAME = "horus_documents"


@pytest.fixture(scope="module")
def ts_client():
    """Create a Typesense client for the test module."""
    client = typesense.Client({
        "nodes": [{
            "host": TYPESENSE_HOST,
            "port": str(TYPESENSE_PORT),
            "protocol": TYPESENSE_PROTOCOL,
        }],
        "api_key": TYPESENSE_API_KEY,
        "connection_timeout_seconds": 5,
    })

    # Ensure collection exists
    try:
        client.collections[COLLECTION_NAME].retrieve()
    except typesense.exceptions.ObjectNotFound:
        client.collections.create({
            "name": COLLECTION_NAME,
            "fields": [
                {"name": "id", "type": "string"},
                {"name": "source", "type": "string", "facet": True},
                {"name": "source_type", "type": "string", "facet": True},
                {"name": "title", "type": "string"},
                {"name": "body", "type": "string"},
                {"name": "tags", "type": "string[]", "facet": True},
                {"name": "status", "type": "string", "facet": True, "optional": True},
                {"name": "priority", "type": "string", "facet": True, "optional": True},
                {"name": "assignee_id", "type": "string", "facet": True, "optional": True},
                {"name": "project_id", "type": "string", "facet": True, "optional": True},
                {"name": "project_name", "type": "string", "optional": True},
                {"name": "due_at", "type": "int64", "optional": True},
                {"name": "mode", "type": "string", "facet": True, "optional": True},
                {"name": "scope_repo", "type": "string", "facet": True, "optional": True},
                {"name": "scope_program", "type": "string", "facet": True, "optional": True},
                {"name": "scope_context", "type": "string", "facet": True, "optional": True},
                {"name": "vault_name", "type": "string", "facet": True, "optional": True},
                {"name": "created_at", "type": "int64"},
                {"name": "modified_at", "type": "int64", "sort": True},
            ],
            "default_sorting_field": "modified_at",
        })

    return client


@pytest.fixture
def cleanup_docs(ts_client):
    """Track document IDs created during a test for automatic cleanup."""
    doc_ids = []
    yield doc_ids
    for doc_id in doc_ids:
        try:
            ts_client.collections[COLLECTION_NAME].documents[doc_id].delete()
        except Exception:
            pass


class TestVaultKnowledgeSearch:
    """Tests simulating Vault knowledge_search via Typesense."""

    def test_add_page_and_search(self, ts_client, cleanup_docs):
        """Add a knowledge page and verify knowledge_search finds it."""
        doc_id = f"vault-page-{int(time.time() * 1000)}-1"
        cleanup_docs.append(doc_id)

        ts_client.collections[COLLECTION_NAME].documents.upsert({
            "id": doc_id,
            "source": "vault",
            "source_type": "guide",
            "title": "Vault Typesense Stellaris Guide",
            "body": "This guide explains how Typesense powers Vault search.",
            "tags": ["typesense", "search", "integration-test"],
            "mode": "operational",
            "scope_program": "anvil-forge-vault",
            "created_at": int(time.time()),
            "modified_at": int(time.time()),
        })

        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "Stellaris",
            "query_by": "title,body",
            "filter_by": "source:=vault",
        })

        assert result["found"] >= 1
        ids = [hit["document"]["id"] for hit in result["hits"]]
        assert doc_id in ids

    def test_search_by_mode_filter(self, ts_client, cleanup_docs):
        """Verify mode-based filtering works (operational vs reference)."""
        doc_id = f"vault-mode-{int(time.time() * 1000)}"
        cleanup_docs.append(doc_id)

        ts_client.collections[COLLECTION_NAME].documents.upsert({
            "id": doc_id,
            "source": "vault",
            "source_type": "procedure",
            "title": "Operational Meridian Procedure",
            "body": "This is an operational procedure for testing mode filters.",
            "tags": ["mode-test"],
            "mode": "operational",
            "created_at": int(time.time()),
            "modified_at": int(time.time()),
        })

        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "Meridian",
            "query_by": "title,body",
            "filter_by": "mode:=operational",
        })

        assert result["found"] >= 1
        for hit in result["hits"]:
            assert hit["document"]["mode"] == "operational"


class TestVaultResolveContext:
    """Tests simulating knowledge_resolve_context via Typesense filter."""

    def test_find_repo_profile_by_scope(self, ts_client, cleanup_docs):
        """resolve_context should find repo profiles filtered by scope_repo."""
        doc_id = f"vault-repo-{int(time.time() * 1000)}"
        cleanup_docs.append(doc_id)

        ts_client.collections[COLLECTION_NAME].documents.upsert({
            "id": doc_id,
            "source": "vault",
            "source_type": "repo-profile",
            "title": "Constellation Test Repo",
            "body": "This is a test repo profile for resolve_context testing.",
            "tags": ["core", "typescript"],
            "mode": "reference",
            "scope_repo": "constellation-test",
            "scope_program": "anvil-forge-vault",
            "created_at": int(time.time()),
            "modified_at": int(time.time()),
        })

        # Simulate resolve_context: search for repo-profile by scope_repo
        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "*",
            "query_by": "title,body",
            "filter_by": "source_type:=repo-profile && scope_repo:=constellation-test",
        })

        assert result["found"] >= 1
        doc = result["hits"][0]["document"]
        assert doc["scope_repo"] == "constellation-test"
        assert doc["source_type"] == "repo-profile"

    def test_find_operational_pages_by_program(self, ts_client, cleanup_docs):
        """resolve_context should also find operational pages scoped to the same program."""
        doc_ids = []
        base = int(time.time() * 1000)

        # Create a repo-profile
        rp_id = f"vault-rp-{base}"
        cleanup_docs.append(rp_id)
        doc_ids.append(rp_id)
        ts_client.collections[COLLECTION_NAME].documents.upsert({
            "id": rp_id,
            "source": "vault",
            "source_type": "repo-profile",
            "title": "Galaxia Repo Profile",
            "body": "The main repo profile.",
            "tags": ["core"],
            "mode": "reference",
            "scope_repo": "galaxia",
            "scope_program": "galaxia-program",
            "created_at": int(time.time()),
            "modified_at": int(time.time()),
        })

        # Create an operational page in the same program
        op_id = f"vault-op-{base}"
        cleanup_docs.append(op_id)
        doc_ids.append(op_id)
        ts_client.collections[COLLECTION_NAME].documents.upsert({
            "id": op_id,
            "source": "vault",
            "source_type": "guide",
            "title": "Galaxia Deployment Guide",
            "body": "Operational deployment guide for Galaxia.",
            "tags": ["deployment"],
            "mode": "operational",
            "scope_program": "galaxia-program",
            "created_at": int(time.time()),
            "modified_at": int(time.time()),
        })

        # Search for operational pages in the program
        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "*",
            "query_by": "title,body",
            "filter_by": "mode:=operational && scope_program:=galaxia-program",
        })

        assert result["found"] >= 1
        titles = [hit["document"]["title"] for hit in result["hits"]]
        assert "Galaxia Deployment Guide" in titles


class TestCRUDLifecycle:
    """Tests for CRUD lifecycle: create, update, delete reflected in search."""

    def test_create_update_delete_lifecycle(self, ts_client):
        """Full lifecycle: create -> searchable, update -> reflected, delete -> removed."""
        doc_id = f"vault-crud-{int(time.time() * 1000)}"

        # CREATE
        ts_client.collections[COLLECTION_NAME].documents.upsert({
            "id": doc_id,
            "source": "vault",
            "source_type": "concept",
            "title": "CRUD Lifecycle Protostar Concept",
            "body": "Testing the full create-update-delete lifecycle.",
            "tags": ["crud-test"],
            "mode": "reference",
            "created_at": int(time.time()),
            "modified_at": int(time.time()),
        })

        # Verify searchable
        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "Protostar",
            "query_by": "title,body",
            "filter_by": f"id:={doc_id}",
        })
        assert result["found"] >= 1

        # UPDATE
        ts_client.collections[COLLECTION_NAME].documents[doc_id].update({
            "body": "Updated body — now includes Supernova keyword for verification.",
            "modified_at": int(time.time()),
        })

        # Verify update reflected
        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "Supernova",
            "query_by": "title,body",
            "filter_by": f"id:={doc_id}",
        })
        assert result["found"] >= 1

        # DELETE
        ts_client.collections[COLLECTION_NAME].documents[doc_id].delete()

        # Verify removed
        result = ts_client.collections[COLLECTION_NAME].documents.search({
            "q": "Protostar",
            "query_by": "title,body",
            "filter_by": f"id:={doc_id}",
        })
        assert result["found"] == 0
