/**
 * Tests for RepoSearchClient.
 *
 * Covers:
 *   1. ensureCollection creates collection with correct schema
 *   2. index + search roundtrip works
 *   3. resolveByName returns single match when one org has it
 *   4. resolveByName returns ambiguous when multiple orgs have same name
 *   5. resolveByUrl matches regardless of protocol/suffix
 *   6. rebuildFromStorage drops collection, recreates, indexes all
 *   7. remove() uses filter_by delete (not id-path delete) — bug b18ccd0e
 *   8. remove() is idempotent — does not throw when doc is absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepoSearchClient, type TypesenseClient } from '../src/search/repo-search.js';
import type { RepoMetadata } from '../src/types/repo-metadata.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMetadata(overrides: Partial<RepoMetadata> = {}): RepoMetadata {
  return {
    org: 'acme',
    name: 'my-service',
    canonicalUrl: 'github.com/acme/my-service',
    registeredAt: new Date(1700000000000).toISOString(),
    updatedAt: new Date(1700000000000).toISOString(),
    defaultBranch: 'main',
    language: 'TypeScript',
    topics: ['api', 'service'],
    description: 'A test service',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Typesense mock factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal Typesense mock that tracks calls and simulates basic
 * upsert/search/delete behaviour.
 *
 * The Typesense SDK exposes `client.collections` as an overloaded callable:
 *   - collections()       → Collections list handle (create, retrieve-all)
 *   - collections('name') → Collection handle (documents, retrieve, delete)
 *
 * `collectionExists` controls whether `collections().retrieve()` returns
 * the repo collection in its list.
 */
function makeTypesenseClient(opts: {
  collectionExists?: boolean;
  docs?: Array<Record<string, unknown>>;
  numDocuments?: number;
} = {}): TypesenseClient & {
  _createSpy: ReturnType<typeof vi.fn>;
  _upsertSpy: ReturnType<typeof vi.fn>;
  _deleteSpy: ReturnType<typeof vi.fn>;
  _filterDeleteSpy: ReturnType<typeof vi.fn>;
  _collectionDeleteSpy: ReturnType<typeof vi.fn>;
  _searchSpy: ReturnType<typeof vi.fn>;
} {
  const {
    collectionExists = false,
    docs = [],
    numDocuments = docs.length,
  } = opts;

  const createSpy = vi.fn().mockResolvedValue({});
  const upsertSpy = vi.fn().mockResolvedValue({});
  // deleteSpy: simulates the OLD by-id path — documents(id).delete()
  const deleteSpy = vi.fn().mockResolvedValue({});
  // filterDeleteSpy: simulates the NEW filter_by path — documents().delete({ filter_by })
  const filterDeleteSpy = vi.fn().mockResolvedValue({ num_deleted: 1 });
  const collectionDeleteSpy = vi.fn().mockResolvedValue({});

  const searchSpy = vi.fn().mockImplementation((params: Record<string, unknown>) => {
    let results = [...docs];

    // Apply filter_by for exact name or canonical_url
    const filterBy = params['filter_by'] as string | undefined;
    if (filterBy) {
      // name:=value
      const nameMatch = filterBy.match(/name:=([^\s&]+)/);
      if (nameMatch) {
        const filterName = nameMatch[1];
        results = results.filter((d) => d['name'] === filterName);
      }
      // canonical_url:=value
      const urlMatch = filterBy.match(/canonical_url:=([^\s&]+)/);
      if (urlMatch) {
        const filterUrl = urlMatch[1];
        results = results.filter((d) => d['canonical_url'] === filterUrl);
      }
    }

    return Promise.resolve({
      found: results.length,
      hits: results.map((doc) => ({ document: doc })),
    });
  });

  // The stable no-arg documents handle now also exposes delete({ filter_by })
  const stableDocuments = {
    upsert: upsertSpy,
    search: searchSpy,
    // filter_by delete — exposed on the no-arg documents() handle
    delete: filterDeleteSpy,
  };

  // Per-collection handle — returned when collections('name') is called
  const collectionHandle = {
    documents: Object.assign(
      () => stableDocuments,
      (_id: string) => ({ delete: deleteSpy }),
    ),
    retrieve: vi.fn().mockResolvedValue({ num_documents: numDocuments }),
    delete: collectionDeleteSpy,
  };

  // List handle — returned when collections() (no args) is called
  const collectionsListHandle = {
    create: createSpy,
    retrieve: vi
      .fn()
      .mockResolvedValue(
        collectionExists ? [{ name: 'forge_registry_repos' }] : [],
      ),
  };

  // The collections method returns different things based on whether a name is given
  const collectionsMethod = (name?: string) => {
    if (name === undefined || name === null) {
      return collectionsListHandle;
    }
    return collectionHandle;
  };

  // Attach list-handle properties directly to the function so TypesenseClient
  // interface is satisfied (TypesenseCollectionsMethod overload)
  Object.assign(collectionsMethod, collectionsListHandle);

  const client = {
    collections: collectionsMethod as unknown as TypesenseClient['collections'],
    _createSpy: createSpy,
    _upsertSpy: upsertSpy,
    _deleteSpy: deleteSpy,
    _filterDeleteSpy: filterDeleteSpy,
    _collectionDeleteSpy: collectionDeleteSpy,
    _searchSpy: searchSpy,
  };

  return client as unknown as typeof client;
}

function makeSearchClient(opts: Parameters<typeof makeTypesenseClient>[0] = {}) {
  const ts = makeTypesenseClient(opts);
  const client = new RepoSearchClient(ts as unknown as TypesenseClient);
  return { client, ts };
}

// ---------------------------------------------------------------------------
// Test 1: ensureCollection creates collection with correct schema
// ---------------------------------------------------------------------------

describe('RepoSearchClient.ensureCollection()', () => {
  it('creates collection with correct schema when it does not exist', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: false });

    await client.ensureCollection();

    expect(ts._createSpy).toHaveBeenCalledOnce();
    const [schema] = ts._createSpy.mock.calls[0] as [Record<string, unknown>];
    expect(schema['name']).toBe('forge_registry_repos');
    expect(schema['default_sorting_field']).toBe('registered_at');

    const fields = schema['fields'] as Array<Record<string, unknown>>;
    const fieldNames = fields.map((f) => f['name']);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('org');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('canonical_url');
    expect(fieldNames).toContain('language');
    expect(fieldNames).toContain('topics');
    expect(fieldNames).toContain('has_workflow');
    expect(fieldNames).toContain('has_credential');
    expect(fieldNames).toContain('registered_at');
  });

  it('does not create collection when it already exists', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: true });

    await client.ensureCollection();

    expect(ts._createSpy).not.toHaveBeenCalled();
  });

  it('is idempotent — does not call create twice on repeated calls', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: false });

    await client.ensureCollection();
    await client.ensureCollection();

    expect(ts._createSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test 2: index + search roundtrip
// ---------------------------------------------------------------------------

describe('RepoSearchClient index + search roundtrip', () => {
  it('calls upsert with correct document shape', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: true });
    const repo = makeRepoMetadata();

    await client.index(repo);

    expect(ts._upsertSpy).toHaveBeenCalledOnce();
    const [doc] = ts._upsertSpy.mock.calls[0] as [Record<string, unknown>];
    expect(doc['id']).toBe('acme/my-service');
    expect(doc['org']).toBe('acme');
    expect(doc['name']).toBe('my-service');
    expect(typeof doc['registered_at']).toBe('number');
  });

  it('search returns repos matching the query', async () => {
    const doc = {
      id: 'acme/my-service',
      org: 'acme',
      name: 'my-service',
      canonical_url: 'github.com/acme/my-service',
      language: 'TypeScript',
      topics: ['api'],
      description: 'A test service',
      has_workflow: false,
      has_credential: false,
      registered_at: 1700000000,
    };

    const { client } = makeSearchClient({ collectionExists: true, docs: [doc] });

    const result = await client.search({ query: 'my-service' });

    expect(result.total).toBe(1);
    expect(result.repos.length).toBe(1);
    expect(result.repos[0]?.org).toBe('acme');
    expect(result.repos[0]?.name).toBe('my-service');
  });

  it('search returns empty results on Typesense error', async () => {
    const ts = makeTypesenseClient({ collectionExists: true });
    ts._searchSpy.mockRejectedValue(new Error('connection refused'));
    const client = new RepoSearchClient(ts as unknown as TypesenseClient);

    const result = await client.search({ query: 'anything' });

    expect(result.total).toBe(0);
    expect(result.repos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 3: resolveByName — single match
// ---------------------------------------------------------------------------

describe('RepoSearchClient.resolveByName()', () => {
  it('returns single match when exactly one org has the name', async () => {
    const doc = {
      id: 'acme/api',
      org: 'acme',
      name: 'api',
      canonical_url: 'github.com/acme/api',
      has_workflow: false,
      has_credential: false,
      registered_at: 1700000000,
    };

    const { client } = makeSearchClient({ collectionExists: true, docs: [doc] });

    const result = await client.resolveByName('api');

    expect(result.ambiguous).toBe(false);
    expect(result.match).not.toBeNull();
    expect(result.match?.org).toBe('acme');
    expect(result.match?.name).toBe('api');
    expect(result.candidates).toBeUndefined();
  });

  it('returns null match when no repo has the name', async () => {
    const { client } = makeSearchClient({ collectionExists: true, docs: [] });

    const result = await client.resolveByName('nonexistent');

    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 4: resolveByName — ambiguous (multiple orgs)
// ---------------------------------------------------------------------------

describe('RepoSearchClient.resolveByName() — ambiguous', () => {
  it('returns ambiguous=true when multiple orgs have the same name', async () => {
    const doc1 = {
      id: 'acme/shared-lib',
      org: 'acme',
      name: 'shared-lib',
      canonical_url: 'github.com/acme/shared-lib',
      has_workflow: false,
      has_credential: false,
      registered_at: 1700000000,
    };
    const doc2 = {
      id: 'other-org/shared-lib',
      org: 'other-org',
      name: 'shared-lib',
      canonical_url: 'github.com/other-org/shared-lib',
      has_workflow: false,
      has_credential: false,
      registered_at: 1700000100,
    };

    const { client } = makeSearchClient({
      collectionExists: true,
      docs: [doc1, doc2],
    });

    const result = await client.resolveByName('shared-lib');

    expect(result.ambiguous).toBe(true);
    expect(result.match).toBeNull();
    expect(result.candidates).toBeDefined();
    expect(result.candidates?.length).toBe(2);
    const orgs = result.candidates?.map((c) => c.org);
    expect(orgs).toContain('acme');
    expect(orgs).toContain('other-org');
  });
});

// ---------------------------------------------------------------------------
// Test 5: resolveByUrl — matches regardless of protocol/suffix
// ---------------------------------------------------------------------------

describe('RepoSearchClient.resolveByUrl()', () => {
  it('resolves a repo by git@ URL', async () => {
    const doc = {
      id: 'acme/my-service',
      org: 'acme',
      name: 'my-service',
      canonical_url: 'github.com/acme/my-service',
      has_workflow: false,
      has_credential: false,
      registered_at: 1700000000,
    };

    const { client } = makeSearchClient({ collectionExists: true, docs: [doc] });

    const result = await client.resolveByUrl('git@github.com:acme/my-service.git');

    expect(result).not.toBeNull();
    expect(result?.org).toBe('acme');
    expect(result?.name).toBe('my-service');
  });

  it('resolves a repo by https URL with .git suffix', async () => {
    const doc = {
      id: 'acme/my-service',
      org: 'acme',
      name: 'my-service',
      canonical_url: 'github.com/acme/my-service',
      has_workflow: false,
      has_credential: false,
      registered_at: 1700000000,
    };

    const { client } = makeSearchClient({ collectionExists: true, docs: [doc] });

    const result = await client.resolveByUrl('https://github.com/acme/my-service.git');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('my-service');
  });

  it('returns null when no repo matches the URL', async () => {
    const { client } = makeSearchClient({ collectionExists: true, docs: [] });

    const result = await client.resolveByUrl('https://github.com/nobody/unknown.git');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 6: rebuildFromStorage — drop + recreate + index all
// ---------------------------------------------------------------------------

describe('RepoSearchClient.rebuildFromStorage()', () => {
  it('drops existing collection, recreates it, and indexes all repos', async () => {
    // Build a stateful mock: collection exists initially, is deleted, then
    // must be recreated by ensureCollection.
    let collectionExists = true;

    const createSpy = vi.fn().mockImplementation(() => {
      collectionExists = true;
      return Promise.resolve({});
    });
    const upsertSpy = vi.fn().mockResolvedValue({});
    const collectionDeleteSpy = vi.fn().mockImplementation(() => {
      collectionExists = false;
      return Promise.resolve({});
    });

    const stableDocuments = { upsert: upsertSpy, search: vi.fn().mockResolvedValue({ found: 0, hits: [] }) };
    const collectionHandle = {
      documents: () => stableDocuments,
      retrieve: vi.fn().mockResolvedValue({ num_documents: 1 }),
      delete: collectionDeleteSpy,
    };
    const collectionsListHandle = {
      create: createSpy,
      retrieve: vi.fn().mockImplementation(() =>
        Promise.resolve(collectionExists ? [{ name: 'forge_registry_repos' }] : []),
      ),
    };
    const collectionsMethod = (name?: string) =>
      name == null ? collectionsListHandle : collectionHandle;
    Object.assign(collectionsMethod, collectionsListHandle);

    const ts = {
      collections: collectionsMethod as unknown as TypesenseClient['collections'],
      _createSpy: createSpy,
      _upsertSpy: upsertSpy,
      _collectionDeleteSpy: collectionDeleteSpy,
    };

    const client = new RepoSearchClient(ts as unknown as TypesenseClient);

    const repos: RepoMetadata[] = [
      makeRepoMetadata({ org: 'acme', name: 'svc-a' }),
      makeRepoMetadata({ org: 'acme', name: 'svc-b' }),
      makeRepoMetadata({ org: 'other', name: 'svc-c' }),
    ];

    const count = await client.rebuildFromStorage(repos);

    expect(count).toBe(3);
    expect(ts._collectionDeleteSpy).toHaveBeenCalledOnce();
    expect(ts._createSpy).toHaveBeenCalledOnce();
    expect(ts._upsertSpy).toHaveBeenCalledTimes(3);
  });

  it('returns 0 when given an empty list', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: false });

    const count = await client.rebuildFromStorage([]);

    expect(count).toBe(0);
    expect(ts._createSpy).toHaveBeenCalledOnce();
    expect(ts._upsertSpy).not.toHaveBeenCalled();
  });

  it('does not call collection delete when collection does not exist', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: false });

    await client.rebuildFromStorage([makeRepoMetadata()]);

    expect(ts._collectionDeleteSpy).not.toHaveBeenCalled();
    expect(ts._createSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test 7 (regression b18ccd0e): remove() uses filter_by delete, not id-path
// ---------------------------------------------------------------------------

describe('RepoSearchClient.remove() — bug b18ccd0e regression', () => {
  it('issues a filter_by delete (not a by-id-path delete) for repos with slash in id', async () => {
    const { client, ts } = makeSearchClient({ collectionExists: true });

    await client.remove('smoke-test', 'gateway-probe');

    // The NEW implementation must call documents().delete({ filter_by: ... })
    expect(ts._filterDeleteSpy).toHaveBeenCalledOnce();
    const [params] = ts._filterDeleteSpy.mock.calls[0] as [{ filter_by: string }];
    expect(params.filter_by).toBe('org:=smoke-test && name:=gateway-probe');

    // The OLD by-id-path delete must NOT have been used
    expect(ts._deleteSpy).not.toHaveBeenCalled();
  });

  it('does not throw when the doc is absent (idempotent remove)', async () => {
    const ts = makeTypesenseClient({ collectionExists: true });
    // Simulate Typesense returning 0 deleted docs — this is not an error
    ts._filterDeleteSpy.mockResolvedValue({ num_deleted: 0 });
    const client = new RepoSearchClient(ts as unknown as TypesenseClient);

    // Must not throw even if nothing was deleted
    await expect(client.remove('no-such-org', 'no-such-repo')).resolves.toBeUndefined();
  });

  it('does not throw when Typesense returns a transient error on remove', async () => {
    const ts = makeTypesenseClient({ collectionExists: true });
    ts._filterDeleteSpy.mockRejectedValue(new Error('Typesense unavailable'));
    const client = new RepoSearchClient(ts as unknown as TypesenseClient);

    // Must not throw — best-effort, DELETE route must stay 204
    await expect(client.remove('acme', 'my-service')).resolves.toBeUndefined();
  });
});
