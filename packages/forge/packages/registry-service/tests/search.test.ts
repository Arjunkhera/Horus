/**
 * Tests for search functionality.
 *
 * Covers:
 *   - RegistrySearchClient.search() — returns results with verified flag
 *   - Type filter works
 *   - Empty query returns by publishedAt descending
 *   - Indexing is called after publish
 *   - Cold rebuild iterates storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { RegistrySearchClient, type ArtifactDocument } from '../src/search/registry-search.js';
import { PublishPipeline } from '../src/pipeline/publish-pipeline.js';
import type { StorageBackend, BundleFiles, StoredBundle, ArtifactIndexMeta } from '../src/storage/types.js';
import type { AuditLog } from '../src/audit/audit-log.js';
import type { AuthStrategy } from '../src/auth/types.js';
import type { ServiceUser } from '../src/types.js';

// ---------------------------------------------------------------------------
// Typesense mock factories
// ---------------------------------------------------------------------------

function makeTypesenseCollection(docs: ArtifactDocument[] = []) {
  // Stable documents object — so all calls to documents() return the same spies
  const documentsObj = {
    upsert: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockImplementation(
      (params: { q: string; filter_by?: string; sort_by?: string }) => {
        let results = [...docs];

        // Apply type filter
        if (params.filter_by?.includes('type:')) {
          const match = params.filter_by.match(/type:(\S+)/);
          if (match) {
            const filterType = match[1];
            results = results.filter((d) => d.type === filterType);
          }
        }

        // Sort: if empty query (q='*'), sort by publishedAt desc
        if (params.q === '*' || params.sort_by?.includes('publishedAt:desc')) {
          results.sort((a, b) => b.publishedAt - a.publishedAt);
        }

        // Sort: verified-first for relevance queries
        if (params.sort_by?.includes('verified:desc')) {
          results.sort((a, b) => Number(b.verified) - Number(a.verified));
        }

        return Promise.resolve({
          hits: results.map((doc) => ({ document: doc })),
        });
      },
    ),
  };

  return {
    documents: () => documentsObj,
    retrieve: vi.fn().mockResolvedValue({ num_documents: docs.length }),
    delete: vi.fn().mockResolvedValue({}),
  };
}

/**
 * Mirror the real Typesense client surface. The SDK overloads `collections`:
 *   - `collections()`      → list handle: `retrieve()` lists all collections,
 *                            `create(schema)` creates one.
 *   - `collections(name)`  → per-collection handle: `documents()`, `retrieve()`
 *                            (→ `{ num_documents }`), `delete()`.
 */
function makeCollectionsList(existing: Array<{ name: string }>) {
  return {
    retrieve: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockResolvedValue({}),
  };
}

function overloadedCollections(
  perCollection: unknown,
  list: ReturnType<typeof makeCollectionsList>,
) {
  return (name?: string) => (name === undefined ? list : perCollection);
}

function makeTypesenseClient(
  docs: ArtifactDocument[] = [],
  existing: Array<{ name: string }> = [{ name: 'forge_registry_artifacts' }],
) {
  const col = makeTypesenseCollection(docs);
  const list = makeCollectionsList(existing);
  return { collections: overloadedCollections(col, list), _col: col, _list: list };
}

/**
 * Build a RegistrySearchClient that bypasses the require() call and uses a
 * pre-built mock TypesenseClient.
 */
function makeSearchClient(docs: ArtifactDocument[] = []): RegistrySearchClient {
  const ts = makeTypesenseClient(docs);
  // Access private constructor via casting
  return new (RegistrySearchClient as unknown as {
    new (ts: unknown): RegistrySearchClient;
  })(ts);
}

// ---------------------------------------------------------------------------
// Stub implementations for pipeline tests
// ---------------------------------------------------------------------------

const ADMIN_USER: ServiceUser = { userId: 'admin-1', name: 'Admin', role: 'admin' };

function makeSkillMetaYaml(overrides: Record<string, unknown> = {}): string {
  return yamlStringify({
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A skill for testing',
    type: 'skill',
    tags: ['test', 'search'],
    dependencies: {},
    files: [],
    ...overrides,
  });
}

function makeFiles(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set('metadata.yaml', Buffer.from(makeSkillMetaYaml()));
  files.set('SKILL.md', Buffer.from('# Test Skill'));
  return files;
}

function makeStorage(opts: { exists?: boolean } = {}): StorageBackend {
  return {
    ping: vi.fn().mockResolvedValue(true),
    exists: vi.fn().mockResolvedValue(opts.exists ?? false),
    getMeta: vi.fn().mockResolvedValue(null),
    writeBundle: vi.fn().mockResolvedValue(undefined),
    readBundle: vi.fn().mockResolvedValue(new Map() as StoredBundle),
    listVersions: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([]),
  };
}

function makeAuditLog(): AuditLog {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    recent: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as unknown as AuditLog;
}

function makeAuth(): AuthStrategy {
  return {
    identify: vi.fn().mockResolvedValue(ADMIN_USER),
    authorize: vi.fn().mockReturnValue('permit'),
  };
}

// ---------------------------------------------------------------------------
// Sample documents
// ---------------------------------------------------------------------------

const DOC_VERIFIED: ArtifactDocument = {
  id: 'skill:verified-skill:1.0.0',
  type: 'skill',
  artifact_id: 'verified-skill',
  version: '1.0.0',
  name: 'Verified Skill',
  description: 'An official verified skill',
  tags: ['official'],
  verified: true,
  publishedAt: 1700000200,
};

const DOC_UNVERIFIED: ArtifactDocument = {
  id: 'skill:community-skill:1.0.0',
  type: 'skill',
  artifact_id: 'community-skill',
  version: '1.0.0',
  name: 'Community Skill',
  description: 'A community contributed skill',
  tags: ['community'],
  verified: false,
  publishedAt: 1700000100,
};

const DOC_AGENT: ArtifactDocument = {
  id: 'agent:my-agent:2.0.0',
  type: 'agent',
  artifact_id: 'my-agent',
  version: '2.0.0',
  name: 'My Agent',
  description: 'A useful agent',
  tags: [],
  verified: false,
  publishedAt: 1700000300,
};

// ---------------------------------------------------------------------------
// Tests: RegistrySearchClient
// ---------------------------------------------------------------------------

describe('RegistrySearchClient', () => {
  describe('search()', () => {
    it('returns results with verified flag present', async () => {
      const client = makeSearchClient([DOC_VERIFIED, DOC_UNVERIFIED]);
      const results = await client.search('skill');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(typeof r.verified).toBe('boolean');
      }
    });

    it('returns both verified=true and verified=false artifacts', async () => {
      const client = makeSearchClient([DOC_VERIFIED, DOC_UNVERIFIED]);
      const results = await client.search('skill');
      const verifiedFlags = results.map((r) => r.verified);
      expect(verifiedFlags).toContain(true);
      expect(verifiedFlags).toContain(false);
    });

    it('ranks verified=true artifacts before verified=false for equal relevance', async () => {
      const client = makeSearchClient([DOC_UNVERIFIED, DOC_VERIFIED]); // unverified first in storage
      const results = await client.search('skill');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Verified should come first
      const firstVerified = results.findIndex((r) => r.verified === true);
      const firstUnverified = results.findIndex((r) => r.verified === false);
      expect(firstVerified).toBeLessThan(firstUnverified);
    });

    it('filters by type when type param is provided', async () => {
      const client = makeSearchClient([DOC_VERIFIED, DOC_UNVERIFIED, DOC_AGENT]);
      const results = await client.search('', 'agent');
      expect(results.length).toBe(1);
      expect(results[0]?.type).toBe('agent');
    });

    it('returns all types when type param is absent', async () => {
      const client = makeSearchClient([DOC_VERIFIED, DOC_UNVERIFIED, DOC_AGENT]);
      const results = await client.search('');
      expect(results.length).toBe(3);
    });

    it('empty query returns results sorted by publishedAt descending', async () => {
      const client = makeSearchClient([DOC_VERIFIED, DOC_UNVERIFIED, DOC_AGENT]);
      const results = await client.search('');
      // DOC_AGENT has publishedAt=1700000300, DOC_VERIFIED=1700000200, DOC_UNVERIFIED=1700000100
      const timestamps = results.map((r) => r.publishedAt);
      for (let i = 0; i < timestamps.length - 1; i++) {
        expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i + 1]!);
      }
    });

    it('returns empty array when Typesense throws', async () => {
      const client = makeSearchClient([]);
      // Patch the internal ts to throw
      const errorTs = {
        collections: overloadedCollections(
          {
            documents: () => ({
              search: vi.fn().mockRejectedValue(new Error('connection refused')),
              upsert: vi.fn(),
            }),
            retrieve: vi.fn().mockResolvedValue({ num_documents: 1 }),
            delete: vi.fn(),
          },
          makeCollectionsList([{ name: 'forge_registry_artifacts' }]),
        ),
      };
      const errorClient = new (RegistrySearchClient as unknown as {
        new (ts: unknown): RegistrySearchClient;
      })(errorTs);

      const results = await errorClient.search('anything');
      expect(results).toEqual([]);
    });
  });

  describe('indexArtifact()', () => {
    it('calls Typesense upsert with correct document shape', async () => {
      const ts = makeTypesenseClient();
      const client = new (RegistrySearchClient as unknown as {
        new (ts: unknown): RegistrySearchClient;
      })(ts);

      const doc: ArtifactDocument = DOC_VERIFIED;
      await client.indexArtifact(doc);

      const col = ts.collections('forge_registry_artifacts');
      expect(col.documents().upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'skill:verified-skill:1.0.0',
          type: 'skill',
          verified: true,
        }),
      );
    });

    it('does not throw when Typesense is unavailable', async () => {
      const errorTs = {
        collections: overloadedCollections(
          {
            documents: () => ({
              upsert: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
              search: vi.fn(),
            }),
            retrieve: vi.fn().mockResolvedValue({ num_documents: 1 }),
            delete: vi.fn(),
          },
          makeCollectionsList([{ name: 'forge_registry_artifacts' }]),
        ),
      };

      const client = new (RegistrySearchClient as unknown as {
        new (ts: unknown): RegistrySearchClient;
      })(errorTs);

      const warnSpy = vi.fn();
      await expect(
        client.indexArtifact(DOC_VERIFIED, { warn: warnSpy }),
      ).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe('rebuild()', () => {
    it('skips rebuild when collection already has documents', async () => {
      const ts = makeTypesenseClient([DOC_VERIFIED]);
      const client = new (RegistrySearchClient as unknown as {
        new (ts: unknown): RegistrySearchClient;
      })(ts);

      const storage = makeStorage();
      const infoSpy = vi.fn();
      await client.rebuild(storage, { info: infoSpy, warn: vi.fn() });

      expect(storage.listAll).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('already populated'),
      );
    });

    it('iterates storage.listAll() and indexes each artifact', async () => {
      const storageArtifacts: ArtifactIndexMeta[] = [
        {
          type: 'skill',
          id: 'skill-a',
          version: '1.0.0',
          name: 'Skill A',
          description: 'First skill',
          tags: ['a'],
          verified: true,
          publishedAt: 1700000100000,
        },
        {
          type: 'plugin',
          id: 'plugin-b',
          version: '2.0.0',
          name: 'Plugin B',
          description: 'A plugin',
          tags: [],
          verified: false,
          publishedAt: 1700000200000,
        },
      ];

      // Build a client backed by empty collection — use stable document spy
      const upsertSpy = vi.fn().mockResolvedValue({});
      const stableDocuments = { upsert: upsertSpy, search: vi.fn() };
      const ts = {
        collections: overloadedCollections(
          {
            documents: () => stableDocuments,
            retrieve: vi.fn().mockResolvedValue({ num_documents: 0 }),
            delete: vi.fn(),
          },
          makeCollectionsList([{ name: 'forge_registry_artifacts' }]),
        ),
      };

      const client = new (RegistrySearchClient as unknown as {
        new (ts: unknown): RegistrySearchClient;
      })(ts);

      const storage = makeStorage();
      vi.mocked(storage.listAll).mockResolvedValue(storageArtifacts);

      const infoSpy = vi.fn();
      await client.rebuild(storage, { info: infoSpy, warn: vi.fn() });

      expect(storage.listAll).toHaveBeenCalledOnce();
      expect(upsertSpy).toHaveBeenCalledTimes(2);
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('indexed 2 artifacts'));
    });

    it('creates the collection when it does not exist', async () => {
      const list = makeCollectionsList([]); // no collections yet
      const ts = {
        collections: overloadedCollections(
          {
            documents: () => ({
              upsert: vi.fn().mockResolvedValue({}),
              search: vi.fn(),
            }),
            retrieve: vi.fn().mockResolvedValue({ num_documents: 0 }),
            delete: vi.fn(),
          },
          list,
        ),
      };

      const client = new (RegistrySearchClient as unknown as {
        new (ts: unknown): RegistrySearchClient;
      })(ts);

      const storage = makeStorage();
      vi.mocked(storage.listAll).mockResolvedValue([]);

      await client.rebuild(storage, { info: vi.fn(), warn: vi.fn() });

      expect(list.create).toHaveBeenCalledOnce();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Search indexing hook in PublishPipeline
// ---------------------------------------------------------------------------

describe('PublishPipeline — search indexing', () => {
  let storage: StorageBackend;
  let auditLog: AuditLog;
  let auth: AuthStrategy;

  beforeEach(() => {
    storage = makeStorage();
    auditLog = makeAuditLog();
    auth = makeAuth();
  });

  it('calls indexArtifact after successful publish', async () => {
    const searchClient = makeSearchClient();
    const indexSpy = vi
      .spyOn(searchClient, 'indexArtifact')
      .mockResolvedValue(undefined);

    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0', searchClient);

    await pipeline.run({
      type: 'skill',
      id: 'test-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    // Allow the fire-and-forget indexing to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(indexSpy).toHaveBeenCalledOnce();
    const [doc] = indexSpy.mock.calls[0] as [ArtifactDocument];
    expect(doc.id).toBe('skill:test-skill:1.0.0');
    expect(doc.type).toBe('skill');
    expect(doc.artifact_id).toBe('test-skill');
    expect(doc.version).toBe('1.0.0');
    expect(doc.name).toBe('Test Skill');
    expect(doc.description).toBe('A skill for testing');
    expect(doc.tags).toEqual(['test', 'search']);
  });

  it('does not call indexArtifact when search is not configured', async () => {
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    await expect(
      pipeline.run({
        type: 'skill',
        id: 'test-skill',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).resolves.toBeDefined();
    // No search client, so no indexing — just ensure pipeline succeeds
  });

  it('publish succeeds even when search indexing throws', async () => {
    const searchClient = makeSearchClient();
    vi.spyOn(searchClient, 'indexArtifact').mockRejectedValue(
      new Error('Typesense unavailable'),
    );

    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0', searchClient);

    const result = await pipeline.run({
      type: 'skill',
      id: 'test-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    expect(result.id).toBe('test-skill');
    expect(result.version).toBe('1.0.0');
  });
});
