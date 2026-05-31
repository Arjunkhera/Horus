"""
Tests for GitWriter default-branch detection (Defect 5).

GitWriter previously hardcoded "master" as the base branch; operator-created
repos use "main" by default.  The fix detects the actual default branch from
the cloned repo using git symbolic-ref / rev-parse.

Uses a real temporary git repo (via pytest's tmp_path) so the git commands
execute against a real local repo.  httpx is mocked to avoid network calls.
"""

import subprocess
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from src.layer2.git_writer import GitWriter


# ── helpers ──────────────────────────────────────────────────────────────────

def _git(*args: str, cwd: Path) -> str:
    """Run a git command in cwd, return stripped stdout."""
    result = subprocess.run(
        ["git"] + list(args),
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _make_bare_repo(path: Path) -> None:
    """Initialise a bare git repo (acts as remote origin)."""
    _git("init", "--bare", str(path), cwd=path.parent)


def _make_repo(path: Path, default_branch: str) -> None:
    """
    Initialise a non-bare git repo with one commit on `default_branch`.
    Simulates an auto_init repo whose default branch is either "main" or "master".
    """
    _git("init", f"--initial-branch={default_branch}", str(path), cwd=path.parent)
    _git("config", "user.email", "test@test.com", cwd=path)
    _git("config", "user.name", "Test", cwd=path)
    (path / "README.md").write_text("# test\n")
    _git("add", "README.md", cwd=path)
    _git("commit", "-m", "init", cwd=path)


def _clone_repo(src: Path, dst: Path) -> None:
    """Clone src into dst and set up remote HEAD tracking."""
    _git("clone", str(src), str(dst), cwd=dst.parent)
    _git("config", "user.email", "test@test.com", cwd=dst)
    _git("config", "user.name", "Test", cwd=dst)
    # Ensure origin/HEAD is resolved so symbolic-ref works.
    try:
        _git("remote", "set-head", "origin", "--auto", cwd=dst)
    except subprocess.CalledProcessError:
        pass  # older git may not support this; fall through to detection


def _make_fake_httpx_post(pr_url: str = "https://github.com/owner/repo/pull/1") -> MagicMock:
    """Return a mock that mimics httpx.post with a successful 201 PR response."""
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"html_url": pr_url}

    mock_post = MagicMock(return_value=mock_response)
    return mock_post


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def main_repo(tmp_path: Path):
    """
    Returns a cloned repo whose default branch is 'main'.
    Layout: tmp_path/bare (bare origin) + tmp_path/clone (working copy).
    """
    bare = tmp_path / "bare"
    bare.mkdir()
    clone = tmp_path / "clone"
    clone.mkdir()

    # Create a source repo on 'main', then bare-clone it as origin.
    src = tmp_path / "src"
    src.mkdir()
    _make_repo(src, "main")

    # Bare clone → acts as origin.
    _git("clone", "--bare", str(src), str(bare), cwd=tmp_path)

    # Working clone from the bare origin.
    _git("clone", str(bare), str(clone), cwd=tmp_path)
    _git("config", "user.email", "test@test.com", cwd=clone)
    _git("config", "user.name", "Test", cwd=clone)
    try:
        _git("remote", "set-head", "origin", "--auto", cwd=clone)
    except subprocess.CalledProcessError:
        pass

    return clone


@pytest.fixture()
def master_repo(tmp_path: Path):
    """
    Returns a cloned repo whose default branch is 'master'.
    """
    bare = tmp_path / "bare"
    bare.mkdir()
    clone = tmp_path / "clone"
    clone.mkdir()

    src = tmp_path / "src"
    src.mkdir()
    _make_repo(src, "master")

    _git("clone", "--bare", str(src), str(bare), cwd=tmp_path)
    _git("clone", str(bare), str(clone), cwd=tmp_path)
    _git("config", "user.email", "test@test.com", cwd=clone)
    _git("config", "user.name", "Test", cwd=clone)
    try:
        _git("remote", "set-head", "origin", "--auto", cwd=clone)
    except subprocess.CalledProcessError:
        pass

    return clone


# ── tests ─────────────────────────────────────────────────────────────────────

class TestDetectDefaultBranch:
    """Unit tests for _detect_default_branch."""

    def test_detects_main(self, main_repo: Path):
        writer = GitWriter(
            repo_path=str(main_repo),
            github_token="tok",
            github_repo="owner/repo",
            base_branch="master",  # deliberately wrong config
        )
        assert writer._detect_default_branch() == "main"

    def test_detects_master(self, master_repo: Path):
        writer = GitWriter(
            repo_path=str(master_repo),
            github_token="tok",
            github_repo="owner/repo",
            base_branch="master",
        )
        assert writer._detect_default_branch() == "master"

    def test_falls_back_to_configured_base_branch_when_detection_fails(self, tmp_path: Path):
        """A repo with no remote HEAD → falls back to self.base_branch."""
        bare_repo = tmp_path / "repo"
        bare_repo.mkdir()
        # Plain local repo, no remote → detection will fail.
        _make_repo(bare_repo, "master")

        writer = GitWriter(
            repo_path=str(bare_repo),
            github_token="tok",
            github_repo="owner/repo",
            base_branch="my-custom-branch",
        )
        assert writer._detect_default_branch() == "my-custom-branch"


class TestWritePageDefaultBranch:
    """Integration-level tests: write_page uses detected branch, not config value."""

    def test_write_page_uses_main_branch(self, main_repo: Path):
        """When repo default is 'main', write_page checks out 'main' and PR targets 'main'."""
        captured_pr_base: list[str] = []

        def fake_post(url, json=None, headers=None, timeout=None):
            if json:
                captured_pr_base.append(json.get("base", ""))
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {"html_url": "https://github.com/owner/repo/pull/42"}
            return mock_resp

        writer = GitWriter(
            repo_path=str(main_repo),
            github_token="tok",
            github_repo="owner/repo",
            base_branch="master",  # wrong config — detection should override
        )

        with patch("httpx.post", side_effect=fake_post):
            pr_url, commit_sha = writer.write_page(
                page_path="test-page.md",
                content="# Test\n\nSome content.\n",
                branch="feat/test-branch",
                commit_message="chore(test): add test page",
                pr_title="Test PR",
                pr_body="Testing default-branch detection",
            )

        assert pr_url == "https://github.com/owner/repo/pull/42"
        assert commit_sha  # non-empty SHA
        assert captured_pr_base == ["main"], (
            f"PR base should be 'main' but was {captured_pr_base!r}"
        )

        # After write_page the repo should be back on 'main'.
        current_branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=main_repo)
        assert current_branch == "main"

    def test_write_page_uses_master_branch(self, master_repo: Path):
        """When repo default is 'master', write_page targets 'master' (backward-compat)."""
        captured_pr_base: list[str] = []

        def fake_post(url, json=None, headers=None, timeout=None):
            if json:
                captured_pr_base.append(json.get("base", ""))
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {"html_url": "https://github.com/owner/repo/pull/1"}
            return mock_resp

        writer = GitWriter(
            repo_path=str(master_repo),
            github_token="tok",
            github_repo="owner/repo",
            base_branch="master",
        )

        with patch("httpx.post", side_effect=fake_post):
            pr_url, commit_sha = writer.write_page(
                page_path="test-page.md",
                content="# Test\n\nSome content.\n",
                branch="feat/test-branch-master",
                commit_message="chore(test): add test page",
                pr_title="Test PR",
                pr_body="Testing master branch",
            )

        assert pr_url == "https://github.com/owner/repo/pull/1"
        assert captured_pr_base == ["master"]

        current_branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=master_repo)
        assert current_branch == "master"
