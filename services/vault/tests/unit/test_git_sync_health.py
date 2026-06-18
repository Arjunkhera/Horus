"""
Tests for the in-process git-sync health tracker.

The bash pull daemon only writes /tmp/sync-status.json for the default repo's
pull. The Python loops (default git_pull_loop + per_vault_sync_loop) record their
pull outcomes via record_git_pull_result so /health can surface write-path and
per-vault credential failures that were previously invisible (the pod reported
"healthy" while every git push/pull failed — the recurring vault outage).
"""

import pytest

import src.sync.daemon as daemon
from src.sync.daemon import (
    record_git_pull_result,
    get_git_sync_health,
    _is_auth_error,
)


@pytest.fixture(autouse=True)
def _clear_status():
    """Each test starts from an empty tracker."""
    daemon._git_sync_status.clear()
    yield
    daemon._git_sync_status.clear()


def test_empty_status_is_healthy():
    h = get_git_sync_health()
    assert h["ok"] is True
    assert h["auth_failure"] is False
    assert h["failing_repos"] == []


def test_successful_pull_is_healthy():
    record_git_pull_result("/data/knowledge-repo", ok=True)
    h = get_git_sync_health()
    assert h["ok"] is True
    assert h["auth_failure"] is False


@pytest.mark.parametrize(
    "stderr",
    [
        "fatal: could not read Username for 'https://github.com'",
        "fatal: Authentication failed for 'https://github.com/x/y.git'",
        "remote: Invalid username or password.",
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        "fatal: could not read Username for 'https://github.com': No such device or address",
    ],
)
def test_auth_failures_detected(stderr):
    assert _is_auth_error(stderr) is True


def test_non_auth_failure_not_flagged_as_auth():
    record_git_pull_result(
        "/data/knowledge-repo", ok=False, stderr="fatal: not possible to fast-forward, aborting."
    )
    h = get_git_sync_health()
    assert h["ok"] is False  # still degraded — a failure is a failure
    assert h["auth_failure"] is False  # but not an auth failure
    assert "/data/knowledge-repo" in h["failing_repos"]


def test_auth_failure_degrades_health():
    record_git_pull_result(
        "/data/vaults/vault-code/knowledge-repo",
        ok=False,
        stderr="fatal: could not read Username for 'https://github.com'",
    )
    h = get_git_sync_health()
    assert h["ok"] is False
    assert h["auth_failure"] is True
    assert "/data/vaults/vault-code/knowledge-repo" in h["failing_repos"]


def test_recovery_clears_failure():
    repo = "/data/knowledge-repo"
    record_git_pull_result(repo, ok=False, stderr="could not read Username")
    assert get_git_sync_health()["auth_failure"] is True
    record_git_pull_result(repo, ok=True)
    h = get_git_sync_health()
    assert h["ok"] is True
    assert h["auth_failure"] is False


def test_consecutive_failures_increment_then_reset():
    repo = "/data/knowledge-repo"
    record_git_pull_result(repo, ok=False, stderr="could not read Username")
    record_git_pull_result(repo, ok=False, stderr="could not read Username")
    assert daemon._git_sync_status[repo]["consecutive_failures"] == 2
    record_git_pull_result(repo, ok=True)
    assert daemon._git_sync_status[repo]["consecutive_failures"] == 0


def test_one_failing_repo_degrades_overall_even_if_another_is_ok():
    record_git_pull_result("/data/knowledge-repo", ok=True)
    record_git_pull_result(
        "/data/vaults/vault-office/knowledge-repo",
        ok=False,
        stderr="could not read Username",
    )
    h = get_git_sync_health()
    assert h["ok"] is False
    assert h["auth_failure"] is True
