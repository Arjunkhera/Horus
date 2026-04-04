// Handler for anvil_create_note tool

import { v4 as uuidv4 } from 'uuid';
import type {
  CreateNoteInput,
  CreateNoteOutput,
  AnvilError,
  Note,
  ResolvedType,
} from '../types/index.js';
import { makeError, ERROR_CODES, isAnvilError } from '../types/index.js';
import { validateNote } from '../registry/validator.js';
import { readNote, writeNote, generateFilePath } from '../storage/file-store.js';
import { upsertNote } from '../index/indexer.js';
import { join } from 'node:path';
import type { TypeRegistry } from '../registry/type-registry.js';
import type { AnvilDatabase } from '../index/sqlite.js';
import type { AnvilWatcher } from '../storage/watcher.js';
import type { SearchEngine } from '../core/search/engine.js';
import type { TypesenseClient } from '@horus/search';
import { pushToTypesense } from '../core/search/typesense-doc.js';
import type { GitSyncEngine } from '../core/sync/engine.js';
import type { StorageBackend } from '../core/storage/storage-backend.js';
import type { FileStore } from '../core/storage/file-store.js';
import type { Neo4jEdgeStore } from '../core/graph/neo4j-edge-store.js';
import type { IntentRegistry } from '../core/graph/intent-registry.js';
import type { SchemaBuilder } from '../core/search/schema-builder.js';
import type { IngestPipeline } from '../core/pipeline/ingest-pipeline.js';

export type ToolContext = {
  vaultPath: string;
  registry: TypeRegistry;
  db: AnvilDatabase;
  watcher?: AnvilWatcher;
  searchEngine?: SearchEngine;
  typesenseClient?: TypesenseClient;
  syncEngine?: GitSyncEngine;
  /**
   * Attempt to (re)connect to Typesense. Updates searchEngine and typesenseClient
   * on success. Concurrent calls share the same in-flight attempt.
   * Returns true if Typesense is now available, false otherwise.
   */
  tryReconnect?: () => Promise<boolean>;

  // V2 optional fields (present when V2 bootstrap runs)
  storageBackend?: StorageBackend;
  fileStore?: FileStore;
  edgeStore?: Neo4jEdgeStore;
  intentRegistry?: IntentRegistry;
  schemaBuilder?: SchemaBuilder;
  pipeline?: IngestPipeline;
};

/**
 * Handle anvil_create_note request.
 * Creates a new note with auto-generated ID, applies type template,
 * validates against schema, writes to filesystem, and indexes.
 */
export async function handleCreateNote(
  input: CreateNoteInput,
  ctx: ToolContext
): Promise<CreateNoteOutput | AnvilError> {
  try {
    // 1. Validate type exists in registry
    if (!ctx.registry.hasType(input.type)) {
      return makeError(
        ERROR_CODES.TYPE_NOT_FOUND,
        `Type not found: ${input.type}`
      );
    }

    const type = ctx.registry.getType(input.type);
    if (!type) {
      return makeError(
        ERROR_CODES.TYPE_NOT_FOUND,
        `Type not found: ${input.type}`
      );
    }

    // 2. Generate noteId and timestamps
    const noteId = uuidv4();
    const now = new Date().toISOString();

    // 3. Build initial frontmatter
    const frontmatter: Record<string, unknown> = {
      noteId,
      type: input.type,
      title: input.title,
      created: now,
      modified: now,
    };

    // Apply type template defaults (if any)
    if (type.template?.frontmatter) {
      Object.assign(frontmatter, type.template.frontmatter);
    }

    // Merge caller-provided fields
    if (input.fields) {
      Object.assign(frontmatter, input.fields);
    }

    // 4. Handle body content
    // Explicit content always takes precedence over the type template body.
    // Template body is only used when no content is provided and use_template is true.
    const useTemplate = input.use_template !== false;
    let body = '';
    if (input.content) {
      body = input.content;
    } else if (useTemplate && type.template?.body) {
      body = type.template.body;
    }

    // 5. Build Note object with metadata
    const note: Note = {
      noteId,
      type: input.type,
      title: input.title,
      created: now,
      modified: now,
      tags: (frontmatter.tags as string[]) || [],
      related: (frontmatter.related as string[]) || [],
      scope: frontmatter.scope as any,
      status: frontmatter.status as string | undefined,
      priority: frontmatter.priority as string | undefined,
      due: frontmatter.due as string | undefined,
      effort:
        typeof frontmatter.effort === 'number' ? frontmatter.effort : undefined,
      fields: extractTypeSpecificFields(frontmatter, type),
      body,
      filePath: '', // Will be set
    };

    // 6. Validate merged note against type schema (strict mode)
    const validation = validateNote(frontmatter, type, 'strict');
    if (!validation.valid) {
      const fieldErrors = validation.errors.map((e) => ({
        field: e.field,
        message: e.message,
        allowed_values: e.allowed_values,
      }));
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Note validation failed`,
        { fields: fieldErrors }
      );
    }

    // 7. Generate file path (slug from title, flat strategy)
    const filePath = await generateFilePath(
      ctx.vaultPath,
      input.title,
      input.type,
      'flat'
    );
    note.filePath = join(ctx.vaultPath, filePath);

    // 8. Write note to filesystem
    try {
      await writeNote(note);
    } catch (err) {
      return makeError(
        ERROR_CODES.IO_ERROR,
        `Failed to write note to filesystem: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // 9. Upsert into SQLite index
    try {
      upsertNote(ctx.db.raw, note);
    } catch (err) {
      return makeError(
        ERROR_CODES.SERVER_ERROR,
        `Failed to index note: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // 10. Push to Typesense (fire-and-forget)
    if (ctx.typesenseClient) {
      void pushToTypesense(ctx.typesenseClient, note);
    }

    // 11. Return result
    return {
      noteId,
      filePath,
      title: input.title,
      type: input.type,
    };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error creating note: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Extract type-specific fields from frontmatter.
 * Excludes standard note fields (noteId, created, modified, type, title, etc.)
 */
function extractTypeSpecificFields(
  frontmatter: Record<string, unknown>,
  type: ResolvedType
): Record<string, unknown> {
  const standardFields = new Set([
    'noteId',
    'type',
    'title',
    'created',
    'modified',
    'tags',
    'related',
    'scope',
    'status',
    'priority',
    'due',
    'effort',
  ]);

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!standardFields.has(key)) {
      fields[key] = value;
    }
  }

  return fields;
}
