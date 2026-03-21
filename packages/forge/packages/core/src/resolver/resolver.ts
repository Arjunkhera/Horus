import semver from 'semver';
import type { ArtifactRef, ResolvedArtifact, ArtifactMeta } from '../models/index.js';
import type { Registry } from '../registry/registry.js';
import { CircularDependencyError, VersionMismatchError, ArtifactNotFoundError } from '../adapters/errors.js';

type ResolutionState = 'pending' | 'fetching' | 'fetched' | 'resolving-deps' | 'resolved' | 'cached';

interface ResolutionEntry {
  state: ResolutionState;
  result?: ResolvedArtifact;
}

/**
 * Resolves artifact references recursively, handling dependencies,
 * circular dependency detection, and in-memory caching.
 *
 * @example
 * const resolver = new Resolver(registry);
 * const resolved = await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
 * console.log(resolved.dependencies.map(d => d.ref.id));
 */
export class Resolver {
  /** In-memory cache for this install run: key = "type:id" */
  private cache = new Map<string, ResolvedArtifact>();
  /** Track resolution in-progress for circular detection: keys in the call stack */
  private inProgress = new Set<string>();

  constructor(private readonly registry: Registry) {}

  /**
   * Reset resolver state (call between install runs).
   */
  reset(): void {
    this.cache.clear();
    this.inProgress.clear();
  }

  /**
   * Resolve a single artifact reference, including all its dependencies.
   * @throws {CircularDependencyError} if a dependency cycle is detected
   * @throws {VersionMismatchError} if no version satisfies the range
   * @throws {ArtifactNotFoundError} if artifact doesn't exist
   */
  async resolve(ref: ArtifactRef, callStack: string[] = []): Promise<ResolvedArtifact> {
    const cacheKey = `${ref.type}:${ref.id}`;

    // Return cached result
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Circular dependency check
    if (this.inProgress.has(cacheKey)) {
      const cycle = [...callStack, cacheKey];
      throw new CircularDependencyError(cycle);
    }

    // Mark as in-progress
    this.inProgress.add(cacheKey);

    try {
      // Fetch from registry
      const bundle = await this.registry.get(ref);

      // Validate version if it's a range (not a wildcard)
      if (ref.version && ref.version !== '*' && ref.version !== 'latest') {
        const metaVersion = bundle.meta.version;
        const satisfied = semver.satisfies(metaVersion, ref.version);
        if (!satisfied) {
          throw new VersionMismatchError(ref.id, ref.version, [metaVersion]);
        }
      }

      // Resolve dependencies
      const deps = this.extractDependencies(bundle.meta);
      const resolvedDeps: ResolvedArtifact[] = [];

      for (const dep of deps) {
        const resolvedDep = await this.resolve(dep, [...callStack, cacheKey]);
        resolvedDeps.push(resolvedDep);
      }

      const resolved: ResolvedArtifact = {
        ref,
        bundle,
        dependencies: resolvedDeps,
      };

      // Cache the result
      this.cache.set(cacheKey, resolved);
      return resolved;

    } finally {
      this.inProgress.delete(cacheKey);
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
