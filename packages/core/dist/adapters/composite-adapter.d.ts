import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
/**
 * Options for constructing a CompositeAdapter.
 *
 * @example
 * const composite = new CompositeAdapter({
 *   adapters: [localAdapter, gitAdapter],
 *   writableIndex: 0,
 * });
 */
export interface CompositeAdapterOptions {
    /** Adapters in priority order (index 0 = highest priority). */
    adapters: DataAdapter[];
    /**
     * Index of the adapter to use for write operations.
     * Defaults to 0 (first / highest-priority adapter).
     */
    writableIndex?: number;
}
/**
 * Chains multiple DataAdapters with priority ordering.
 *
 * - `read()` / `exists()`: tries adapters in priority order, returns first hit.
 * - `list()`: queries all adapters, merges results, deduplicates by id (higher priority wins).
 * - `write()`: delegates to a single designated "writable" adapter.
 *
 * If an individual adapter throws, the error is logged and the next adapter is tried.
 * If all adapters fail, an {@link AllAdaptersFailedError} is thrown.
 *
 * @example
 * const composite = new CompositeAdapter({
 *   adapters: [localAdapter, remoteAdapter],
 * });
 * const skills = await composite.list('skill'); // merged from both
 */
export declare class CompositeAdapter implements DataAdapter {
    private readonly adapters;
    private readonly writableAdapter;
    constructor(options: CompositeAdapterOptions);
    /**
     * List artifacts from all adapters, merging and deduplicating by id.
     * Higher-priority adapters (lower index) win on id collision.
     */
    list(type: ArtifactType): Promise<ArtifactMeta[]>;
    /**
     * Read an artifact by trying adapters in priority order.
     * Returns the first successful result.
     *
     * @throws {AllAdaptersFailedError} if no adapter has the artifact
     */
    read(type: ArtifactType, id: string): Promise<ArtifactBundle>;
    /**
     * Check if an artifact exists by trying adapters in priority order.
     * Returns true on the first hit.
     */
    exists(type: ArtifactType, id: string): Promise<boolean>;
    /**
     * Write an artifact to the designated writable adapter.
     */
    write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void>;
}
//# sourceMappingURL=composite-adapter.d.ts.map