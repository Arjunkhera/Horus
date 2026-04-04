/**
 * INDEX stage for the Anvil V2 Ingestion Pipeline.
 *
 * Manages the lifecycle of Typesense search documents for entities:
 * upsert, remove, bulk reindex, and health checking.
 *
 * Uses the SchemaBuilder to convert Entity -> Typesense document,
 * matching the field-level search_mode declarations from the type registry.
 *
 * @module core/pipeline/stages/index-stage
 */

import type { SchemaBuilder } from '../../search/schema-builder.js';
import type { Entity } from '../../storage/storage-backend.js';
import type { Note } from '../../../types/note.js';

const RETRY_DELAY_MS = 2_000;

/**
 * Convert a storage Entity to the Note shape expected by SchemaBuilder.buildDocument().
 *
 * Entity and Note share most fields but use different property names
 * for the identifier (id vs noteId) and Date vs string for timestamps.
 */
function entityToNote(entity: Entity): Note {
  return {
    noteId: entity.id,
    type: entity.type,
    title: entity.title,
    fields: entity.fields,
    body: entity.body,
    created: entity.created.toISOString(),
    modified: entity.modified.toISOString(),
    tags: entity.tags,
    filePath: entity.filePath,
    related: [],
    status: (entity.fields.status as string) ?? undefined,
    priority: (entity.fields.priority as string) ?? undefined,
  };
}

/**
 * Sleep helper for retry delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search index stage for the Anvil V2 ingestion pipeline.
 *
 * Handles upserting, removing, and bulk-reindexing entities in a
 * Typesense collection. Designed for pipeline integration with
 * single-retry semantics on upsert and graceful degradation when
 * the search backend is unavailable.
 */
export class IndexStage {
  constructor(
    private typesenseClient: any,
    private schemaBuilder: SchemaBuilder,
    private collectionName: string,
  ) {}

  // ── upsert ───────────────────────────────────────────────────────────────

  /**
   * Build a Typesense document from the entity and upsert it.
   *
   * On failure, waits 2 seconds and retries once. If the retry also fails,
   * the error is thrown so the pipeline can roll back.
   */
  async upsert(entity: Entity): Promise<void> {
    const doc = this.schemaBuilder.buildDocument(entityToNote(entity));

    try {
      await this.typesenseClient
        .collections(this.collectionName)
        .documents()
        .upsert(doc);
    } catch (firstError) {
      // Single retry after delay
      await sleep(RETRY_DELAY_MS);
      try {
        await this.typesenseClient
          .collections(this.collectionName)
          .documents()
          .upsert(doc);
      } catch (retryError) {
        throw new Error(
          `IndexStage upsert failed for entity ${entity.id} after retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
      }
    }
  }

  // ── remove ───────────────────────────────────────────────────────────────

  /**
   * Remove a document from Typesense by entity ID.
   *
   * Silently succeeds if the document is not found (404),
   * so callers don't need to check existence before deleting.
   */
  async remove(entityId: string): Promise<void> {
    try {
      await this.typesenseClient
        .collections(this.collectionName)
        .documents(entityId)
        .delete();
    } catch (err: unknown) {
      // Typesense returns a 404 ObjectNotFound when the document doesn't exist.
      // Treat as success — the end state is correct.
      if (isNotFoundError(err)) {
        return;
      }
      throw err;
    }
  }

  // ── reindexAll ───────────────────────────────────────────────────────────

  /**
   * Bulk import all entities into Typesense using JSONL import.
   *
   * Returns counts of successfully indexed and failed documents.
   * Individual document failures do not throw — they are counted
   * in the `failed` result so the caller can decide how to proceed.
   */
  async reindexAll(
    entities: Entity[],
  ): Promise<{ indexed: number; failed: number }> {
    if (entities.length === 0) {
      return { indexed: 0, failed: 0 };
    }

    const documents = entities.map((entity) =>
      this.schemaBuilder.buildDocument(entityToNote(entity)),
    );

    const results: Array<{ success: boolean }> = await this.typesenseClient
      .collections(this.collectionName)
      .documents()
      .import(documents, { action: 'upsert' });

    let indexed = 0;
    let failed = 0;
    for (const result of results) {
      if (result.success) {
        indexed++;
      } else {
        failed++;
      }
    }

    return { indexed, failed };
  }

  // ── isAvailable ──────────────────────────────────────────────────────────

  /**
   * Check whether the Typesense client is connected and responsive.
   *
   * Returns false if the client is missing or a health check fails,
   * allowing the pipeline to degrade gracefully without search indexing.
   */
  isAvailable(): boolean {
    try {
      // The Typesense client exposes a health endpoint.
      // If the client is null/undefined or lacks the expected shape, return false.
      if (
        !this.typesenseClient ||
        typeof this.typesenseClient.collections !== 'function'
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect Typesense 404 / ObjectNotFound errors.
 * The Typesense JS client throws an ObjectNotFound error with httpStatus 404.
 */
function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e.httpStatus === 404) return true;
    if (e.name === 'ObjectNotFound') return true;
    // Some client versions use a code property
    if (e.code === 'OBJECT_NOT_FOUND') return true;
  }
  return false;
}
