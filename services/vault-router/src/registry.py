"""
vault-registry routing table (58aef4ad).

The operator-service provisioner is the SOLE writer of the vault-registry
ConfigMap; vault-router mounts it as a file and watches it, live-reloading the
routing table on change WITHOUT a restart.

File format (registry.yaml):

    vaults:
      owner/vault:
        reader_endpoint: http://vault-reader:8000
        writer_endpoint: http://vault-writer:8000
        typesense_collection: owner_vault
        neo4j_db: owner_vault
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

import yaml

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VaultEntry:
    namespace: str
    reader_endpoint: str
    writer_endpoint: str
    typesense_collection: Optional[str] = None
    neo4j_db: Optional[str] = None
    git_repo: Optional[str] = None

    def resolve(self, *, write: bool) -> str:
        """Reads go to the reader pool, writes to the single writer."""
        return self.writer_endpoint if write else self.reader_endpoint


def parse_registry(text: str) -> dict[str, VaultEntry]:
    """Parse registry.yaml content into a namespace→VaultEntry table."""
    data = yaml.safe_load(text) or {}
    vaults = data.get("vaults") or {}
    table: dict[str, VaultEntry] = {}
    for namespace, cfg in vaults.items():
        cfg = cfg or {}
        reader = cfg.get("reader_endpoint")
        writer = cfg.get("writer_endpoint", reader)
        if not reader:
            logger.warning("vault-registry: skipping %r — no reader_endpoint", namespace)
            continue
        table[namespace] = VaultEntry(
            namespace=namespace,
            reader_endpoint=reader,
            writer_endpoint=writer or reader,
            typesense_collection=cfg.get("typesense_collection"),
            neo4j_db=cfg.get("neo4j_db"),
            git_repo=cfg.get("git_repo"),
        )
    return table


class VaultRegistry:
    """Holds the current routing table; reloads from disk when the file changes."""

    def __init__(self, path: str):
        self.path = path
        self._entries: dict[str, VaultEntry] = {}
        self._mtime: Optional[float] = None

    def load(self) -> bool:
        """Force a load. Returns True if the table changed."""
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                text = fh.read()
            self._mtime = os.path.getmtime(self.path)
        except FileNotFoundError:
            if self._entries:
                self._entries = {}
                return True
            return False
        new_entries = parse_registry(text)
        changed = new_entries != self._entries
        self._entries = new_entries
        if changed:
            logger.info("vault-registry reloaded: %d vault(s): %s", len(new_entries), list(new_entries))
        return changed

    def reload_if_changed(self) -> bool:
        """Reload only if the file's mtime advanced. Returns True if reloaded."""
        try:
            mtime = os.path.getmtime(self.path)
        except FileNotFoundError:
            return self.load()
        if self._mtime is None or mtime != self._mtime:
            return self.load()
        return False

    def get(self, namespace: str) -> Optional[VaultEntry]:
        return self._entries.get(namespace)

    def resolve(self, namespace: str, *, write: bool) -> Optional[str]:
        entry = self._entries.get(namespace)
        return entry.resolve(write=write) if entry else None

    def namespaces(self) -> list[str]:
        return list(self._entries.keys())


async def start_registry_watch(
    registry: VaultRegistry, *, interval: float = 2.0
) -> asyncio.Task:
    """Background task: poll the file mtime and live-reload on change."""

    async def _loop() -> None:
        while True:
            try:
                registry.reload_if_changed()
            except Exception as exc:  # never let the watch loop die
                logger.warning("vault-registry watch error: %s", exc)
            await asyncio.sleep(interval)

    registry.load()  # initial load
    return asyncio.create_task(_loop())
