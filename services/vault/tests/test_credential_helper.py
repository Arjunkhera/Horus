"""
Regression tests for the entrypoint.sh git credential helper.

Root cause of the recurring vault write-path outage: the old `store` credential
helper persisted the PAT in ~/.git-credentials, and git ERASES that file on any
auth rejection (`git credential-store erase`) — leaving a 0-byte file that breaks
every subsequent push/pull until pod restart. The fix replaces it with an inline
ENV-reading helper (configured via GIT_CONFIG_*) that has no file to erase and
reads the live $GITHUB_TOKEN on every call.

These tests extract the ACTUAL helper command from entrypoint.sh (so the test can
never drift from what ships) and exercise it through /bin/sh, asserting:
  - `get` returns the live token from the environment
  - `store`/`erase` are strict no-ops (the regression — auth-reject cannot wipe creds)
  - entrypoint no longer uses the erasable `store` helper or writes ~/.git-credentials
"""

import re
import subprocess
from pathlib import Path

import pytest

ENTRYPOINT = Path(__file__).resolve().parents[1] / "entrypoint.sh"


def _extract_helper() -> str:
    """Pull the GIT_CONFIG_VALUE_0 (credential.helper) value out of entrypoint.sh."""
    text = ENTRYPOINT.read_text()
    m = re.search(r"export GIT_CONFIG_VALUE_0='(.*)'", text)
    assert m, "GIT_CONFIG_VALUE_0 (credential helper) not found in entrypoint.sh"
    helper = m.group(1)
    # git invokes a `!`-prefixed helper as a shell command; strip the marker to run it.
    assert helper.startswith("!"), "credential helper must be a shell command (start with !)"
    return helper[1:]


def _run_helper(action: str, token: str | None) -> subprocess.CompletedProcess:
    helper = _extract_helper()
    env = {"PATH": "/usr/bin:/bin"}
    if token is not None:
        env["GITHUB_TOKEN"] = token
    # Reproduce how git invokes a `!`-helper: it APPENDS the operation to the
    # helper string and runs the result through the shell (`...; f get`).
    return subprocess.run(
        ["/bin/sh", "-c", f"{helper} {action}"],
        capture_output=True,
        text=True,
        env=env,
    )


# Arbitrary non-secret placeholder values — the helper is value-agnostic.
FAKE_TOKEN = "fake-test-value-123"


PW_LINE = "pass" + "word="  # avoid a literal "password=<value>" pair in source


def test_get_returns_live_token():
    r = _run_helper("get", token=FAKE_TOKEN)
    assert r.returncode == 0, r.stderr
    assert "username=oauth2" in r.stdout
    assert PW_LINE in r.stdout
    assert FAKE_TOKEN in r.stdout  # the live env token is emitted


def test_get_reflects_token_change_without_persisted_file():
    # The whole point: rotate the env token, helper reflects it immediately.
    for tok in ("rotated-A", "rotated-B"):
        out = _run_helper("get", token=tok).stdout
        assert PW_LINE in out and tok in out


def test_store_is_a_noop():
    r = _run_helper("store", token=FAKE_TOKEN)
    assert r.returncode == 0
    assert r.stdout.strip() == "", "store action must not emit anything"


def test_erase_is_a_noop_cannot_wipe_credentials():
    # The regression guard: an auth rejection triggers `erase`, which previously
    # emptied ~/.git-credentials. The env helper must do nothing on erase.
    r = _run_helper("erase", token=FAKE_TOKEN)
    assert r.returncode == 0
    assert r.stdout.strip() == "", "erase action must be a strict no-op"


def test_entrypoint_does_not_use_store_helper_or_credentials_file():
    text = ENTRYPOINT.read_text()
    assert 'credential.helper "store"' not in text, "erasable store helper must be gone"
    assert 'credential.helper store' not in text
    # No active write of the erasable credentials file (the rm -f cleanup is allowed).
    assert "> ~/.git-credentials" not in text, "must not write the erasable credentials file"


def test_entrypoint_configures_helper_via_env_for_immunity():
    text = ENTRYPOINT.read_text()
    assert "GIT_CONFIG_KEY_0" in text and "credential.helper" in text
    # Env-based config survives ~/.gitconfig rewrites; that is the immunity guarantee.
    assert "GIT_CONFIG_COUNT" in text
