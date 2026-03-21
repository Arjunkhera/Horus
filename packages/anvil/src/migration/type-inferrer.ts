// Type inference from directory paths and frontmatter

export type InferenceRule = {
  pathPattern: string;  // glob or substring, e.g. 'Tasks/'
  type: string;
};

export type DefaultConfig = {
  rules: InferenceRule[];
};

export const DEFAULT_CONFIG: DefaultConfig = {
  rules: [
    { pathPattern: 'Tasks/', type: 'task' },
    { pathPattern: 'People/', type: 'person' },
    { pathPattern: 'Projects/', type: 'project' },
    { pathPattern: 'Meetings/', type: 'meeting' },
    { pathPattern: 'Services/', type: 'service' },
    { pathPattern: 'Journal/', type: 'journal' },
  ],
};

/**
 * Infer type from file path and frontmatter.
 * Returns matched type or 'note' as default.
 * If existingFrontmatter.type is set, return it unchanged.
 * Otherwise match filePath against rules (case-insensitive substring match).
 */
export function inferType(
  filePath: string,
  existingFrontmatter: Record<string, unknown>,
  config?: DefaultConfig,
): string {
  // If type already exists in frontmatter, preserve it
  if (existingFrontmatter.type && typeof existingFrontmatter.type === 'string') {
    return existingFrontmatter.type;
  }

  // Use provided config or default
  const ruleSet = config || DEFAULT_CONFIG;

  // Try to match against rules (case-insensitive)
  const normalizedPath = filePath.toLowerCase();
  for (const rule of ruleSet.rules) {
    const pattern = rule.pathPattern.toLowerCase();
    if (normalizedPath.includes(pattern)) {
      return rule.type;
    }
  }

  // Default to 'note'
  return 'note';
}

/**
 * Infer naming prefix from title.
 * Detects common naming prefixes like [[PE Name]] → 'person', [[SV Name]] → 'service'
 * Returns the inferred type or null if no prefix matches.
 */
export function inferNamingPrefix(
  title: string,
  prefixMap?: Record<string, string>,
): string | null {
  // Default prefixMap
  const map = prefixMap || {
    'PE ': 'person',
    'SV ': 'service',
  };

  // Check each prefix in the map
  for (const [prefix, type] of Object.entries(map)) {
    if (title.startsWith(prefix)) {
      return type;
    }
  }

  return null;
}
