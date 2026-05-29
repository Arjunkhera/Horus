"""Tests for Vault Reader/Writer mode + write guard (#8)."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.service_mode import (
    get_vault_mode,
    is_reader,
    should_run_sync,
    install_read_only_guard,
)


def test_get_vault_mode_defaults_to_writer():
    assert get_vault_mode({}) == "writer"
    assert get_vault_mode({"VAULT_MODE": "writer"}) == "writer"


def test_get_vault_mode_reader_case_insensitive():
    assert get_vault_mode({"VAULT_MODE": "reader"}) == "reader"
    assert get_vault_mode({"VAULT_MODE": "READER"}) == "reader"
    assert is_reader("reader") and not is_reader("writer")


def test_should_run_sync_only_for_writer():
    assert should_run_sync("writer") is True
    assert should_run_sync("reader") is False


def _app():
    app = FastAPI()

    @app.post("/write-page")
    async def write_page():
        return {"ok": True}

    @app.post("/reindex")
    async def reindex():
        return {"ok": True}

    @app.post("/search")
    async def search():
        return {"hits": []}

    return app


def test_reader_guard_rejects_writes_allows_reads():
    app = _app()
    assert install_read_only_guard(app, "reader") is True
    client = TestClient(app)
    assert client.post("/write-page").status_code == 503
    assert client.post("/reindex").status_code == 503
    assert client.post("/search").status_code == 200  # reads pass through
    assert client.post("/write-page").json()["error"]["code"] == "READER_WRITE_REJECTED"


def test_writer_installs_no_guard():
    app = _app()
    assert install_read_only_guard(app, "writer") is False
    client = TestClient(app)
    assert client.post("/write-page").status_code == 200  # no guard on a writer
