import type { WorkspaceConfigMeta } from '../models/workspace-config-meta.js';

/**
 * Parse a versioned artifact reference like "plugin-name@1.2.0" or "plugin-name"
 * into { id, version } for deduplication purposes.
 */
function parseRef(ref: string): { id: string; version?: string } {
  const atIdx = ref.lastIndexOf('@');
  if (atIdx > 0) {
    return { id: ref.slice(0, atIdx), version: ref.slice(atIdx + 1) };
  }
  return { id: ref };
}

/**
 * Deduplicated union of artifact reference arrays (plugins, skills, personas).
 * If the same artifact ID appears in both parent and child, child's version wins.
 * Entries without a version are treated as plain IDs.
 */
function deduplicatedUnion(parent: string[], child: string[]): string[] {
  const map = new Map<string, string>(); // id -> full ref string

  // Add parent entries first
  for (const ref of parent) {
    const { id } = parseRef(ref);
    map.set(id, ref);
  }

  // Child entries override parent entries with the same id
  for (const ref of child) {
    const { id } = parseRef(ref);
    map.set(id, ref);
  }

  return Array.from(map.values());
}

/**
 * Deep merge two plain objects. Child values override parent values for scalar fields.
 * Nested objects are recursively merged. Arrays are replaced (not merged).
 */
function deepMerge<T extends Record<string, unknown>>(parent: T, child: T): T {
  const result = { ...parent } as Record<string, unknown>;

  for (const [key, childVal] of Object.entries(child)) {
    const parentVal = result[key];

    if (
      childVal !== null &&
      childVal !== undefined &&
      typeof childVal === 'object' &&
      !Array.isArray(childVal) &&
      parentVal !== null &&
      parentVal !== undefined &&
      typeof parentVal === 'object' &&
      !Array.isArray(parentVal)
    ) {
      // Both are plain objects — recurse
      result[key] = deepMerge(
        parentVal as Record<string, unknown>,
        childVal as Record<string, unknown>,
      );
    } else if (childVal !== undefined) {
      result[key] = childVal;
    }
  }

  return result as T;
}

/**
 * Merge a parent workspace config with a child workspace config.
 *
 * Merge behavior by field:
 * - `id`, `name`, `version`, `description`, `type`, `author`, `license`, `tags`, `extends`:
 *   Always from child (identity fields).
 * - `plugins`, `skills`, `personas`: Deduplicated union; child's version wins on conflict.
 * - `mcp_servers`: Merge by server name. Child can add new or override existing.
 * - `settings`, `git_workflow`, `claude_permissions`: Deep merge; child overrides specific keys.
 */
export function mergeWorkspaceConfigs(
  parent: WorkspaceConfigMeta,
  child: WorkspaceConfigMeta,
): WorkspaceConfigMeta {
  return {
    // Identity fields — always from child
    id: child.id,
    name: child.name,
    version: child.version,
    description: child.description,
    type: child.type,
    author: child.author,
    license: child.license,
    tags: child.tags,
    extends: child.extends,

    // Deduplicated union — child version wins
    plugins: deduplicatedUnion(parent.plugins, child.plugins),
    skills: deduplicatedUnion(parent.skills, child.skills),
    personas: deduplicatedUnion(parent.personas, child.personas),

    // Merge by key — child overrides or adds
    mcp_servers: deepMerge(parent.mcp_servers, child.mcp_servers),

    // Deep merge — child overrides specific keys
    settings: deepMerge(parent.settings, child.settings),
    git_workflow: deepMerge(parent.git_workflow, child.git_workflow),
    claude_permissions: parent.claude_permissions || child.claude_permissions
      ? deepMerge(
          (parent.claude_permissions ?? { allow: [], deny: [] }) as Record<string, unknown>,
          (child.claude_permissions ?? {}) as Record<string, unknown>,
        ) as WorkspaceConfigMeta['claude_permissions']
      : undefined,
  };
}
