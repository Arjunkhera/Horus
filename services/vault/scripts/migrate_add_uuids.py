#!/usr/bin/env python3
"""
Migration script: Stamp UUIDv4 on all existing knowledge pages.

Scans a knowledge-base directory for .md files, parses their YAML
frontmatter, and inserts an `id: <uuidv4>` field as the first line
of frontmatter for any page that doesn't already have one.

Usage:
    python migrate_add_uuids.py /path/to/knowledge-base

Idempotent — re-running skips pages that already have an `id` field.
"""

import re
import sys
import uuid
from pathlib import Path

import yaml

# Match the opening and closing --- of YAML frontmatter
_FM_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)


def migrate_directory(kb_path: Path) -> tuple[int, int, list[str]]:
    """
    Add UUIDv4 `id` to all .md pages missing one.

    Inserts ``id`` as the first field in frontmatter by direct text
    manipulation so that existing field order and formatting are preserved.

    Returns:
        (migrated_count, skipped_count, error_paths)
    """
    migrated = 0
    skipped = 0
    errors: list[str] = []

    md_files = sorted(kb_path.rglob("*.md"))
    # Exclude hidden dirs (like .git) and _schema/
    md_files = [
        f for f in md_files
        if not any(part.startswith(".") or part.startswith("_") for part in f.relative_to(kb_path).parts)
    ]

    for md_file in md_files:
        try:
            raw = md_file.read_text(encoding="utf-8")
            m = _FM_RE.match(raw)
            if not m:
                skipped += 1
                continue

            fm_text = m.group(1)
            metadata = yaml.safe_load(fm_text) or {}

            if metadata.get("id"):
                skipped += 1
                continue

            # Generate UUID and insert as first line of frontmatter
            page_id = str(uuid.uuid4())
            id_line = f"id: {page_id}\n"
            new_raw = f"---\n{id_line}{fm_text}---\n{raw[m.end():]}"

            md_file.write_text(new_raw, encoding="utf-8")
            migrated += 1
            print(f"  ✓ {md_file.relative_to(kb_path)}: {page_id}")

        except Exception as e:
            errors.append(f"{md_file.relative_to(kb_path)}: {e}")

    return migrated, skipped, errors


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python migrate_add_uuids.py <knowledge-base-path>")
        sys.exit(1)

    kb_path = Path(sys.argv[1])
    if not kb_path.is_dir():
        print(f"Error: {kb_path} is not a directory")
        sys.exit(1)

    print(f"Scanning {kb_path} for .md pages...\n")
    migrated, skipped, errors = migrate_directory(kb_path)

    print(f"\nSummary: {migrated} migrated, {skipped} skipped (already have id)")
    if errors:
        print(f"\n{len(errors)} errors:")
        for err in errors:
            print(f"  ✗ {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
