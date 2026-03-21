import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
import { AllAdaptersFailedError } from './errors.js';

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
export class CompositeAdapter implements DataAdapter {
  private readonly adapters: DataAdapter[];
  private readonly writableAdapter: DataAdapter;

  constructor(options: CompositeAdapterOptions) {
    if (options.adapters.length === 0) {
      throw new Error('CompositeAdapter requires at least one adapter');
    }

    this.adapters = options.adapters;
    const writableIndex = options.writableIndex ?? 0;

    if (writableIndex < 0 || writableIndex >= this.adapters.length) {
      throw new Error(
        `writableIndex ${writableIndex} is out of bounds (0–${this.adapters.length - 1})`
      );
    }

    this.writableAdapter = this.adapters[writableIndex]!;
  }

  /**
   * List artifacts from all adapters, merging and deduplicating by id.
   * Higher-priority adapters (lower index) win on id collision.
   */
  async list(type: ArtifactType): Promise<ArtifactMeta[]> {
    const seen = new Map<string, ArtifactMeta>();

    for (const adapter of this.adapters) {
      try {
        const results = await adapter.list(type);
        for (const meta of results) {
          // Higher-priority adapter was processed first; skip duplicates
          if (!seen.has(meta.id)) {
            seen.set(meta.id, meta);
          }
        }
      } catch (err: any) {
        console.warn(
          `[CompositeAdapter] Adapter failed during list(${type}): ${err.message}. Trying next adapter.`
        );
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Read an artifact by trying adapters in priority order.
   * Returns the first successful result.
   *
   * @throws {AllAdaptersFailedError} if no adapter has the artifact
   */
  async read(type: ArtifactType, id: string): Promise<ArtifactBundle> {
    const sourcesTried: string[] = [];

    for (const adapter of this.adapters) {
      try {
        return await adapter.read(type, id);
      } catch (err: any) {
        const adapterName = adapter.constructor.name;
        sourcesTried.push(adapterName);
        console.warn(
          `[CompositeAdapter] ${adapterName}.read(${type}, ${id}) failed: ${err.message}. Trying next adapter.`
        );
      }
    }

    throw new AllAdaptersFailedError(type, id, sourcesTried);
  }

  /**
   * Check if an artifact exists by trying adapters in priority order.
   * Returns true on the first hit.
   */
  async exists(type: ArtifactType, id: string): Promise<boolean> {
    for (const adapter of this.adapters) {
      try {
        const found = await adapter.exists(type, id);
        if (found) return true;
      } catch (err: any) {
        console.warn(
          `[CompositeAdapter] ${adapter.constructor.name}.exists(${type}, ${id}) failed: ${err.message}. Trying next adapter.`
        );
      }
    }

    return false;
  }

  /**
   * Write an artifact to the designated writable adapter.
   */
  async write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void> {
    await this.writableAdapter.write(type, id, bundle);
  }
}
