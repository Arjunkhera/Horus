// ── Search configuration ────────────────────────────────────────────────────

export interface SearchConfig {
  host: string;
  port: number;
  apiKey: string;
  protocol: 'http' | 'https';
}

export interface EmbeddingConfig {
  provider: 'openai' | 'cohere';
  apiKey: string;
  model: string;
}

const ALLOWED_EMBEDDING_PROVIDERS = ['openai', 'cohere'] as const;

/**
 * Load Typesense connection config from environment variables.
 * Falls back to sensible local-dev defaults.
 */
export function loadSearchConfig(): SearchConfig {
  return {
    host: process.env.TYPESENSE_HOST ?? 'localhost',
    port: parseInt(process.env.TYPESENSE_PORT ?? '8108', 10),
    apiKey: process.env.TYPESENSE_API_KEY ?? 'horus-local-key',
    protocol: (process.env.TYPESENSE_PROTOCOL as 'http' | 'https') ?? 'http',
  };
}

/**
 * Load embedding config from environment variables.
 * Returns null if no HORUS_EMBEDDING_API_KEY is set (embeddings disabled).
 * Validates the provider against the allowed list.
 */
export function loadEmbeddingConfig(): EmbeddingConfig | null {
  const apiKey = process.env.HORUS_EMBEDDING_API_KEY;
  if (!apiKey) return null;

  const provider = (process.env.HORUS_EMBEDDING_PROVIDER ?? 'openai') as string;
  if (!ALLOWED_EMBEDDING_PROVIDERS.includes(provider as typeof ALLOWED_EMBEDDING_PROVIDERS[number])) {
    throw new Error(
      `Invalid embedding provider "${provider}". Allowed: ${ALLOWED_EMBEDDING_PROVIDERS.join(', ')}`
    );
  }

  return {
    provider: provider as 'openai' | 'cohere',
    apiKey,
    model: process.env.HORUS_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  };
}
