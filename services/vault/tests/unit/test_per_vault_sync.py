"""
Tests for the per-vault sync loop (multi-vault search indexing).

Provisioned vaults each have their own clone under /data/vaults/<slug>/knowledge-repo
and their own Typesense collection. The default vault is kept current by the
git-pull loop; nothing pulled or reindexed per-vault clones, so merged pages in
provisioned vaults were never searchable. per_vault_sync_loop closes that gap.
"""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.sync.daemon import (
    namespace_slug,
    _read_vault_namespace,
    per_vault_sync_loop,
    ReindexLock,
)
from src.layer1.typesense_engine import TypesenseSearchEngine
from src.layer2.vault_repo_resolver import VAULT_NAMESPACE_MARKER


class TestNamespaceSlug:
    """namespace_slug must match the operator-service collection-name convention."""

    def test_flat_namespace(self):
        assert namespace_slug("vault-office") == "vault_office"

    def test_owner_slash_vault(self):
        assert namespace_slug("acme/handbook") == "acme_handbook"

    def test_collapses_and_trims(self):
        assert namespace_slug("--Foo..Bar--") == "Foo_Bar"

    def test_default(self):
        assert namespace_slug("default") == "default"


class TestReadVaultNamespace:
    def test_reads_marker(self, tmp_path: Path):
        vd = tmp_path / "acme-handbook"
        vd.mkdir()
        (vd / VAULT_NAMESPACE_MARKER).write_text("acme/handbook\n")
        assert _read_vault_namespace(vd) == "acme/handbook"

    def test_falls_back_to_dir_name(self, tmp_path: Path):
        vd = tmp_path / "vault-office"
        vd.mkdir()
        assert _read_vault_namespace(vd) == "vault-office"


def _make_vault_clone(base: Path, dir_slug: str, namespace: str | None = None) -> Path:
    """Create a fake per-vault clone with a .git dir (and optional namespace marker)."""
    repo = base / dir_slug / "knowledge-repo"
    (repo / ".git").mkdir(parents=True)
    if namespace is not None:
        (base / dir_slug / VAULT_NAMESPACE_MARKER).write_text(namespace + "\n")
    return repo


class _StopLoop(Exception):
    pass


@pytest.mark.asyncio
async def test_per_vault_loop_reindexes_each_clone_on_first_pass(tmp_path: Path):
    """First pass reindexes every clone on disk, scoped to its own collection."""
    repo_office = _make_vault_clone(tmp_path, "vault-office", "vault-office")
    _make_vault_clone(tmp_path, "acme-handbook", "acme/handbook")

    base_store = TypesenseSearchEngine(
        collection_paths={"shared": "/data/knowledge-repo"},
        collection_name="horus_documents",
        vault_name="default",
    )
    scoped = MagicMock(name="scoped-engine")
    with patch.object(base_store, "for_vault", return_value=scoped) as mock_for_vault, \
         patch("src.sync.daemon._git_pull_ff", new=AsyncMock(return_value="uptodate")), \
         patch("src.sync.daemon.asyncio.sleep", new=AsyncMock(side_effect=_StopLoop)):
        lock = ReindexLock()
        lock.reindex = AsyncMock(return_value=True)
        with pytest.raises(_StopLoop):
            await per_vault_sync_loop(base_store, str(tmp_path), interval=1, reindex_lock=lock)

    # for_vault called once per clone, with (collection, namespace, {shared: clone})
    calls = {c.args[1]: c.args for c in mock_for_vault.call_args_list}
    assert set(calls) == {"vault-office", "acme/handbook"}
    assert calls["vault-office"][0] == "vault_office"
    assert calls["vault-office"][2] == {"shared": str(repo_office)}
    assert calls["acme/handbook"][0] == "acme_handbook"
    # reindex invoked for each scoped engine
    assert lock.reindex.await_count == 2


@pytest.mark.asyncio
async def test_per_vault_loop_skips_unchanged_after_first_pass(tmp_path: Path):
    """After the first pass, a clone is reindexed only when git pull reports new commits."""
    _make_vault_clone(tmp_path, "vault-office", "vault-office")

    base_store = TypesenseSearchEngine(
        collection_paths={"shared": "/data/knowledge-repo"},
        collection_name="horus_documents",
        vault_name="default",
    )
    # Break out on the SECOND sleep (i.e. after first pass + one steady-state pass).
    sleeper = AsyncMock(side_effect=[None, _StopLoop])
    with patch.object(base_store, "for_vault", return_value=MagicMock()), \
         patch("src.sync.daemon._git_pull_ff", new=AsyncMock(return_value="uptodate")), \
         patch("src.sync.daemon.asyncio.sleep", new=sleeper):
        lock = ReindexLock()
        lock.reindex = AsyncMock(return_value=True)
        with pytest.raises(_StopLoop):
            await per_vault_sync_loop(base_store, str(tmp_path), interval=1, reindex_lock=lock)

    # First pass reindexes (1). Second pass: pull 'uptodate' → no reindex. Total 1.
    assert lock.reindex.await_count == 1


@pytest.mark.asyncio
async def test_per_vault_loop_reindexes_on_change(tmp_path: Path):
    """A clone that receives new commits is reindexed in steady state."""
    _make_vault_clone(tmp_path, "vault-office", "vault-office")
    base_store = TypesenseSearchEngine(
        collection_paths={"shared": "/data/knowledge-repo"},
        collection_name="horus_documents",
        vault_name="default",
    )
    sleeper = AsyncMock(side_effect=[None, _StopLoop])
    with patch.object(base_store, "for_vault", return_value=MagicMock()), \
         patch("src.sync.daemon._git_pull_ff", new=AsyncMock(return_value="changed")), \
         patch("src.sync.daemon.asyncio.sleep", new=sleeper):
        lock = ReindexLock()
        lock.reindex = AsyncMock(return_value=True)
        with pytest.raises(_StopLoop):
            await per_vault_sync_loop(base_store, str(tmp_path), interval=1, reindex_lock=lock)

    # First pass (1) + steady-state pass with 'changed' (1) = 2.
    assert lock.reindex.await_count == 2


@pytest.mark.asyncio
async def test_per_vault_loop_noop_for_non_typesense_store():
    """The loop is a no-op when the base store is not a TypesenseSearchEngine."""
    # Returns immediately (no infinite loop, no sleep patch needed).
    await per_vault_sync_loop(MagicMock(), "/data/vaults", interval=1, reindex_lock=ReindexLock())
