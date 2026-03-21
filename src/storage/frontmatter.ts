// Frontmatter parsing and serialization with round-trip fidelity

import matter from 'gray-matter';
import { dump } from 'js-yaml';

/** Canonical field ordering for frontmatter output */
export const CORE_FIELD_ORDER = [
  'noteId',
  'type',
  'title',
  'created',
  'modified',
  'tags',
  'related',
  'scope',
];

/**
 * Parse frontmatter from file content.
 * Strips BOM on read. Returns empty data if no frontmatter.
 */
export function parseFrontmatter(
  fileContent: string,
): {
  data: Record<string, unknown>;
  content: string;
  isEmpty: boolean;
} {
  // Strip BOM if present
  const content = fileContent.replace(/^\ufeff/, '');

  // Use gray-matter to parse
  const { data, content: body } = matter(content);

  return {
    data: data as Record<string, unknown>,
    content: body,
    isEmpty: Object.keys(data).length === 0,
  };
}

/**
 * Serialize frontmatter and body back to file content.
 * Consistent field ordering: core fields first (in CORE_FIELD_ORDER),
 * then remaining fields alphabetically.
 * Round-trip fidelity is critical.
 */
export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  // Sort data: core fields first in order, then rest alphabetically
  const sorted: Record<string, unknown> = {};

  // Add core fields in order
  for (const key of CORE_FIELD_ORDER) {
    if (key in data) {
      sorted[key] = data[key];
    }
  }

  // Add remaining fields alphabetically
  const remainingKeys = Object.keys(data)
    .filter((k) => !CORE_FIELD_ORDER.includes(k))
    .sort();

  for (const key of remainingKeys) {
    sorted[key] = data[key];
  }

  // Serialize to YAML
  const yamlStr = dump(sorted, {
    indent: 2,
    lineWidth: -1, // No line wrapping
    noRefs: true,
    sortKeys: false, // We've already sorted
  });

  // Construct output: frontmatter marker, YAML, marker, body
  // Only add frontmatter if there's data to serialize
  if (Object.keys(sorted).length === 0) {
    return body;
  }

  return `---\n${yamlStr}---\n${body}`;
}
