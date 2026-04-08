import { createHash } from 'crypto';
import semver from 'semver';
import type { ArtifactRef, ResolvedArtifact, ArtifactMeta, ArtifactBundle, WorkspaceConfigMeta } from '../models/index.js';
import type { Registry } from '../registry/registry.js';
import { CircularDependencyError, VersionMismatchError, ArtifactNotFoundError, InheritanceDepthError } from '../adapters/errors.js';
import { mergeWorkspaceConfigs } from '../workspace/merge-workspace-configs.js';

type ResolutionState = 'pending' | 'fetching' | 'fetched' | 'resolving-deps' | 'resolved' | 'cached';

interface ResolutionEntry {
  state: ResolutionState;
  result?: ResolvedArtifact;
}

/**
 * A single entry in forge.lock produced by the resolver.
 */
export interface LockEntry {
  /** Artifact type:id key */
  key: string;
  /** The original requested version range */
  requestedRange: string;
  /** The resolved (pinned) semver version */
  resolvedVersion: string;
  /** SHA-256 checksum of the artifact content */
  sha256: string;
}

/**
 * Resolves artifact references recursively, handling dependencies,
 * circular dependency detection, semver range resolution, and in-memory caching.
 *
 * When the adapter supports `listVersions`, ranges like `^1.0.0`, `~1.2.0`,
 * `>=1.0.0 <2.0.0` are resolved to the best matching version via
 * `semver.maxSatisfying`. The dependency graph is built with pinned
 * (exact) versions, not ranges.
 *
 * @example
 * const resolver = new Resolver(registry);
 * const resolved = await resolver.resolve({ type: 'skill', id: 'developer', version: '^1.0.0' });
 * console.log(resolved.ref.version); // '1.2.3' (pinned)
 */
export class Resolver {
  /** In-memory cache for this install run: key = "type:id@version" */
  private cache = new Map<string, ResolvedArtifact>();
  /** Cache version resolution: key = "type:id@range" -> pinned version */
  private versionCache = new Map<string, string>();
  /** Track resolution in-progress for circular detection: keys in the call stack */
  private inProgress = new Set<string>();
  /** Lock entries accumulated during resolution */
  private lockEntries = new Map<string, LockEntry>();

  constructor(private readonly registry: Registry) {}

  /**
   * Reset resolver state (call between install runs).
   */
  reset(): void {
    this.cache.clear();
    this.versionCache.clear();
    this.inProgress.clear();
    this.lockEntries.clear();
  }

  /**
   * Get the lock entries accumulated during this resolution run.
   * Each entry contains the artifact key, requested range, resolved version, and SHA-256 checksum.
   */
  getLockEntries(): LockEntry[] {
    return Array.from(this.lockEntries.values());
  }

  /**
   * Resolve a single artifact reference, including all its dependencies.
   *
   * Version resolution strategy:
   * - `@latest` or `@*` or no version: highest available version
   * - Exact version `@1.1.0`: that specific version
   * - Range `@^1.0.0`, `@~1.2.0`, `@>=1.0.0 <2.0.0`: best match via semver.maxSatisfying
   *
   * The returned `ResolvedArtifact.ref.version` is always a pinned (exact) version.
   *
   * @throws {CircularDependencyError} if a dependency cycle is detected
   * @throws {VersionMismatchError} if no version satisfies the range
   * @throws {ArtifactNotFoundError} if artifact doesn't exist
   */
  async resolve(ref: ArtifactRef, callStack: string[] = []): Promise<ResolvedArtifact> {
    // First resolve the version range to a pinned version
    const pinnedRef = await this.resolveVersion(ref);
    const cacheKey = `${pinnedRef.type}:${pinnedRef.id}@${pinnedRef.version}`;

    // Return cached result
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Circular dependency check (use type:id to catch cycles regardless of version)
    const circularKey = `${pinnedRef.type}:${pinnedRef.id}`;
    if (this.inProgress.has(circularKey)) {
      const cycle = [...callStack, circularKey];
      throw new CircularDependencyError(cycle);
    }

    // Mark as in-progress
    this.inProgress.add(circularKey);

    try {
      // Fetch from registry using the pinned version
      const fetchId = pinnedRef.version ? `${pinnedRef.id}@${pinnedRef.version}` : pinnedRef.id;
      let bundle = await this.registry.get({
        ...pinnedRef,
        id: fetchId,
      });

      // Handle workspace-config inheritance (extends)
      if (bundle.meta.type === 'workspace-config') {
        bundle = await this.resolveInheritance(bundle);
      }

      // Resolve dependencies
      const deps = this.extractDependencies(bundle.meta);
      const resolvedDeps: ResolvedArtifact[] = [];

      for (const dep of deps) {
        const resolvedDep = await this.resolve(dep, [...callStack, circularKey]);
        resolvedDeps.push(resolvedDep);
      }

      const resolved: ResolvedArtifact = {
        ref: pinnedRef,
        bundle,
        dependencies: resolvedDeps,
      };

      // Record lock entry
      const lockKey = `${pinnedRef.type}:${pinnedRef.id}`;
      if (!this.lockEntries.has(lockKey)) {
        this.lockEntries.set(lockKey, {
          key: lockKey,
          requestedRange: ref.version,
          resolvedVersion: pinnedRef.version,
          sha256: this.computeChecksum(bundle),
        });
      }

      // Cache the result
      this.cache.set(cacheKey, resolved);
      return resolved;

    } finally {
      this.inProgress.delete(circularKey);
    }
  }

  /**
   * Batch resolve a list of artifact refs in dependency order.
   * Returns deduplicated list with dependencies first.
   */
  async resolveAll(refs: ArtifactRef[]): Promise<ResolvedArtifact[]> {
    const resolved: ResolvedArtifact[] = [];
    const seen = new Set<string>();

    for (const ref of refs) {
      const r = await this.resolve(ref);
      this.collectOrdered(r, resolved, seen);
    }

    return resolved;
  }

  /**
   * Resolve a version range to a pinned (exact) version.
   *
   * Uses the adapter's `listVersions` when available. Falls back to
   * fetching the artifact directly (which returns the latest version
   * in flat-layout registries).
   */
  private async resolveVersion(ref: ArtifactRef): Promise<ArtifactRef> {
    const versionCacheKey = `${ref.type}:${ref.id}@${ref.version}`;
    const cached = this.versionCache.get(versionCacheKey);
    if (cached) {
      return { ...ref, version: cached };
    }

    const resolved = await this.resolveVersionUncached(ref);
    this.versionCache.set(versionCacheKey, resolved.version);
    return resolved;
  }

  private async resolveVersionUncached(ref: ArtifactRef): Promise<ArtifactRef> {
    const version = ref.version;

    // If no version specified, or wildcard/latest — resolve to highest available
    const isWildcard = !version || version === '*' || version === 'latest';

    // Check if this is already an exact version (not a range)
    const isExact = !isWildcard && semver.valid(version) !== null;

    // Try to get available versions from the adapter
    const availableVersions = await this.registry.listVersions(ref.type, ref.id);

    if (availableVersions.length === 0) {
      // No versioned layout — fall back to flat layout behavior.
      // Fetch the artifact directly; its metadata contains the version.
      if (isWildcard) {
        // Let the adapter resolve to latest (flat layout)
        const bundle = await this.registry.get(ref);
        return { ...ref, version: bundle.meta.version };
      }

      if (isExact) {
        // Exact version requested, flat layout — fetch and validate
        const bundle = await this.registry.get(ref);
        if (!semver.satisfies(bundle.meta.version, version)) {
          throw new VersionMismatchError(ref.id, version, [bundle.meta.version]);
        }
        return { ...ref, version: bundle.meta.version };
      }

      // Range requested, flat layout — fetch and check
      const bundle = await this.registry.get(ref);
      if (!semver.satisfies(bundle.meta.version, version)) {
        throw new VersionMismatchError(ref.id, version, [bundle.meta.version]);
      }
      return { ...ref, version: bundle.meta.version };
    }

    // We have available versions — do proper semver resolution
    if (isWildcard) {
      // Return the highest version (already sorted descending)
      return { ...ref, version: availableVersions[0]! };
    }

    if (isExact) {
      // Exact version — check it exists
      if (availableVersions.includes(version)) {
        return ref;
      }
      throw new VersionMismatchError(ref.id, version, availableVersions);
    }

    // Range resolution — find best match
    const best = semver.maxSatisfying(availableVersions, version);
    if (!best) {
      throw new VersionMismatchError(ref.id, version, availableVersions);
    }

    return { ...ref, version: best };
  }

  /**
   * Compute a SHA-256 checksum for an artifact bundle.
   * Hashes the content string for consistency.
   */
  private computeChecksum(bundle: ArtifactBundle): string {
    const hash = createHash('sha256');
    hash.update(bundle.content || '');
    // Also include metadata version for uniqueness
    hash.update(bundle.meta.version);
    return hash.digest('hex');
  }

  /**
   * Resolve workspace-config inheritance.
   * If the config has an `extends` field, fetch the parent, enforce single-level
   * constraint (parent must NOT also extend), and merge parent + child.
   */
  private async resolveInheritance(bundle: ArtifactBundle): Promise<ArtifactBundle> {
    const meta = bundle.meta as WorkspaceConfigMeta;
    if (!meta.extends) {
      return bundle;
    }

    // Parse the extends reference: "parent-id@1.0.0" or "parent-id"
    const atIdx = meta.extends.lastIndexOf('@');
    let parentId: string;
    let parentVersion: string;
    if (atIdx > 0) {
      parentId = meta.extends.slice(0, atIdx);
      parentVersion = meta.extends.slice(atIdx + 1);
    } else {
      parentId = meta.extends;
      parentVersion = '*';
    }

    // Resolve the parent workspace-config from the registry
    const parentRef: ArtifactRef = {
      type: 'workspace-config',
      id: parentId,
      version: parentVersion,
    };

    const pinnedParentRef = await this.resolveVersion(parentRef);
    const parentFetchId = pinnedParentRef.version
      ? `${pinnedParentRef.id}@${pinnedParentRef.version}`
      : pinnedParentRef.id;
    const parentBundle = await this.registry.get({
      ...pinnedParentRef,
      id: parentFetchId,
    });

    const parentMeta = parentBundle.meta as WorkspaceConfigMeta;

    // Single-level constraint: parent must not also extend
    if (parentMeta.extends) {
      throw new InheritanceDepthError(parentId, parentMeta.extends);
    }

    // Merge parent + child
    const mergedMeta = mergeWorkspaceConfigs(parentMeta, meta);

    return {
      ...bundle,
      meta: mergedMeta,
    };
  }

  private collectOrdered(
    artifact: ResolvedArtifact,
    output: ResolvedArtifact[],
    seen: Set<string>,
  ): void {
    // Dependencies first (depth-first)
    for (const dep of artifact.dependencies) {
      this.collectOrdered(dep, output, seen);
    }
    const key = `${artifact.ref.type}:${artifact.ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(artifact);
    }
  }

  private extractDependencies(meta: ArtifactMeta): ArtifactRef[] {
    const deps: ArtifactRef[] = [];

    if ('dependencies' in meta && meta.dependencies) {
      for (const [id, version] of Object.entries(meta.dependencies as Record<string, string>)) {
        // Try to infer type from id prefix (e.g., "agent:sdlc") or default to skill
        let type: 'skill' | 'agent' | 'plugin' = 'skill';
        let resolvedId = id;

        if (id.startsWith('agent:')) {
          type = 'agent';
          resolvedId = id.slice(6);
        } else if (id.startsWith('plugin:')) {
          type = 'plugin';
          resolvedId = id.slice(7);
        } else if (id.startsWith('skill:')) {
          resolvedId = id.slice(6);
        }

        deps.push({ type, id: resolvedId, version });
      }
    }

    // For agents: also resolve their listed skills
    if (meta.type === 'agent' && 'skills' in meta && Array.isArray(meta.skills)) {
      for (const skillId of (meta.skills as string[])) {
        if (!deps.find(d => d.id === skillId)) {
          deps.push({ type: 'skill', id: skillId, version: '*' });
        }
      }
    }

    // For plugins: resolve their listed skills
    if (meta.type === 'plugin' && 'skills' in meta && Array.isArray(meta.skills)) {
      for (const skillId of (meta.skills as string[])) {
        if (!deps.find(d => d.id === skillId)) {
          deps.push({ type: 'skill', id: skillId, version: '*' });
        }
      }
    }

    // For workspace-configs: resolve referenced plugins and skills
    if (meta.type === 'workspace-config' && 'plugins' in meta && Array.isArray(meta.plugins)) {
      for (const pluginId of (meta.plugins as string[])) {
        if (!deps.find(d => d.id === pluginId)) {
          deps.push({ type: 'plugin', id: pluginId, version: '*' });
        }
      }
    }

    if (meta.type === 'workspace-config' && 'skills' in meta && Array.isArray(meta.skills)) {
      for (const skillId of (meta.skills as string[])) {
        if (!deps.find(d => d.id === skillId)) {
          deps.push({ type: 'skill', id: skillId, version: '*' });
        }
      }
    }

    return deps;
  }
}
