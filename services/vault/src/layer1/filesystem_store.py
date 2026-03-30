"""
Filesystem-based document store for Vault knowledge pages.

Provides document retrieval from the filesystem without any search index.
Text search requires an external engine (e.g. Typesense); until one is
configured, search/semantic_search/hybrid_search return empty results.
"""

import logging
from pathlib import Path
from typing import Any, Optional

from .interface import SearchStore, SearchResult, Document

logger = logging.getLogger(__name__)


class FilesystemStore(SearchStore):
    """
    Document store backed by the filesystem.

    Handles document retrieval and listing. Search operations return empty
    results -- callers should configure Typesense for text search.
    """

    def __init__(self, collection_paths: dict[str, str]) -> None:
        """
        Args:
            collection_paths: Maps collection name -> filesystem root
                e.g. {"shared": "/data/knowledge-repo", "workspace": "/data/workspace"}
        """
        self._collection_paths = collection_paths
        self._indexed_paths: list[tuple[str, str]] = []  # (file_path, collection)

    def reindex(self) -> dict:
        """Scan filesystem and build the in-memory document list.

        Returns:
            dict with keys ``indexed`` (int), ``errors`` (int), and ``duration_ms`` (float).
        """
        import time
        start = time.time()
        self._indexed_paths = []

        count = 0
        errors = 0
        for coll_name, root_path in self._collection_paths.items():
            root = Path(root_path)
            if not root.exists():
                continue
            for md_file in root.rglob("*.md"):
                if md_file.name.startswith("_"):
                    continue  # Skip _schema directory files
                try:
                    relative = str(md_file.relative_to(root))
                    file_path = f"{coll_name}/{relative}"
                    self._indexed_paths.append((file_path, coll_name))
                    count += 1
                except Exception as e:
                    errors += 1
                    logger.warning("Failed to index %s: %s", md_file, e)

        duration_ms = (time.time() - start) * 1000
        logger.info("Filesystem index built: %d pages indexed, %d errors, %.1f ms", count, errors, duration_ms)
        return {"indexed": count, "errors": errors, "duration_ms": duration_ms}

    def search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """Text search is not available without an external search engine."""
        logger.debug("search() called but no search engine configured; returning empty results")
        return []

    def semantic_search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """Semantic search is not available without an external search engine."""
        return []

    def hybrid_search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """Hybrid search is not available without an external search engine."""
        return []

    def get_document(self, file_path: str) -> Optional[str]:
        parts = file_path.split("/", 1)
        if len(parts) != 2:
            return None
        collection, relative = parts
        root = self._collection_paths.get(collection)
        if not root:
            return None
        try:
            return (Path(root) / relative).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None

    def get_documents_by_glob(self, pattern: str) -> list[Document]:
        documents = []
        for coll_name, root_path in self._collection_paths.items():
            root = Path(root_path)
            if not root.exists():
                continue
            for match in root.glob(pattern):
                try:
                    relative = str(match.relative_to(root))
                    content = match.read_text(encoding="utf-8")
                    documents.append(Document(
                        file_path=f"{coll_name}/{relative}",
                        content=content,
                        collection=coll_name,
                    ))
                except (OSError, UnicodeDecodeError):
                    continue
        return documents

    def get_all_documents(self) -> dict[str, str]:
        docs = self.get_documents_by_glob("**/*.md")
        return {d.file_path: d.content for d in docs}

    def list_documents(self, collection: Optional[str] = None) -> list[str]:
        if collection:
            return [fp for fp, coll in self._indexed_paths if coll == collection]
        return [fp for fp, _ in self._indexed_paths]

    def status(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "engine": "filesystem",
            "indexed_documents": len(self._indexed_paths),
        }

    def ensure_collections(self, shared_path: str = "", workspace_path: str = "") -> None:
        """Update collection paths (called by main.py during startup)."""
        if shared_path:
            self._collection_paths["shared"] = shared_path
        if workspace_path:
            self._collection_paths["workspace"] = workspace_path
