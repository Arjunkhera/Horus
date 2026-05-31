"""
In-memory UUID ↔ file-path registry for the Vault service.

Built on startup by scanning all .md pages and reading their frontmatter
``id`` field.  Provides O(1) bidirectional lookup:

    resolve(uuid)     → file_path | None
    lookup(file_path) → uuid      | None
"""

import logging
from pathlib import Path
from typing import Optional

from .frontmatter import parse_page

logger = logging.getLogger(__name__)


class UUIDRegistry:
    """Bidirectional UUID ↔ file_path index."""

    def __init__(self) -> None:
        self._uuid_to_path: dict[str, str] = {}
        self._path_to_uuid: dict[str, str] = {}

    # -- public API ----------------------------------------------------------

    def resolve(self, page_uuid: str) -> Optional[str]:
        """UUID → file_path (or None)."""
        return self._uuid_to_path.get(page_uuid)

    def lookup(self, file_path: str) -> Optional[str]:
        """file_path → UUID (or None)."""
        return self._path_to_uuid.get(file_path)

    def register(self, page_uuid: str, file_path: str) -> None:
        """Add or update a single mapping."""
        self._uuid_to_path[page_uuid] = file_path
        self._path_to_uuid[file_path] = page_uuid

    def count(self) -> int:
        return len(self._uuid_to_path)

    # -- bulk build ----------------------------------------------------------

    def build(self, knowledge_repo_path: str, collection_paths: Optional[dict[str, str]] = None) -> None:
        """
        Scan all .md files and populate both maps.  Existing entries are replaced.

        Flat-UUID redesign: paths are stored as ``pages/<uuid>.md`` (the canonical
        flat path) regardless of where on disk the file lives.  This matches what
        ``TypesenseSearchEngine.get_document()`` and ``_build_document()`` expect.

        Legacy behaviour (collection-prefixed paths like ``shared/repos/horus.md``)
        is preserved as a *secondary* alias so callers that still pass old paths can
        still resolve them until fully migrated.

        Args:
            knowledge_repo_path: Root path of the knowledge repo (used when
                collection_paths is None).
            collection_paths: Optional explicit map of collection → root.  When
                provided, all roots are scanned.
        """
        self._uuid_to_path.clear()
        self._path_to_uuid.clear()

        if collection_paths is None:
            collection_paths = {"shared": knowledge_repo_path}

        skipped = 0
        for collection_name, root_path in collection_paths.items():
            base = Path(root_path)
            if not base.exists():
                continue
            md_files = sorted(base.rglob("*.md"))
            # Exclude hidden dirs and _schema/
            md_files = [
                f for f in md_files
                if not any(
                    part.startswith(".") or part.startswith("_")
                    for part in f.relative_to(base).parts
                )
            ]

            for md_file in md_files:
                try:
                    content = md_file.read_text(encoding="utf-8")
                    parsed = parse_page(content)
                    rel = str(md_file.relative_to(base))

                    if not parsed.id:
                        skipped += 1
                        legacy_path = f"{collection_name}/{rel}"
                        logger.warning("Page has no id, skipping: %s", legacy_path)
                        continue

                    # Canonical flat path: pages/<uuid>.md
                    flat_path = f"pages/{parsed.id}.md"
                    self._uuid_to_path[parsed.id] = flat_path
                    self._path_to_uuid[flat_path] = parsed.id

                    # Register legacy path as alias so old callers still resolve.
                    legacy_path = f"{collection_name}/{rel}"
                    if legacy_path != flat_path:
                        self._path_to_uuid[legacy_path] = parsed.id

                except Exception as exc:
                    skipped += 1
                    logger.warning("Failed to parse %s: %s", md_file, exc)

        logger.info(
            "UUID registry built: %d pages indexed, %d skipped",
            len(self._uuid_to_path), skipped,
        )
