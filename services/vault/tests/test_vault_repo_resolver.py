"""
Tests for VaultRepoResolver (layer2/vault_repo_resolver.py).

Covers:
- Default namespace returns the default repo path
- Empty/None namespace falls back to default
- Non-default namespace without git_repo falls back to default
- Non-default namespace with git_repo triggers lazy clone
- Reuses existing clone on subsequent resolves
- Reuses clone from previous pod lifecycle (.git exists on PVC)
"""

import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from src.layer2.vault_repo_resolver import VaultRepoResolver, DEFAULT_NAMESPACE


class TestResolveDefault:
    def test_default_namespace_returns_default_path(self, tmp_path):
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )
        assert resolver.resolve("default") == "/data/knowledge-repo"

    def test_empty_namespace_returns_default_path(self, tmp_path):
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )
        assert resolver.resolve("") == "/data/knowledge-repo"

    def test_none_namespace_returns_default_path(self, tmp_path):
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )
        assert resolver.resolve(None) == "/data/knowledge-repo"


class TestResolveFallback:
    def test_non_default_without_git_repo_falls_back(self, tmp_path):
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )
        result = resolver.resolve("org/tenant-a")
        assert result == "/data/knowledge-repo"


class TestResolveLazyClone:
    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_clones_on_first_resolve(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )

        result = resolver.resolve("org/tenant-a", git_repo="org/tenant-a-kb")

        expected_dir = str(tmp_path / "vaults" / "org-tenant-a" / "knowledge-repo")
        assert result == expected_dir

        # Clone must use a TOKENLESS URL — auth comes from the git credential
        # helper, never the URL (bug 3a561b8b regression guard).
        clone_call = mock_run.call_args_list[0]
        cmd = clone_call[0][0]
        assert cmd[0] == "git"
        assert cmd[1] == "clone"
        assert cmd[2] == "https://github.com/org/tenant-a-kb.git"
        assert "@" not in cmd[2]
        assert "x-access-token" not in cmd[2]
        assert cmd[3] == expected_dir

    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_second_resolve_reuses_cache(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )

        result1 = resolver.resolve("org/tenant-a", git_repo="org/tenant-a-kb")
        result2 = resolver.resolve("org/tenant-a", git_repo="org/tenant-a-kb")

        assert result1 == result2
        # Only one clone call — second resolve hits cache
        assert mock_run.call_count == 1

    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_reuses_existing_clone_on_disk(self, mock_run, tmp_path):
        """Simulates PVC persistence — .git already exists from previous pod."""
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        vaults_base = tmp_path / "vaults"

        # Pre-create the clone directory with .git
        clone_dir = vaults_base / "org-tenant-a" / "knowledge-repo"
        (clone_dir / ".git").mkdir(parents=True)

        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(vaults_base),
        )

        result = resolver.resolve("org/tenant-a", git_repo="org/tenant-a-kb")
        assert result == str(clone_dir)

        # Should git pull (not clone)
        pull_call = mock_run.call_args_list[0]
        cmd = pull_call[0][0]
        assert cmd[:2] == ["git", "-C"]
        assert cmd[3:] == ["pull", "--ff-only"]

    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_clone_url_is_always_tokenless(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )

        resolver.resolve("org/public-vault", git_repo="org/public-kb")

        clone_call = mock_run.call_args_list[0]
        cmd = clone_call[0][0]
        assert cmd[2] == "https://github.com/org/public-kb.git"
        assert "@" not in cmd[2]


class TestEnterpriseGitHubHost:
    """git_host (from GITHUB_API_HOST) controls the clone remote — bug e4904a31."""

    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_clones_from_ghe_host_when_git_host_set(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
            git_host="github.intuit.com",
        )

        resolver.resolve("org/tenant-a", git_repo="org/tenant-a-kb")

        cmd = mock_run.call_args_list[0][0][0]
        # Clones from the GHE host, still tokenless (credential helper supplies auth).
        assert cmd[2] == "https://github.intuit.com/org/tenant-a-kb.git"
        assert "@" not in cmd[2]

    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_empty_git_host_defaults_to_public_github(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        for host in ("", "github.com"):
            resolver = VaultRepoResolver(
                default_repo_path="/data/knowledge-repo",
                vaults_base=str(tmp_path / "vaults" / (host or "empty")),
                git_host=host,
            )
            resolver.resolve("org/tenant-a", git_repo="org/tenant-a-kb")
            cmd = mock_run.call_args_list[-1][0][0]
            assert cmd[2] == "https://github.com/org/tenant-a-kb.git"

    @patch("src.layer2.vault_repo_resolver.subprocess.run")
    def test_slug_replaces_slashes(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        resolver = VaultRepoResolver(
            default_repo_path="/data/knowledge-repo",
            vaults_base=str(tmp_path / "vaults"),
        )

        result = resolver.resolve("my-org/deep/vault", git_repo="org/kb")
        assert "my-org-deep-vault" in result
