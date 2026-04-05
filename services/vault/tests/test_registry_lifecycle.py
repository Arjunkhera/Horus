"""
Tests for registry lifecycle changes (story b0e37ad3):
- SchemaLoader._serialize_registry() returns valid YAML without writing to disk
- RegistryAddRequest accepts via_pr field
- RegistryAddResponse includes pr_url field
- _persist_registry() still works (uses _serialize_registry internally)
"""

import sys
import tempfile
import yaml
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from layer2.schema import SchemaLoader, RegistryEntry


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_schema_dir(tmp_path: Path) -> Path:
    """Create a minimal _schema directory with empty registries."""
    schema_dir = tmp_path / "_schema"
    reg_dir = schema_dir / "registries"
    reg_dir.mkdir(parents=True)

    for name in ("repos", "tags", "programs"):
        (reg_dir / f"{name}.yaml").write_text(
            yaml.dump({name: []}, default_flow_style=False)
        )

    return schema_dir


def _make_loader(tmp_path: Path) -> SchemaLoader:
    schema_dir = _make_schema_dir(tmp_path)
    loader = SchemaLoader(str(schema_dir))
    loader.load()
    return loader


# ---------------------------------------------------------------------------
# _serialize_registry tests
# ---------------------------------------------------------------------------

def test_serialize_registry_returns_string(tmp_path):
    loader = _make_loader(tmp_path)
    result = loader._serialize_registry("repos")
    assert isinstance(result, str)


def test_serialize_registry_empty(tmp_path):
    loader = _make_loader(tmp_path)
    result = loader._serialize_registry("repos")
    data = yaml.safe_load(result)
    assert data == {"repos": []}


def test_serialize_registry_with_entry(tmp_path):
    loader = _make_loader(tmp_path)
    loader.add_registry_entry("repos", RegistryEntry(
        id="horus",
        description="Horus monorepo",
        aliases=["vault", "anvil", "forge"],
    ))
    result = loader._serialize_registry("repos")
    data = yaml.safe_load(result)
    assert len(data["repos"]) == 1
    entry = data["repos"][0]
    assert entry["id"] == "horus"
    assert entry["description"] == "Horus monorepo"
    assert entry["aliases"] == ["vault", "anvil", "forge"]


def test_serialize_registry_omits_empty_aliases(tmp_path):
    loader = _make_loader(tmp_path)
    loader.add_registry_entry("repos", RegistryEntry(id="simple", description="No aliases"))
    result = loader._serialize_registry("repos")
    data = yaml.safe_load(result)
    entry = data["repos"][0]
    assert "aliases" not in entry


def test_serialize_registry_does_not_write_file(tmp_path):
    loader = _make_loader(tmp_path)
    reg_file = tmp_path / "_schema" / "registries" / "repos.yaml"
    mtime_before = reg_file.stat().st_mtime

    loader._serialize_registry("repos")

    assert reg_file.stat().st_mtime == mtime_before, "_serialize_registry must not write to disk"


def test_persist_registry_still_writes_file(tmp_path):
    loader = _make_loader(tmp_path)
    loader.add_registry_entry("repos", RegistryEntry(id="test-repo", description="Test"))

    schema_dir = tmp_path / "_schema"
    reg_file = schema_dir / "registries" / "repos.yaml"
    data = yaml.safe_load(reg_file.read_text())
    assert any(e["id"] == "test-repo" for e in data["repos"])


# ---------------------------------------------------------------------------
# Model field tests
# ---------------------------------------------------------------------------

def test_registry_add_request_via_pr_defaults_false():
    from api.models import RegistryAddRequest, RegistryEntryModel
    req = RegistryAddRequest(
        registry="repos",
        entry=RegistryEntryModel(id="x"),
    )
    assert req.via_pr is False


def test_registry_add_request_via_pr_true():
    from api.models import RegistryAddRequest, RegistryEntryModel
    req = RegistryAddRequest(
        registry="repos",
        entry=RegistryEntryModel(id="x"),
        via_pr=True,
    )
    assert req.via_pr is True


def test_registry_add_response_pr_url_optional():
    from api.models import RegistryAddResponse, RegistryEntryModel
    resp = RegistryAddResponse(
        added=True,
        registry="repos",
        entry=RegistryEntryModel(id="x"),
        total_entries=1,
    )
    assert resp.pr_url is None


def test_registry_add_response_pr_url_set():
    from api.models import RegistryAddResponse, RegistryEntryModel
    resp = RegistryAddResponse(
        added=True,
        registry="repos",
        entry=RegistryEntryModel(id="x"),
        total_entries=1,
        pr_url="https://github.com/org/repo/pull/42",
    )
    assert resp.pr_url == "https://github.com/org/repo/pull/42"
