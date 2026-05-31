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

DEFAULT_COLLECTION = "horus_documents"
SOURCE = "vault"
# BODY_MAX_CHARS removed: full body is indexed (flat-UUID redesign).
# The [:200] slices in search/filter_search results are kept — those are
# display snippets, not the indexed field.

_UUID_RE_SIMPLE = __import__("re").compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    __import__("re").IGNORECASE,
)


def _uuid_to_flat_path(doc_id: str) -> str:
    """
    Convert a Typesense document id to a filesystem-relative path.

    Flat-UUID design: if doc_id is a bare UUID, return ``pages/<uuid>.md``.
    Otherwise return doc_id unchanged (legacy collection-prefixed path, or
    paths that arrived before the migration).
    """
    if doc_id and _UUID_RE_SIMPLE.match(doc_id):
        return f"pages/{doc_id}.md"
    return doc_id


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

    def __init__(
        self,
        collection_paths: dict[str, str],
        collection_name: str = DEFAULT_COLLECTION,
        vault_name: Optional[str] = None,
    ) -> None:
        """
        Args:
            collection_paths: Maps collection name -> filesystem root.
                e.g. {"shared": "/data/knowledge-repo", "workspace": "/data/workspace"}
            collection_name: Typesense collection to query (per-vault).
            vault_name: Logical vault name stored in every document.
        """
        self._collection_paths = collection_paths
        self._collection_name = collection_name
        self._vault_name: str = vault_name or os.getenv("VAULT_NAME", "default")
        self._client: Any = None  # lazily initialised

    def for_vault(self, collection_name: str, vault_name: str) -> "TypesenseSearchEngine":
        """Return a vault-scoped engine sharing the underlying Typesense client."""
        engine = TypesenseSearchEngine(
            collection_paths=self._collection_paths,
            collection_name=collection_name,
            vault_name=vault_name,
        )
        engine._client = self._client
        return engine

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> Any:
        """Return the cached Typesense client (creates it on first call)."""
        if self._client is None:
            self._client = _get_ts_client()
        return self._client

    def _collection(self) -> Any:
        return self._get_client().collections[self._collection_name]

    def _build_document(self, file_path: str, parsed: Any) -> dict:
        """
        Build the Typesense document dict for a parsed page.

        Flat-UUID redesign:
        - ``id`` is the bare frontmatter UUID (not a collection-prefixed path).
          ``file_path`` is still accepted for callers that pass the resolved path,
          but the UUID from frontmatter takes precedence.
        - ``page_uuid`` is kept equal to ``id`` for backward compatibility with
          any consumers that read it directly.
        - Full body is indexed (no BODY_MAX_CHARS truncation).

        Args:
            file_path: Resolved filesystem path (used only as fallback when no UUID
                       is present in frontmatter).
            parsed: ParsedPage object from layer2.frontmatter.parse_page
        """
        scope = parsed.scope or {}
        # Index the full body — no truncation.
        body = parsed.body or ""

        # Bare UUID is the canonical Typesense id.
        # Fall back to file_path only for legacy pages that somehow have no id.
        page_uuid = getattr(parsed, "id", "") or ""
        doc_id = page_uuid if page_uuid else file_path

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
            "id": doc_id,
            # Keep page_uuid equal to id for backward compatibility.
            "page_uuid": doc_id,
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

        Flat-UUID: the parsed frontmatter UUID becomes the Typesense id.
        ``file_path`` is used only as a fallback when no UUID is present.

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
        """Delete a document from Typesense. Resolves flat/UUID ids to the bare UUID
        (the Typesense doc id); legacy paths are passed through best-effort."""
        doc_id = file_path
        if file_path and _UUID_RE_SIMPLE.match(file_path):
            doc_id = file_path
        elif file_path and file_path.startswith("pages/") and file_path.endswith(".md"):
            doc_id = file_path[len("pages/"):-len(".md")]
        self._delete_raw(doc_id)

    # ------------------------------------------------------------------
    # SearchStore interface — search methods
    # ------------------------------------------------------------------

    def search(self, query: str, collection: Optional[str] = None, limit: int = 10) -> list[SearchResult]:
        """BM25 keyword search via Typesense, filtered to source=vault.

        Flat-UUID redesign: doc ``id`` is a bare UUID.  ``file_path`` on the
        returned SearchResult is set to ``pages/<uuid>.md`` so that callers can
        resolve the page via the filesystem store root without a collection prefix.
        The ``id`` field on SearchResult carries the same UUID for direct identity.
        """
        try:
            filter_by = f"source:={SOURCE}"
            # Collection filtering is no longer meaningful with bare-UUID ids.
            # We keep the parameter for API compatibility but ignore it for now.

            params: dict[str, Any] = {
                "q": query or "*",
                "query_by": "title,body,tags,aliases",
                "filter_by": filter_by,
                "per_page": limit,
                "sort_by": "_text_match:desc",
            }

            resp = self._collection().documents.search(params)
            hits = resp.get("hits", [])

            results: list[SearchResult] = []
            for hit in hits:
                doc = hit.get("document", {})
                doc_id = doc.get("id", "")

                # Resolve bare UUID to flat path for filesystem consumers.
                fp = _uuid_to_flat_path(doc_id)

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
                        collection="",
                        id=doc_id if doc_id else None,
                        title=doc.get("title") or None,
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
                doc_id = doc.get("id", "")
                fp = _uuid_to_flat_path(doc_id)
                results.append(
                    SearchResult(
                        file_path=fp,
                        score=1.0,
                        snippet=(doc.get("body") or "")[:200],
                        collection="",
                        id=doc_id if doc_id else None,
                        title=doc.get("title") or None,
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
        """Retrieve document content from the filesystem.

        Flat-UUID redesign: ``file_path`` may be any of:
        - ``pages/<uuid>.md`` — flat UUID path; resolved against the single store root
          (first collection_path that exists).
        - ``<uuid>`` (bare UUID, no extension) — also resolved as ``pages/<uuid>.md``.
        - Legacy ``<collection>/<relative>`` path — resolved via the old collection map.
        """
        if not file_path:
            return None

        # Bare UUID: convert to flat path first.
        if _UUID_RE_SIMPLE.match(file_path):
            file_path = f"pages/{file_path}.md"

        # Flat path starting with "pages/": resolve against single (first) store root.
        if file_path.startswith("pages/"):
            for root_path in self._collection_paths.values():
                candidate = Path(root_path) / file_path
                if candidate.exists():
                    try:
                        return candidate.read_text(encoding="utf-8")
                    except (OSError, UnicodeDecodeError):
                        return None
            return None

        # Legacy collection-prefixed path (e.g. "shared/repos/horus.md").
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
        """Retrieve documents from the filesystem matching a glob pattern.

        Flat-UUID redesign: for each root, pages under ``pages/`` are exposed with
        their flat path (``pages/<uuid>.md``) as the file_path key.  Legacy pages
        under other subdirectories still use the collection-prefixed key for
        backward compatibility with callers that do not yet expect flat paths.
        """
        documents: list[Document] = []
        seen_paths: set[str] = set()
        for coll_name, root_path in self._collection_paths.items():
            root = Path(root_path)
            if not root.exists():
                continue
            for match in root.glob(pattern):
                try:
                    relative = str(match.relative_to(root))
                    # Use flat path for pages/ directory; legacy prefix for others.
                    if relative.startswith("pages/") or relative.startswith("pages\\"):
                        fp = relative  # e.g. "pages/<uuid>.md"
                    else:
                        fp = f"{coll_name}/{relative}"
                    if fp in seen_paths:
                        continue
                    seen_paths.add(fp)
                    content = match.read_text(encoding="utf-8")
                    documents.append(
                        Document(
                            file_path=fp,
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
                    doc_id = hit.get("document", {}).get("id", "")
                    if doc_id:
                        fp = _uuid_to_flat_path(doc_id)
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
            self._get_client().collections[self._collection_name].documents.delete(
                {"filter_by": f"source:={SOURCE} && vault_name:={self._vault_name}"}
            )
        except Exception as e:
            logger.warning("Failed to purge stale vault documents: %s", e)

        count = 0
        errors = 0

        # Track indexed UUIDs to avoid double-indexing when the same root appears
        # under multiple collection_paths keys.
        indexed_uuids: set[str] = set()

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
                    # Flat-UUID: use pages/<uuid>.md if in pages/ dir; otherwise
                    # derive flat path from frontmatter UUID when available.
                    if relative.startswith("pages/") or relative.startswith("pages\\"):
                        file_path = relative  # already flat
                    elif parsed.id:
                        file_path = f"pages/{parsed.id}.md"
                    else:
                        file_path = f"{coll_name}/{relative}"
                    # Skip duplicates (same UUID seen via a different collection root)
                    if parsed.id:
                        if parsed.id in indexed_uuids:
                            continue
                        indexed_uuids.add(parsed.id)
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
                "collection": self._collection_name,
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
