/**
 * RepoSearchClient — Typesense integration for forge_registry_repos collection.
 *
 * Manages the `forge_registry_repos` collection and exposes:
 *   - ensureCollection()       — create collection if not exists
 *   - index(metadata)          — upsert a repo document
 *   - remove(org, name)        — delete a repo document
 *   - search(params)           — faceted search with optional filters
 *   - resolveByName(name)      — exact name lookup, ambiguous if multiple orgs
 *   - resolveByUrl(url)        — exact canonical_url lookup
 *   - rebuildFromStorage(repos) — drop + recreate + index all
 */

import Typesense from 'typesense';
import { normalizeGitUrl } from '@forge/core';
import type { RepoMetadata } from '../types/repo-metadata.js';

// ── Collection schema ─────────────────────────────────────────────────────────

const COLLECTION = 'forge_registry_repos';

const COLLECTION_SCHEMA = {
  name: COLLECTION,
  fields: [
    { name: 'id',             type: 'string' },
    { name: 'org',            type: 'string',   facet: true },
    { name: 'name',           type: 'string' },
    { name: 'canonical_url',  type: 'string' },
    { name: 'default_branch', type: 'string',   optional: true },
    { name: 'language',       type: 'string',   facet: true, optional: true },
    { name: 'framework',      type: 'string',   facet: true, optional: true },
    { name: 'topics',         type: 'string[]', facet: true, optional: true },
    { name: 'description',    type: 'string',   optional: true },
    { name: 'has_workflow',   type: 'bool',     facet: true },
    { name: 'has_credential', type: 'bool',     facet: true },
    { name: 'registered_at',  type: 'int64' },
  ],
  default_sorting_field: 'registered_at',
};

// ── Typesense client interfaces ───────────────────────────────────────────────

interface TypesenseDocumentsHandle {
  upsert: (doc: Record<string, unknown>) => Promise<unknown>;
  search: (params: Record<string, unknown>) => Promise<TypesenseSearchResponse>;
}

interface TypesenseDocumentHandle {
  delete: () => Promise<unknown>;
}

interface TypesenseCollectionHandle {
  documents: (() => TypesenseDocumentsHandle) & ((id: string) => TypesenseDocumentHandle);
  retrieve: () => Promise<{ num_documents: number }>;
  delete: () => Promise<unknown>;
}

interface TypesenseCollectionsListHandle {
  create: (schema: Record<string, unknown>) => Promise<unknown>;
  retrieve: () => Promise<Array<{ name: string }>>;
}

interface TypesenseCollectionsMethod {
  (): TypesenseCollectionsListHandle;
  (name: string): TypesenseCollectionHandle;
}

export interface TypesenseClient {
  collections: TypesenseCollectionsMethod;
}

interface TypesenseSearchResponse {
  found?: number;
  hits?: Array<{ document: Record<string, unknown> }>;
}

// ── Internal document shape ───────────────────────────────────────────────────

interface RepoDocument {
  id: string;
  org: string;
  name: string;
  canonical_url: string;
  default_branch?: string;
  language?: string;
  framework?: string;
  topics?: string[];
  description?: string;
  has_workflow: boolean;
  has_credential: boolean;
  registered_at: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDocument(metadata: RepoMetadata): RepoDocument {
  const doc: RepoDocument = {
    id: `${metadata.org}/${metadata.name}`,
    org: metadata.org,
    name: metadata.name,
    canonical_url: normalizeGitUrl(metadata.canonicalUrl),
    has_workflow: metadata.workflow !== undefined,
    has_credential: metadata.credential !== undefined,
    registered_at: Math.floor(new Date(metadata.registeredAt).getTime() / 1000),
  };

  if (metadata.defaultBranch !== undefined) doc.default_branch = metadata.defaultBranch;
  if (metadata.language !== undefined) doc.language = metadata.language;
  if (metadata.topics !== undefined) doc.topics = metadata.topics;
  if (metadata.description !== undefined) doc.description = metadata.description;

  // framework comes from workflow or extra — not in base schema, skip if absent
  return doc;
}

// ── RepoSearchClient ──────────────────────────────────────────────────────────

export class RepoSearchClient {
  private readonly ts: TypesenseClient;
  private collectionEnsured = false;

  constructor(ts: TypesenseClient) {
    this.ts = ts;
  }

  /**
   * Create a RepoSearchClient from a Typesense node config.
   */
  static create(config: {
    host: string;
    port?: number;
    protocol?: string;
    apiKey: string;
  }): RepoSearchClient | null {
    if (!config.host) return null;
    try {
      const client = new Typesense.Client({
        nodes: [
          {
            host: config.host,
            port: config.port ?? 8108,
            protocol: config.protocol ?? 'http',
          },
        ],
        apiKey: config.apiKey,
        connectionTimeoutSeconds: 2,
      }) as unknown as TypesenseClient;
      return new RepoSearchClient(client);
    } catch {
      return null;
    }
  }

  // ── Collection bootstrap ──────────────────────────────────────────────────

  /**
   * Ensure the forge_registry_repos collection exists.
   * Creates it if absent. Idempotent.
   */
  async ensureCollection(): Promise<void> {
    if (this.collectionEnsured) return;

    try {
      const existing = await this.ts.collections().retrieve();
      const found = existing.some((c) => c.name === COLLECTION);
      if (!found) {
        await this.ts.collections().create(COLLECTION_SCHEMA as unknown as Record<string, unknown>);
      }
      this.collectionEnsured = true;
    } catch {
      // Typesense unavailable — don't mark as ensured, retry next call
    }
  }

  // ── Indexing ────────────────────────────────────────────────────────────────

  /**
   * Upsert a repo document. id = "{org}/{name}".
   */
  async index(metadata: RepoMetadata): Promise<void> {
    await this.ensureCollection();
    const doc = toDocument(metadata);
    await this.ts.collections(COLLECTION).documents().upsert(doc as unknown as Record<string, unknown>);
  }

  /**
   * Delete a repo document by org + name.
   */
  async remove(org: string, name: string): Promise<void> {
    await this.ensureCollection();
    const docId = `${org}/${name}`;
    await this.ts.collections(COLLECTION).documents(docId).delete();
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  /**
   * Search repos with optional filters.
   */
  async search(params: {
    query?: string;
    org?: string;
    language?: string;
    framework?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; repos: RepoMetadata[] }> {
    try {
      await this.ensureCollection();

      const filterParts: string[] = [];
      if (params.org)      filterParts.push(`org:${params.org}`);
      if (params.language) filterParts.push(`language:${params.language}`);
      if (params.framework) filterParts.push(`framework:${params.framework}`);
      if (params.tag)      filterParts.push(`topics:${params.tag}`);

      const filterBy = filterParts.length > 0 ? filterParts.join(' && ') : undefined;
      const q = params.query?.trim() || '*';

      const searchParams: Record<string, unknown> = {
        q,
        query_by: 'name,description,topics',
        sort_by: 'registered_at:desc',
        per_page: params.limit ?? 20,
        page: params.offset !== undefined ? Math.floor(params.offset / (params.limit ?? 20)) + 1 : 1,
        ...(filterBy ? { filter_by: filterBy } : {}),
      };

      const result = await this.ts.collections(COLLECTION).documents().search(searchParams);
      const hits = (result.hits ?? []) as Array<{ document: Record<string, unknown> }>;

      // Map Typesense documents back to RepoMetadata shape
      const repos = hits.map((h) => {
        const d = h.document as unknown as RepoDocument;
        return {
          org: d.org,
          name: d.name,
          canonicalUrl: d.canonical_url,
          registeredAt: new Date(d.registered_at * 1000).toISOString(),
          updatedAt: new Date(d.registered_at * 1000).toISOString(),
          ...(d.default_branch !== undefined ? { defaultBranch: d.default_branch } : {}),
          ...(d.language !== undefined ? { language: d.language } : {}),
          ...(d.topics !== undefined ? { topics: d.topics } : {}),
          ...(d.description !== undefined ? { description: d.description } : {}),
        } as RepoMetadata;
      });

      return { total: result.found ?? repos.length, repos };
    } catch {
      return { total: 0, repos: [] };
    }
  }

  // ── Resolve ─────────────────────────────────────────────────────────────────

  /**
   * Exact match on name. If multiple orgs have the same name, returns ambiguous.
   */
  async resolveByName(name: string): Promise<{
    match: RepoMetadata | null;
    ambiguous: boolean;
    candidates?: RepoMetadata[];
  }> {
    try {
      await this.ensureCollection();

      const result = await this.ts.collections(COLLECTION).documents().search({
        q: name,
        query_by: 'name',
        filter_by: `name:=${name}`,
        per_page: 10,
      });

      const hits = (result.hits ?? []) as Array<{ document: Record<string, unknown> }>;

      if (hits.length === 0) {
        return { match: null, ambiguous: false };
      }

      if (hits.length === 1) {
        const d = hits[0]!.document as unknown as RepoDocument;
        const match: RepoMetadata = {
          org: d.org,
          name: d.name,
          canonicalUrl: d.canonical_url,
          registeredAt: new Date(d.registered_at * 1000).toISOString(),
          updatedAt: new Date(d.registered_at * 1000).toISOString(),
          ...(d.default_branch !== undefined ? { defaultBranch: d.default_branch } : {}),
          ...(d.language !== undefined ? { language: d.language } : {}),
          ...(d.topics !== undefined ? { topics: d.topics } : {}),
          ...(d.description !== undefined ? { description: d.description } : {}),
        };
        return { match, ambiguous: false };
      }

      // Multiple orgs have same repo name — ambiguous
      const candidates: RepoMetadata[] = hits.map((h) => {
        const d = h.document as unknown as RepoDocument;
        return {
          org: d.org,
          name: d.name,
          canonicalUrl: d.canonical_url,
          registeredAt: new Date(d.registered_at * 1000).toISOString(),
          updatedAt: new Date(d.registered_at * 1000).toISOString(),
          ...(d.default_branch !== undefined ? { defaultBranch: d.default_branch } : {}),
          ...(d.language !== undefined ? { language: d.language } : {}),
          ...(d.topics !== undefined ? { topics: d.topics } : {}),
          ...(d.description !== undefined ? { description: d.description } : {}),
        };
      });

      return { match: null, ambiguous: true, candidates };
    } catch {
      return { match: null, ambiguous: false };
    }
  }

  /**
   * Exact match on normalized canonical_url.
   * Normalizes the input URL before comparing so protocol/suffix differences
   * don't matter.
   */
  async resolveByUrl(url: string): Promise<RepoMetadata | null> {
    try {
      await this.ensureCollection();

      const normalized = normalizeGitUrl(url);

      const result = await this.ts.collections(COLLECTION).documents().search({
        q: '*',
        query_by: 'name',
        filter_by: `canonical_url:=${normalized}`,
        per_page: 1,
      });

      const hits = (result.hits ?? []) as Array<{ document: Record<string, unknown> }>;
      if (hits.length === 0) return null;

      const d = hits[0]!.document as unknown as RepoDocument;
      return {
        org: d.org,
        name: d.name,
        canonicalUrl: d.canonical_url,
        registeredAt: new Date(d.registered_at * 1000).toISOString(),
        updatedAt: new Date(d.registered_at * 1000).toISOString(),
        ...(d.default_branch !== undefined ? { defaultBranch: d.default_branch } : {}),
        ...(d.language !== undefined ? { language: d.language } : {}),
        ...(d.topics !== undefined ? { topics: d.topics } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
      };
    } catch {
      return null;
    }
  }

  // ── Cold rebuild ─────────────────────────────────────────────────────────────

  /**
   * Drop collection, recreate it, and index all provided repos.
   * Returns the count of repos indexed.
   */
  async rebuildFromStorage(repos: RepoMetadata[]): Promise<number> {
    // Drop existing collection if present
    try {
      const existing = await this.ts.collections().retrieve();
      const found = existing.some((c) => c.name === COLLECTION);
      if (found) {
        await this.ts.collections(COLLECTION).delete();
      }
    } catch {
      // Best-effort
    }

    // Reset ensured flag so ensureCollection recreates it
    this.collectionEnsured = false;
    await this.ensureCollection();

    let count = 0;
    for (const repo of repos) {
      try {
        await this.index(repo);
        count++;
      } catch {
        // Best-effort — skip individual failures
      }
    }

    return count;
  }
}
