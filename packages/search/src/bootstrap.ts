import type Typesense from 'typesense';
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
    { name: 'created_at', type: 'int64' },
    { name: 'modified_at', type: 'int64', sort: true },
  ],
  default_sorting_field: 'modified_at',
};

// ── Bootstrap ───────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 2000;

/**
 * Ensure the horus_documents collection exists in Typesense.
 * Idempotent — skips creation if the collection already exists.
 *
 * When an EmbeddingConfig is provided, an auto-embedding field is appended
 * to the schema so Typesense generates vector embeddings on ingest.
 *
 * Retries up to 5 times with 2 s intervals on connection errors.
 */
export async function bootstrapCollection(
  client: Typesense.Client,
  embeddingConfig?: EmbeddingConfig | null,
): Promise<void> {
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

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Check if the collection already exists
      const collections = await client.collections().retrieve();
      const exists = collections.some((c) => c.name === COLLECTION_NAME);
      if (exists) {
        return; // Already bootstrapped — nothing to do
      }

      await client.collections().create(schema);
      return; // Success
    } catch (err: unknown) {
      lastError = err;

      // Only retry on connection-level errors (ECONNREFUSED, timeout, etc.)
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
