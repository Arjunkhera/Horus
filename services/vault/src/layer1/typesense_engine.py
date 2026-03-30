"""
Typesense-based search engine for Vault knowledge pages.

Connects to a Typesense instance and uses the shared `horus_documents` collection
(bootstrapped by Anvil) to provide keyword search, document listing, and re-indexing.

Semantic and hybrid search are deferred — both currently delegate to keyword search.

Connection config (env vars):
  TYPESENSE_HOST      — default: localhost
  TYPESENSE_PORT      — default: 8108
  TYPESENSE_API_KEY   — default: horus-local-key
  TYPESENSE_PROTOCOL  — default: http
  VAULT_NAME          — logical vault name stored in every document (default: default)
"""

import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

from .interface import SearchStore, SearchResult, Document

logger = logging.getLogger(__name__)

COLLECTION = "horus_documents"
SOURCE = "vault"
BODY_MAX_CHARS = 20_000


def _get_ts_client() -> Any:
    """
    Build and return a typesense.Client configured from environment variables.

    Raises ImportError if the typesense package is not installed.
    Raises typesense.exceptions.TypesenseClientError on connection problems
    (the caller is responsible for catching that).
    """
    import typesense  # type: ignore[import-untyped]

    host = os.getenv("TYPESENSE_HOST", "localhost")
    port = int(os.getenv("TYPESENSE_PORT", "8108"))
    api_key = os.getenv("TYPESENSE_API_KEY", "horus-local-key")
    protocol = os.getenv("TYPESENSE_PROTOCOL", "http")

    return typesense.Client(
        {
            "nodes": [
                {
                    "host": host,
                    "port": port,
                    "protocol": protocol,
                }
            ],
            "api_key": api_key,
            "connection_timeout_seconds": 5,
        }
    )


class TypesenseSearchEngine(SearchStore):
    """
    SearchStore implementation backed by Typesense.

    File content is always read from the local filesystem (same as FtsSearchEngine).
    Typesense is used only for search queries, document listing, and the search index.

    The Typesense collection `horus_documents` is managed by Anvil (TS-1); Vault
    never creates or alters the collection schema — it just reads/writes documents.
    """

    def __init__(self, collection_paths: dict[str, str]) -> None:
        """
        Args:
            collection_paths: Maps collection name -> filesystem root.
                e.g. {"shared": "/data/knowledge-repo", "workspace": "/data/workspace"}
        """
        self._collection_paths = collection_paths
        self._vault_name: str = os.getenv("VAULT_NAME", "default")
        self._client: Any = None  # lazily initialised

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> Any:
        """Return the cached Typesense client (creates it on first call)."""
        if self._client is None:
            self._client = _get_ts_client()
        return self._client

    def _collection(self) -> Any:
        return self._get_client().collections[COLLECTION]

    def _build_document(self, file_path: str, parsed: Any) -> dict:
        """
        Build the Typesense document dict for a parsed page.

        Args:
            file_path: Collection-prefixed path (e.g. "shared/repos/horus.md")
            parsed: ParsedPage object from layer2.frontmatter.parse_page
        """
        scope = parsed.scope or {}
        body = (parsed.body or "")[:BODY_MAX_CHARS]

        # Timestamps — use current time as fallback
        now = int(time.time())
        created_at = now
        modified_at = now
        if hasattr(parsed, "last_verified") and parsed.last_verified:
            try:
                import datetime as _dt
                lv = parsed.last_verified
                if isinstance(lv, (_dt.date, _dt.datetime)):
                    ts = int(_dt.datetime.combine(lv, _dt.time()).timestamp()) if isinstance(lv, _dt.date) else int(lv.timestamp())
                    modified_at = ts
            except Exception:
                pass

        doc: dict = {
            "id": file_path,
            "source": SOURCE,
            "source_type": parsed.type or "concept",
            "title": parsed.title or "Untitled",
            "body": body,
            "tags": [str(t) for t in (parsed.tags or [])],
            "scope_repo": scope.get("repo", ""),
            "scope_program": scope.get("program", ""),
            "vault_name": self._vault_name,
            "mode": parsed.mode or "reference",
            "created_at": created_at,
            "modified_at": modified_at,
            "auto_generated": bool(getattr(parsed, "auto_generated", False)),
            "aliases": [str(a) for a in (getattr(parsed, "aliases", None) or [])],
        }
        # confidence is optional — omit key entirely when absent to avoid Typesense int32 null issues
        confidence = getattr(parsed, "confidence", None)
        if confidence is not None:
            doc["confidence"] = int(confidence)
        return doc

    def _upsert_raw(self, doc: dict) -> None:
        """Fire-and-forget Typesense upsert. Logs failures, never raises."""
        try:
            self._collection().documents.upsert(doc)
        except Exception as exc:
            logger.warning("Typesense upsert failed for '%s': %s", doc.get("id"), exc)

    def _delete_raw(self, doc_id: str) -> None:
        """Fire-and-forget Typesense delete. Logs failures, never raises."""
        try:
            self._collection().documents[doc_id].delete()
        except Exception as exc:
            logger.warning("Typesense delete failed for '%s': %s", doc_id, exc)

    # ------------------------------------------------------------------
    # Public index-write helpers (called by sync daemon)
    # ------------------------------------------------------------------

    def upsert_document(self, file_path: str, content: str) -> None:
        """
        Parse content and upsert a single document into Typesense.

        Fire-and-forget: failures are logged but never raised.
        """
        try:
            from ..layer2.frontmatter import parse_page
            parsed = parse_page(content)
            doc = self._build_document(file_path, parsed)
            self._upsert_raw(doc)
        except Exception as exc:
            logger.warning("upsert_document failed for '%s': %s", file_path, exc)

    def delete_document(self, file_path: str) -> None:
        """
        Delete a single document from Typesense.

        Fire-and-forget: failures are logged but never raised.
        """
        self._delete_raw(file_path)

    # ------------------------------------------------------------------
    # SearchStore interface — search methods
    # ------------------------------------------------------------------

    def search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """BM25 keyword search via Typesense, filtered to source=vault."""
        try:
            filter_by = f"source:={SOURCE}"
            if collection:
                # map collection name to a file_path prefix filter using Typesense's
                # built-in prefix matching (not natively supported, so we use a tag
                # approach via the document ID prefix match workaround — instead we
                # just pass collection as an extra filter that we store in tags at
                # index time).  For now, rely on post-filter since Typesense doesn't
                # support startsWith on string fields in free-text filter_by.
                pass  # collection filtering handled post-result below

            params: dict[str, Any] = {
                "q": query or "*",
                "query_by": "title,body,tags,aliases",
                "filter_by": filter_by,
                "per_page": limit if not collection else limit * 3,
                "sort_by": "_text_match:desc",
            }

            resp = self._collection().documents.search(params)
            hits = resp.get("hits", [])

            results: list[SearchResult] = []
            for hit in hits:
                doc = hit.get("document", {})
                fp = doc.get("id", "")

                # Apply collection prefix filter post-search
                if collection and not fp.startswith(f"{collection}/"):
                    continue

                text_score = hit.get("text_match", 0)
                # Normalise to 0-1
                score = min(1.0, text_score / 1_000_000) if text_score > 0 else 0.0

                highlights = hit.get("highlights", [])
                snippet = ""
                for hl in highlights:
                    snippets_list = hl.get("snippets", [])
                    if snippets_list:
                        snippet = snippets_list[0]
                        break
                if not snippet:
                    snippet = (doc.get("body") or "")[:200]

                results.append(
                    SearchResult(
                        file_path=fp,
                        score=score,
                        snippet=snippet,
                        collection=fp.split("/")[0] if "/" in fp else "",
                    )
                )
                if len(results) >= limit:
                    break

            return results

        except Exception as exc:
            logger.error("Typesense search failed: %s", exc)
            return []

    def semantic_search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """Semantic search — currently delegates to keyword search (embeddings deferred)."""
        return self.search(query, collection, limit)

    def hybrid_search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """Hybrid search — currently delegates to keyword search (embeddings deferred)."""
        return self.search(query, collection, limit)

    def filter_search(self, filter_by: str, limit: int = 10) -> list[SearchResult]:
        """
        Deterministic filter query — no text scoring.

        Used by resolve_context for exact repo-profile lookup:
          filter_by='scope_repo:={repo} && source_type:=repo-profile && source:=vault'
        """
        try:
            params: dict[str, Any] = {
                "q": "*",
                "query_by": "title",
                "filter_by": filter_by,
                "per_page": limit,
            }
            resp = self._collection().documents.search(params)
            hits = resp.get("hits", [])

            results: list[SearchResult] = []
            for hit in hits:
                doc = hit.get("document", {})
                fp = doc.get("id", "")
                results.append(
                    SearchResult(
                        file_path=fp,
                        score=1.0,
                        snippet=(doc.get("body") or "")[:200],
                        collection=fp.split("/")[0] if "/" in fp else "",
                    )
                )
            return results

        except Exception as exc:
            logger.error("Typesense filter_search failed: %s", exc)
            return []

    # ------------------------------------------------------------------
    # SearchStore interface — document retrieval (filesystem)
    # ------------------------------------------------------------------

    def get_document(self, file_path: str) -> Optional[str]:
        """Retrieve document content from the filesystem."""
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
        """Retrieve documents from the filesystem matching a glob pattern."""
        documents: list[Document] = []
        for coll_name, root_path in self._collection_paths.items():
            root = Path(root_path)
            if not root.exists():
                continue
            for match in root.glob(pattern):
                try:
                    relative = str(match.relative_to(root))
                    content = match.read_text(encoding="utf-8")
                    documents.append(
                        Document(
                            file_path=f"{coll_name}/{relative}",
                            content=content,
                            collection=coll_name,
                        )
                    )
                except (OSError, UnicodeDecodeError):
                    continue
        return documents

    def get_all_documents(self) -> dict[str, str]:
        docs = self.get_documents_by_glob("**/*.md")
        return {d.file_path: d.content for d in docs}

    # ------------------------------------------------------------------
    # SearchStore interface — listing
    # ------------------------------------------------------------------

    def list_documents(self, collection: Optional[str] = None) -> list[str]:
        """List all indexed document paths by querying Typesense."""
        try:
            filter_by = f"source:={SOURCE}"
            all_ids: list[str] = []
            page = 1
            per_page = 250

            while True:
                params: dict[str, Any] = {
                    "q": "*",
                    "query_by": "title",
                    "filter_by": filter_by,
                    "per_page": per_page,
                    "page": page,
                }
                resp = self._collection().documents.search(params)
                hits = resp.get("hits", [])
                for hit in hits:
                    fp = hit.get("document", {}).get("id", "")
                    if fp and (not collection or fp.startswith(f"{collection}/")):
                        all_ids.append(fp)
                if len(hits) < per_page:
                    break
                page += 1

            return all_ids

        except Exception as exc:
            logger.error("Typesense list_documents failed: %s", exc)
            return []

    # ------------------------------------------------------------------
    # SearchStore interface — index operations
    # ------------------------------------------------------------------

    def reindex(self) -> dict:
        """
        Full re-index: scan all collection paths and upsert every .md file into Typesense.

        Files starting with '_' are skipped (schema directory).
        Failures on individual files are logged but do not abort the re-index.

        Returns:
            dict with keys ``indexed`` (int), ``errors`` (int), and ``duration_ms`` (float).
        """
        from ..layer2.frontmatter import parse_page

        start = time.time()

        # Purge stale vault documents before re-indexing
        try:
            self._get_client().collections[COLLECTION].documents.delete(
                {"filter_by": f"source:={SOURCE} && vault_name:={self._vault_name}"}
            )
        except Exception as e:
            logger.warning("Failed to purge stale vault documents: %s", e)

        count = 0
        errors = 0

        for coll_name, root_path in self._collection_paths.items():
            root = Path(root_path)
            if not root.exists():
                logger.debug("Collection path does not exist, skipping: %s", root_path)
                continue

            for md_file in root.rglob("*.md"):
                if md_file.name.startswith("_"):
                    continue
                try:
                    content = md_file.read_text(encoding="utf-8")
                    parsed = parse_page(content)
                    relative = str(md_file.relative_to(root))
                    file_path = f"{coll_name}/{relative}"
                    doc = self._build_document(file_path, parsed)
                    self._upsert_raw(doc)
                    count += 1
                except Exception as exc:
                    errors += 1
                    logger.warning("Failed to index %s: %s", md_file, exc)

        duration_ms = (time.time() - start) * 1000
        logger.info(
            "Typesense re-index complete: %d documents upserted, %d errors, %.1f ms",
            count, errors, duration_ms,
        )
        return {"indexed": count, "errors": errors, "duration_ms": duration_ms}

    def status(self) -> dict[str, Any]:
        """Return Typesense engine status."""
        try:
            # Use filter_search to count documents in this vault
            params: dict[str, Any] = {
                "q": "*",
                "query_by": "title",
                "filter_by": f"source:={SOURCE}",
                "per_page": 1,
            }
            resp = self._collection().documents.search(params)
            found = resp.get("found", 0)
            return {
                "status": "ok",
                "engine": "typesense",
                "indexed_documents": found,
                "collection": COLLECTION,
                "vault_name": self._vault_name,
            }
        except Exception as exc:
            return {
                "status": "error",
                "engine": "typesense",
                "error": str(exc),
            }

    # ------------------------------------------------------------------
    # Startup helper
    # ------------------------------------------------------------------

    def ensure_collections(self, shared_path: str = "", workspace_path: str = "") -> None:
        """Update collection paths (mirrors FtsSearchEngine API, called by main.py)."""
        if shared_path:
            self._collection_paths["shared"] = shared_path
        if workspace_path:
            self._collection_paths["workspace"] = workspace_path
