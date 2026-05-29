"""Tests for the vault-registry routing table + live-reload (58aef4ad)."""

import asyncio
import os
import time

from src.registry import parse_registry, VaultRegistry, start_registry_watch

REGISTRY_V1 = """
vaults:
  acme/notes:
    reader_endpoint: http://vault-reader:8000
    writer_endpoint: http://vault-writer:8000
    typesense_collection: acme_notes
    neo4j_db: acme_notes
"""

REGISTRY_V2 = REGISTRY_V1 + """  beta/docs:
    reader_endpoint: http://vault-reader:8000
    writer_endpoint: http://vault-writer:8000
"""


def test_parse_registry_builds_entries():
    table = parse_registry(REGISTRY_V1)
    assert set(table) == {"acme/notes"}
    entry = table["acme/notes"]
    assert entry.resolve(write=False) == "http://vault-reader:8000"
    assert entry.resolve(write=True) == "http://vault-writer:8000"
    assert entry.typesense_collection == "acme_notes"


def test_parse_registry_tolerates_empty():
    assert parse_registry("") == {}
    assert parse_registry("vaults: {}") == {}


def test_parse_registry_defaults_writer_to_reader():
    table = parse_registry(
        "vaults:\n  x/y:\n    reader_endpoint: http://r:8000\n"
    )
    assert table["x/y"].resolve(write=True) == "http://r:8000"


def test_registry_loads_and_resolves(tmp_path):
    f = tmp_path / "registry.yaml"
    f.write_text(REGISTRY_V1)
    reg = VaultRegistry(str(f))
    assert reg.load() is True
    assert reg.resolve("acme/notes", write=False) == "http://vault-reader:8000"
    assert reg.resolve("missing/ns", write=False) is None
    assert reg.namespaces() == ["acme/notes"]


def test_registry_live_reload_on_change(tmp_path):
    f = tmp_path / "registry.yaml"
    f.write_text(REGISTRY_V1)
    reg = VaultRegistry(str(f))
    reg.load()
    assert reg.get("beta/docs") is None

    time.sleep(0.01)
    f.write_text(REGISTRY_V2)
    os.utime(f, None)  # bump mtime

    assert reg.reload_if_changed() is True
    assert reg.get("beta/docs") is not None
    # no further change → no reload
    assert reg.reload_if_changed() is False


def test_missing_file_is_empty_then_recovers(tmp_path):
    f = tmp_path / "registry.yaml"
    reg = VaultRegistry(str(f))
    assert reg.load() is False  # file absent → empty, unchanged
    assert reg.namespaces() == []
    f.write_text(REGISTRY_V1)
    os.utime(f, None)
    assert reg.reload_if_changed() is True
    assert reg.namespaces() == ["acme/notes"]


def test_watch_task_reloads(tmp_path):
    async def run():
        f = tmp_path / "registry.yaml"
        f.write_text(REGISTRY_V1)
        reg = VaultRegistry(str(f))
        task = await start_registry_watch(reg, interval=0.05)
        try:
            assert reg.get("beta/docs") is None
            f.write_text(REGISTRY_V2)
            os.utime(f, None)
            await asyncio.sleep(0.15)  # let the watch loop tick
            assert reg.get("beta/docs") is not None
        finally:
            task.cancel()

    asyncio.run(run())
