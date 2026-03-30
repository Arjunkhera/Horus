import type { Client as TypesenseClient } from 'typesense';
import type { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections.js';
import type { EmbeddingConfig } from './config.js';

// ── Collection schema ───────────────────────────────────────────────────────

const COLLECTION_NAME = 'horus_documents';

const BASE_SCHEMA: CollectionCreateSchema = {
  name: COLLECTION_NAME,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'source', type: 'string', facet: true },
    { name: 'source_type', type: 'string', facet: true },
    { name: 'title', type: 'string' },
    { name: 'body', type: 'string' },
    { name: 'tags', type: 'string[]', facet: true },
    { name: 'status', type: 'string', facet: true, optional: true },
    { name: 'priority', type: 'string', facet: true, optional: true },
    { name: 'assignee_id', type: 'string', facet: true, optional: true },
    { name: 'project_id', type: 'string', facet: true, optional: true },
    { name: 'project_name', type: 'string', optional: true },
    { name: 'due_at', type: 'int64', optional: true },
    { name: 'mode', type: 'string', facet: true, optional: true },
    { name: 'scope_repo', type: 'string', facet: true, optional: true },
    { name: 'scope_program', type: 'string', facet: true, optional: true },
    { name: 'scope_context', type: 'string', facet: true, optional: true },
    { name: 'vault_name', type: 'string', facet: true, optional: true },
    // Vault content quality signals (optional — Anvil/Forge documents are unaffected)
    { name: 'confidence', type: 'int32', optional: true },
    { name: 'auto_generated', type: 'bool', facet: true, optional: true },
    { name: 'aliases', type: 'string[]', facet: true, optional: true },
    // Forge-specific fields (optional — Anvil/Vault documents are unaffected)
    { name: 'local_path', type: 'string', optional: true },
    { name: 'remote_url', type: 'string', optional: true },
    { name: 'language', type: 'string', facet: true, optional: true },
    { name: 'clone_state', type: 'string', facet: true, optional: true },
    { name: 'default_branch', type: 'string', optional: true },
    { name: 'created_at', type: 'int64' },
    { name: 'modified_at', type: 'int64', sort: true },
  ],
  default_sorting_field: 'modified_at',
};

export interface BootstrapResult {
  /** True if the collection was freshly created or migrated — caller should re-index. */
  migrated: boolean;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 2000;

/**
 * Ensure the horus_documents collection exists in Typesense with the correct schema.
 *
 * Migration: if the collection already exists but the embedding field state does not
 * match the desired config (e.g. key added or removed), the collection is dropped and
 * recreated. Caller should re-index when `migrated: true` is returned.
 *
 * Retries up to 5 times with 2 s intervals on connection errors.
 */
export async function bootstrapCollection(
  client: TypesenseClient,
  embeddingConfig?: EmbeddingConfig | null,
): Promise<BootstrapResult> {
  const schema = buildSchema(embeddingConfig);

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const collections = await client.collections().retrieve();
      const existing = collections.find((c: { name: string }) => c.name === COLLECTION_NAME);

      if (existing) {
        const existingFields = (existing as { fields?: Array<{ name: string }> }).fields ?? [];
        const existingFieldNames = new Set(existingFields.map((f) => f.name));

        const hasEmbedding = existingFieldNames.has('embedding');
        const wantsEmbedding = embeddingConfig != null;

        if (hasEmbedding !== wantsEmbedding) {
          // Embedding mismatch: drop and recreate (embedding changes require full rebuild)
          await client.collections(COLLECTION_NAME).delete();
        } else {
          // Check for missing optional fields and add them via alter API
          const missingFields = schema.fields!.filter(
            (f) => !existingFieldNames.has(f.name) && f.name !== 'embedding',
          );
          if (missingFields.length > 0) {
            await client.collections(COLLECTION_NAME).update({ fields: missingFields } as Parameters<ReturnType<TypesenseClient['collections']>['update']>[0]);
            return { migrated: true };
          }
          return { migrated: false }; // Schema matches — nothing to do
        }
      }

      await client.collections().create(schema);
      return { migrated: true };
    } catch (err: unknown) {
      lastError = err;

      const isConnectionError =
        err instanceof Error &&
        (err.message.includes('ECONNREFUSED') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('connect') ||
          err.message.includes('timeout'));

      if (!isConnectionError || attempt === MAX_RETRIES) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  throw lastError;
}

function buildSchema(embeddingConfig?: EmbeddingConfig | null): CollectionCreateSchema {
  const schema = structuredClone(BASE_SCHEMA);

  if (embeddingConfig) {
    schema.fields!.push({
      name: 'embedding',
      type: 'float[]',
      embed: {
        from: ['title', 'body'],
        model_config: {
          model_name: `${embeddingConfig.provider}/${embeddingConfig.model}`,
          api_key: embeddingConfig.apiKey,
        },
      },
    } as CollectionCreateSchema['fields'][number]);
  }

  return schema;
}
