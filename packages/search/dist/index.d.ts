import { Client } from 'typesense';
export { Client as TypesenseClient } from 'typesense';

interface SearchConfig {
    host: string;
    port: number;
    apiKey: string;
    protocol: 'http' | 'https';
}
interface EmbeddingConfig {
    provider: 'openai' | 'cohere';
    apiKey: string;
    model: string;
}
/**
 * Load Typesense connection config from environment variables.
 * Falls back to sensible local-dev defaults.
 */
declare function loadSearchConfig(): SearchConfig;
/**
 * Load embedding config from environment variables.
 * Returns null if no HORUS_EMBEDDING_API_KEY is set (embeddings disabled).
 * Validates the provider against the allowed list.
 */
declare function loadEmbeddingConfig(): EmbeddingConfig | null;

/**
 * Create a Typesense client instance from a SearchConfig.
 */
declare function createClient(config: SearchConfig): Client;

/**
 * Ensure the horus_documents collection exists in Typesense.
 * Idempotent — skips creation if the collection already exists.
 *
 * When an EmbeddingConfig is provided, an auto-embedding field is appended
 * to the schema so Typesense generates vector embeddings on ingest.
 *
 * Retries up to 5 times with 2 s intervals on connection errors.
 */
declare function bootstrapCollection(client: Client, embeddingConfig?: EmbeddingConfig | null): Promise<void>;

export { type EmbeddingConfig, type SearchConfig, bootstrapCollection, createClient, loadEmbeddingConfig, loadSearchConfig };
