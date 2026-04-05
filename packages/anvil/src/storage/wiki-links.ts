// Markdown body wiki-link parser

/**
 * Parse a wiki-link text, stripping brackets and alias.
 * "[[Note Title]]" → "Note Title"
 * "[[Note Title|Display Text]]" → "Note Title"
 */
export function parseWikiLinkText(text: string): string {
  // Match [[...]] pattern, capturing content before the pipe or closing bracket
  const match = text.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  if (match) {
    return match[1].trim();
  }
  return '';
}

/**
 * Extract all wiki-links from markdown body.
 * Finds all [[wiki-link]] patterns.
 * Handles: [[Note Title]] → "Note Title"
 *          [[Note Title|Display Text]] → "Note Title"
 * Skips links inside fenced code blocks (``` ... ```)
 * Skips links inside inline code (`...`)
 * Returns deduplicated list of link texts (without brackets).
 */
export function extractWikiLinks(body: string): string[] {
  // Remove fenced code blocks first
  let cleaned = body.replace(/```[\s\S]*?```/g, '');

  // Remove inline code
  cleaned = cleaned.replace(/`[^`]*`/g, '');

  // Find all [[...]] patterns
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const matches: string[] = [];
  let match;

  while ((match = wikiLinkRegex.exec(cleaned)) !== null) {
    const linkTitle = match[1].trim();
    if (linkTitle && !matches.includes(linkTitle)) {
      matches.push(linkTitle);
    }
  }

  return matches;
}
