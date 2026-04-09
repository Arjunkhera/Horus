"""
Link navigator for following relationships between knowledge pages.

Follows wiki-links, UUIDs, and the `related` field to discover connected pages.
This is the legacy fallback path used when the Neo4j graph client is unavailable.
Edge fields (depends_on, consumed_by, applies_to) have been migrated to the graph (#968f4051).
"""

import re
from typing import Optional

from ..layer1.interface import SearchStore
from .frontmatter import ParsedPage, parse_page

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def get_related_pages(
    page: ParsedPage, store: SearchStore, registry=None
) -> list[tuple[ParsedPage, str]]:
    """
    Follow links from a page to find all related pages.

    Resolution order per reference:
    1. If the reference is a UUID and a registry is available → resolve directly
    2. Otherwise fall back to search-based resolution (wiki-links, dicts, strings)

    Args:
        page: Source ParsedPage to follow links from
        store: SearchStore instance for searching
        registry: Optional UUIDRegistry for direct UUID resolution

    Returns:
        List of (ParsedPage, file_path) tuples for all related pages found
        Deduplicated by file_path.
    """
    all_references: list = list(page.related)

    found_pages: dict[str, tuple[ParsedPage, str]] = {}

    for ref in all_references:
        # Try UUID resolution first
        ref_str = str(ref).strip() if isinstance(ref, str) else ""
        if registry and ref_str and _UUID_RE.match(ref_str):
            file_path = registry.resolve(ref_str)
            if file_path and file_path not in found_pages:
                content = store.get_document(file_path)
                if content:
                    parsed = parse_page(content)
                    found_pages[file_path] = (parsed, file_path)
                    continue

        # Fall back to text-based search
        extracted = _extract_reference_text(ref)
        if extracted:
            matches = _search_for_reference(extracted, store)
            for parsed, path in matches:
                if path not in found_pages:
                    found_pages[path] = (parsed, path)

    return list(found_pages.values())


def _extract_reference_text(ref) -> Optional[str]:
    """
    Extract searchable text from a reference in various formats.
    
    Handles:
    - Wiki-links: [[Page Title]] → "Page Title"
    - Wiki-links with aliases: [[Page Title|Alias]] → "Page Title"
    - Dict refs: {"repo": "name"} → "name"
    - Dict refs: {"service": "name"} → "name"
    - Plain strings: "name" → "name"
    
    Args:
        ref: Reference in any supported format
        
    Returns:
        Extracted text string, or None if format not recognized
    """
    if isinstance(ref, str):
        # Check for wiki-link format [[...]]
        wiki_match = re.match(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', ref)
        if wiki_match:
            return wiki_match.group(1).strip()
        
        # Plain string reference
        return ref.strip()
    
    elif isinstance(ref, dict):
        # Extract value from dict refs like {"repo": "name"} or {"program": "name"}
        for key in ["repo", "program"]:
            if key in ref:
                return ref[key]
    
    return None


def _search_for_reference(ref_text: str, store: SearchStore) -> list[tuple[ParsedPage, str]]:
    """
    Search for pages matching a reference text.
    
    Strategy:
    1. Search the store with the reference text (limit 5 for performance)
    2. For each result, get the document and parse frontmatter
    3. Verify the match by checking if:
       - Title matches the reference text (case-insensitive), OR
       - Any scope field value matches the reference text
    4. Return all verified matches
    
    Args:
        ref_text: Text to search for
        store: SearchStore instance
        
    Returns:
        List of (ParsedPage, file_path) tuples for verified matches
    """
    matches = []
    
    # Search for the reference text
    results = store.search(ref_text, limit=5)
    
    for result in results:
        content = store.get_document(result.file_path)
        if not content:
            continue
        
        parsed = parse_page(content)
        
        # Verify the match
        if _is_match(parsed, ref_text):
            matches.append((parsed, result.file_path))
    
    return matches


def _is_match(page: ParsedPage, ref_text: str) -> bool:
    """
    Check if a page matches a reference text.
    
    A page matches if:
    - Its title matches the reference text (case-insensitive), OR
    - Any of its scope field values match the reference text
    
    Args:
        page: ParsedPage to check
        ref_text: Reference text to match against
        
    Returns:
        True if the page matches the reference
    """
    ref_lower = ref_text.lower()
    
    # Check title match
    if page.title.lower() == ref_lower:
        return True
    
    # Check scope field values
    for value in page.scope.values():
        if isinstance(value, str) and value.lower() == ref_lower:
            return True
    
    return False
