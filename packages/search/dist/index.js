// src/config.ts
var ALLOWED_EMBEDDING_PROVIDERS = ["openai", "cohere"];
function loadSearchConfig() {
  return {
    host: process.env.TYPESENSE_HOST ?? "localhost",
    port: parseInt(process.env.TYPESENSE_PORT ?? "8108", 10),
    apiKey: process.env.TYPESENSE_API_KEY ?? "horus-local-key",
    protocol: process.env.TYPESENSE_PROTOCOL ?? "http"
  };
}
function loadEmbeddingConfig() {
  const apiKey = process.env.HORUS_EMBEDDING_API_KEY;
  if (!apiKey) return null;
  const provider = process.env.HORUS_EMBEDDING_PROVIDER ?? "openai";
  if (!ALLOWED_EMBEDDING_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid embedding provider "${provider}". Allowed: ${ALLOWED_EMBEDDING_PROVIDERS.join(", ")}`
    );
  }
  return {
    provider,
    apiKey,
    model: process.env.HORUS_EMBEDDING_MODEL ?? "text-embedding-3-small"
  };
}

// src/client.ts
import Typesense from "typesense";
function createClient(config) {
  return new Typesense.Client({
    nodes: [
      {
        host: config.host,
        port: config.port,
        protocol: config.protocol
      }
    ],
    apiKey: config.apiKey,
    connectionTimeoutSeconds: 5
  });
}

// src/bootstrap.ts
var COLLECTION_NAME = "horus_documents";
var BASE_SCHEMA = {
  name: COLLECTION_NAME,
  fields: [
    { name: "id", type: "string" },
    { name: "source", type: "string", facet: true },
    { name: "source_type", type: "string", facet: true },
    { name: "title", type: "string" },
    { name: "body", type: "string" },
    { name: "tags", type: "string[]", facet: true },
    { name: "status", type: "string", facet: true, optional: true },
    { name: "priority", type: "string", facet: true, optional: true },
    { name: "assignee_id", type: "string", facet: true, optional: true },
    { name: "project_id", type: "string", facet: true, optional: true },
    { name: "project_name", type: "string", optional: true },
    { name: "due_at", type: "int64", optional: true },
    { name: "mode", type: "string", facet: true, optional: true },
    { name: "scope_repo", type: "string", facet: true, optional: true },
    { name: "scope_program", type: "string", facet: true, optional: true },
    { name: "scope_context", type: "string", facet: true, optional: true },
    { name: "vault_name", type: "string", facet: true, optional: true },
    // Forge-specific fields (optional — Anvil/Vault documents are unaffected)
    { name: "local_path", type: "string", optional: true },
    { name: "remote_url", type: "string", optional: true },
    { name: "language", type: "string", facet: true, optional: true },
    { name: "clone_state", type: "string", facet: true, optional: true },
    { name: "default_branch", type: "string", optional: true },
    { name: "created_at", type: "int64" },
    { name: "modified_at", type: "int64", sort: true }
  ],
  default_sorting_field: "modified_at"
};
var MAX_RETRIES = 5;
var RETRY_INTERVAL_MS = 2e3;
async function bootstrapCollection(client, embeddingConfig) {
  const schema = structuredClone(BASE_SCHEMA);
  if (embeddingConfig) {
    schema.fields.push({
      name: "embedding",
      type: "float[]",
      embed: {
        from: ["title", "body"],
        model_config: {
          model_name: `${embeddingConfig.provider}/${embeddingConfig.model}`,
          api_key: embeddingConfig.apiKey
        }
      }
    });
  }
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const collections = await client.collections().retrieve();
      const exists = collections.some((c) => c.name === COLLECTION_NAME);
      if (exists) {
        return;
      }
      await client.collections().create(schema);
      return;
    } catch (err) {
      lastError = err;
      const isConnectionError = err instanceof Error && (err.message.includes("ECONNREFUSED") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT") || err.message.includes("connect") || err.message.includes("timeout"));
      if (!isConnectionError || attempt === MAX_RETRIES) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }
  throw lastError;
}
export {
  bootstrapCollection,
  createClient,
  loadEmbeddingConfig,
  loadSearchConfig
};
