/**
 * RegistrySearchClient — Typesense integration for the Forge Registry Service.
 *
 * Manages the `forge_registry_artifacts` collection and exposes:
 *   - indexArtifact(doc)  — upsert a single artifact document (best-effort)
 *   - search(q, type?)    — search with verified-first ranking
 *   - rebuild(storage)    — cold-rebuild the index from storage
 *
 * All public methods degrade gracefully when Typesense is unavailable:
 * they log a warning and return null / empty results rather than throwing.
 */

import type { ArtifactType } from '@forge/core';
import type { StorageBackend } from '../storage/types.js';
import type { RegistryConfig } from '../config.js';

// ── Typesense document shape ─────────────────────────────────────────────────

export interface ArtifactDocument {
  /** Composite: "{type}:{artifactId}:{version}" */
  id: string;
  type: string;
  artifact_id: string;
  version: string;
  name: string;
  description: string;
  tags: string[];
  verified: boolean;
  /** Unix epoch seconds */
  publishedAt: number;
}

export interface SearchResult {
  id: string;
  type: string;
  artifact_id: string;
  version: string;
  name: string;
  description: string;
  tags: string[];
  verified: boolean;
  publishedAt: number;
}

// ── Collection schema ─────────────────────────────────────────────────────────

const COLLECTION = 'forge_registry_artifacts';

const COLLECTION_SCHEMA = {
  name: COLLECTION,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'type', type: 'string', facet: true },
    { name: 'artifact_id', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'tags', type: 'string[]', facet: true },
    { name: 'verified', type: 'bool', facet: true },
    { name: 'publishedAt', type: 'int64', sort: true },
  ],
  default_sorting_field: 'publishedAt',
};

// ── Minimal Typesense client types ────────────────────────────────────────────

interface TypesenseClientConfig {
  nodes: Array<{ host: string; port: number; protocol: string }>;
  apiKey: string;
  connectionTimeoutSeconds?: number;
}

interface TypesenseDocumentsHandle {
  upsert: (doc: Record<string, unknown>) => Promise<unknown>;
  search: (params: Record<string, unknown>) => Promise<TypesenseSearchResponse>;
}

interface TypesenseDocumentHandle {
  update: (patch: Record<string, unknown>) => Promise<unknown>;
}

interface TypesenseCollectionHandle {
  documents: () => TypesenseDocumentsHandle;
  document: (id: string) => TypesenseDocumentHandle;
  retrieve: () => Promise<{ num_documents: number }>;
  delete: () => Promise<unknown>;
}

interface TypesenseCollectionsHandle {
  (name: string): TypesenseCollectionHandle;
  create: (schema: Record<string, unknown>) => Promise<unknown>;
  retrieveAll: () => Promise<Array<{ name: string }>>;
}

interface TypesenseClient {
  collections: TypesenseCollectionsHandle;
}

interface TypesenseSearchResponse {
  hits?: Array<{ document: Record<string, unknown> }>;
}

// ── RegistrySearchClient ──────────────────────────────────────────────────────

export class RegistrySearchClient {
  private readonly ts: TypesenseClient;
  private collectionEnsured = false;

  private constructor(ts: TypesenseClient) {
    this.ts = ts;
  }

  /**
   * Create a RegistrySearchClient from config.
   * Returns null when Typesense is not configured (host not set).
   */
  static create(config: RegistryConfig): RegistrySearchClient | null {
    const tsConfig = config.typesense;
    if (!tsConfig?.host) return null;

    try {
      // Dynamically import typesense to avoid hard dep at module load time
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Typesense = require('typesense') as { Client: new (cfg: TypesenseClientConfig) => TypesenseClient };
      const client = new Typesense.Client({
        nodes: [
          {
            host: tsConfig.host,
            port: tsConfig.port ?? 8108,
            protocol: tsConfig.protocol ?? 'http',
          },
        ],
        apiKey: tsConfig.apiKey,
        connectionTimeoutSeconds: 2,
      });
      return new RegistrySearchClient(client);
    } catch {
      return null;
    }
  }

  // ── Collection bootstrap ──────────────────────────────────────────────────

  /**
   * Ensure the collection exists, creating it if absent.
   * Called lazily before any operation.
   */
  private async ensureCollection(): Promise<void> {
    if (this.collectionEnsured) return;

    try {
      const existing = await this.ts.collections.retrieveAll();
      const found = existing.some((c) => c.name === COLLECTION);
      if (!found) {
        await this.ts.collections.create(COLLECTION_SCHEMA as unknown as Record<string, unknown>);
      }
      this.collectionEnsured = true;
    } catch {
      // Typesense unavailable — don't mark as ensured so we retry next time
    }
  }

  // ── Indexing ────────────────────────────────────────────────────────────────

  /**
   * Upsert an artifact document into the registry collection.
   * Best-effort: if Typesense is unavailable, logs a warning and returns.
   */
  async indexArtifact(doc: ArtifactDocument, logger?: { warn: (obj: unknown, msg: string) => void }): Promise<void> {
    try {
      await this.ensureCollection();
      await this.ts.collections(COLLECTION).documents().upsert(doc as unknown as Record<string, unknown>);
    } catch (err) {
      if (logger) {
        logger.warn({ err, artifactId: doc.artifact_id }, 'Search indexing failed (non-fatal)');
      }
    }
  }

  // ── Partial update ──────────────────────────────────────────────────────────

  /**
   * Patch the `verified` field on an existing Typesense document.
   * Uses the document-level PATCH API so other fields are preserved.
   * Best-effort: if Typesense is unavailable or the document doesn't exist yet,
   * logs a warning and returns.
   */
  async setDocumentVerified(
    type: string,
    artifactId: string,
    version: string,
    verified: boolean,
    logger?: { warn: (obj: unknown, msg: string) => void },
  ): Promise<void> {
    try {
      await this.ensureCollection();
      const docId = `${type}:${artifactId}:${version}`;
      await this.ts.collections(COLLECTION).document(docId).update({ verified });
    } catch (err) {
      if (logger) {
        logger.warn({ err, type, artifactId, version }, 'Search verified-field patch failed (non-fatal)');
      }
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  /**
   * Search artifacts in the registry.
   *
   * - Non-empty q: relevance search with verified=true ranked above verified=false
   * - Empty q: returns most recently published (descending publishedAt)
   * - type: optional filter; absence returns all types
   *
   * Returns an empty array on error (graceful degradation).
   */
  async search(
    q: string,
    type?: ArtifactType,
    perPage = 20,
  ): Promise<SearchResult[]> {
    try {
      await this.ensureCollection();

      const filterParts: string[] = [];
      if (type) {
        filterParts.push(`type:${type}`);
      }
      const filterBy = filterParts.length > 0 ? filterParts.join(' && ') : undefined;

      let searchParams: Record<string, unknown>;

      if (!q || q.trim() === '') {
        // Empty query: sort by publishedAt descending
        searchParams = {
          q: '*',
          query_by: 'name',
          sort_by: 'publishedAt:desc',
          per_page: perPage,
          ...(filterBy ? { filter_by: filterBy } : {}),
        };
      } else {
        // Relevance search: pin verified docs first for equal-relevance results
        // Typesense `pinned_hits` is not suitable here; instead we use
        // `sort_by` with a tie-breaker on `verified` (true=1 > false=0).
        searchParams = {
          q: q.trim(),
          query_by: 'name,description,tags',
          sort_by: 'verified:desc,_text_match:desc,publishedAt:desc',
          per_page: perPage,
          num_typos: 2,
          typo_tokens_threshold: 1,
          ...(filterBy ? { filter_by: filterBy } : {}),
        };
      }

      const result = await this.ts.collections(COLLECTION).documents().search(searchParams);

      const hits = (result.hits ?? []) as Array<{ document: Record<string, unknown> }>;
      return hits.map((h) => h.document as unknown as SearchResult);
    } catch {
      return [];
    }
  }

  // ── Cold rebuild ────────────────────────────────────────────────────────────

  /**
   * Rebuild the entire Typesense collection from storage.
   *
   * Called on startup when the collection is missing or empty.
   * Iterates all artifacts via StorageBackend.listAll() and indexes each.
   *
   * Best-effort: errors are logged but do not abort startup.
   */
  async rebuild(
    storage: StorageBackend,
    logger?: { info: (msg: string) => void; warn: (obj: unknown, msg: string) => void },
  ): Promise<void> {
    try {
      await this.ensureCollection();

      // Check whether rebuild is needed
      let docCount = 0;
      try {
        const col = await this.ts.collections(COLLECTION).retrieve();
        docCount = col.num_documents;
      } catch {
        // Collection doesn't exist yet — proceed with rebuild
      }

      if (docCount > 0) {
        logger?.info('Search index already populated, skipping cold rebuild');
        return;
      }

      logger?.info('Search index is empty, starting cold rebuild from storage');

      // Get all artifact metadata from storage
      const allMeta = await storage.listAll();
      let indexed = 0;

      for (const meta of allMeta) {
        // Per-version override: if this version has been explicitly unverified,
        // that takes precedence over the artifact-id-level verified flag.
        let verified = meta.verified ?? false;
        try {
          const isUnverified = await storage.isVersionUnverified(meta.type, meta.id, meta.version);
          if (isUnverified) verified = false;
        } catch {
          // Best-effort — missing override means no revocation
        }

        const doc: ArtifactDocument = {
          id: `${meta.type}:${meta.id}:${meta.version}`,
          type: meta.type,
          artifact_id: meta.id,
          version: meta.version,
          name: meta.name ?? meta.id,
          description: meta.description ?? '',
          tags: meta.tags ?? [],
          verified,
          publishedAt: Math.floor(meta.publishedAt / 1000),
        };

        await this.indexArtifact(doc, logger);
        indexed++;
      }

      logger?.info(`Cold rebuild complete: indexed ${indexed} artifacts`);
    } catch (err) {
      logger?.warn({ err }, 'Cold rebuild failed (non-fatal)');
    }
  }
}
