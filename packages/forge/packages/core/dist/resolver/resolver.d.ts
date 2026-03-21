import type { ArtifactRef, ResolvedArtifact } from '../models/index.js';
import type { Registry } from '../registry/registry.js';
/**
 * Resolves artifact references recursively, handling dependencies,
 * circular dependency detection, and in-memory caching.
 *
 * @example
 * const resolver = new Resolver(registry);
 * const resolved = await resolver.resolve({ type: 'skill', id: 'developer', version: '1.0.0' });
 * console.log(resolved.dependencies.map(d => d.ref.id));
 */
export declare class Resolver {
    private readonly registry;
    /** In-memory cache for this install run: key = "type:id" */
    private cache;
    /** Track resolution in-progress for circular detection: keys in the call stack */
    private inProgress;
    constructor(registry: Registry);
    /**
     * Reset resolver state (call between install runs).
     */
    reset(): void;
    /**
     * Resolve a single artifact reference, including all its dependencies.
     * @throws {CircularDependencyError} if a dependency cycle is detected
     * @throws {VersionMismatchError} if no version satisfies the range
     * @throws {ArtifactNotFoundError} if artifact doesn't exist
     */
    resolve(ref: ArtifactRef, callStack?: string[]): Promise<ResolvedArtifact>;
    /**
     * Batch resolve a list of artifact refs in dependency order.
     * Returns deduplicated list with dependencies first.
     */
    resolveAll(refs: ArtifactRef[]): Promise<ResolvedArtifact[]>;
    private collectOrdered;
    private extractDependencies;
}
//# sourceMappingURL=resolver.d.ts.map