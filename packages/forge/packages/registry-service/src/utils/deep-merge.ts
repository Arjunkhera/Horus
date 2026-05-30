/**
 * deepMergeRepo — PATCH semantics for RepoMetadata.
 *
 * Rules:
 *   - Nested objects (workflow, credential, host, vaultScope) are deep-merged:
 *     only the provided sub-keys override the existing value.
 *   - Arrays (topics) and scalars are shallow-replaced when present in the patch.
 *   - `registeredAt` is NEVER changed by a merge, regardless of what the patch contains.
 *   - `updatedAt` is ALWAYS set to new Date().toISOString() after a merge.
 */

import type { RepoMetadata, PatchRepoInput } from '../types/repo-metadata.js';

/**
 * Merge `patch` onto `existing`, returning a new RepoMetadata.
 *
 * @param existing - The current persisted metadata.
 * @param patch    - Deep-partial update — only provided keys are applied, and
 *                   nested sub-schemas (host, workflow, …) may be partial.
 * @returns A new RepoMetadata with the patch applied.
 */
export function deepMergeRepo(
  existing: RepoMetadata,
  patch: PatchRepoInput,
): RepoMetadata {
  // Start with a shallow copy of existing
  const result: RepoMetadata = { ...existing };
  const patchRecord = patch as Record<string, unknown>;

  for (const _key of Object.keys(patch) as Array<keyof RepoMetadata>) {
    const key = _key as keyof RepoMetadata;

    // registeredAt must never change
    if (key === 'registeredAt') continue;

    // updatedAt is handled below
    if (key === 'updatedAt') continue;

    const patchVal = patchRecord[key as string];
    if (patchVal === undefined) continue;

    // Deep-merge for known nested object sub-schemas
    if (
      (key === 'workflow' ||
        key === 'credential' ||
        key === 'host' ||
        key === 'vaultScope') &&
      existing[key] !== undefined &&
      typeof existing[key] === 'object' &&
      !Array.isArray(existing[key]) &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal)
    ) {
      // Safe cast: we know both sides are plain objects for these keys
      (result as Record<string, unknown>)[key] = {
        ...(existing[key] as Record<string, unknown>),
        ...(patchVal as Record<string, unknown>),
      };
    } else {
      // Arrays, scalars, and nested objects that don't exist yet: shallow replace
      (result as Record<string, unknown>)[key] = patchVal;
    }
  }

  // Always update updatedAt
  result.updatedAt = new Date().toISOString();

  return result;
}
