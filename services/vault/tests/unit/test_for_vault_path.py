"""Per-vault filesystem-root scoping.

Regression guard for the bug where a non-default vault's Typesense collection
stayed empty: for_vault() reused the default collection_paths, so reindex/
get_document read /data/knowledge-repo instead of the per-vault clone.
"""
from unittest.mock import MagicMock

from src.layer1.typesense_engine import TypesenseSearchEngine
from src.layer2.vault_repo_resolver import VaultRepoResolver


class TestForVaultCollectionPaths:
    def test_inherits_base_paths_without_override(self):
        base = TypesenseSearchEngine(collection_paths={"shared": "/data/knowledge-repo"})
        scoped = base.for_vault("vault_code", "vault-code")
        assert scoped._collection_paths == {"shared": "/data/knowledge-repo"}

    def test_uses_per_vault_paths_when_overridden(self):
        base = TypesenseSearchEngine(collection_paths={"shared": "/data/knowledge-repo"})
        per_vault = {"shared": "/data/vaults/vault-code/knowledge-repo"}
        scoped = base.for_vault("vault_code", "vault-code", per_vault)
        assert scoped._collection_paths == per_vault
        assert scoped._collection_name == "vault_code"
        assert scoped._vault_name == "vault-code"

    def test_shares_client(self):
        base = TypesenseSearchEngine(collection_paths={"shared": "/x"})
        base._client = MagicMock()
        scoped = base.for_vault("vault_code", "vault-code", {"shared": "/y"})
        assert scoped._client is base._client


class TestRepoPath:
    def _resolver(self):
        return VaultRepoResolver(default_repo_path="/data/knowledge-repo", vaults_base="/data/vaults")

    def test_default_namespace_returns_default(self):
        r = self._resolver()
        assert r.repo_path("default") == "/data/knowledge-repo"
        assert r.repo_path("") == "/data/knowledge-repo"

    def test_non_default_returns_per_vault_path(self):
        r = self._resolver()
        assert r.repo_path("vault-code") == "/data/vaults/vault-code/knowledge-repo"

    def test_slug_replaces_slashes(self):
        r = self._resolver()
        assert r.repo_path("org/team") == "/data/vaults/org-team/knowledge-repo"
