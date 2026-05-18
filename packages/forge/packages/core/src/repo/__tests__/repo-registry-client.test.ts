import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepoRegistryClient } from '../repo-registry-client.js';
import { RepoNotFoundError, RepoExistsError, RepoAmbiguousError } from '../repo-errors.js';
import type { RepoMetadataRecord } from '../repo-registry-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(org = 'acme', name = 'api'): RepoMetadataRecord {
  return {
    org,
    name,
    canonicalUrl: `git@github.com:${org}/${name}.git`,
    registeredAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function makClient(fetchFn: typeof fetch) {
  return new RepoRegistryClient({
    baseUrl: 'http://localhost:3000',
    token: 'test-token',
    fetch: fetchFn,
  });
}

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------

describe('register()', () => {
  it('returns metadata on 201', async () => {
    const meta = makeMeta();
    const client = makClient(mockFetch(201, meta));
    const result = await client.register({ org: 'acme', name: 'api', canonicalUrl: meta.canonicalUrl });
    expect(result.org).toBe('acme');
    expect(result.name).toBe('api');
  });

  it('throws RepoExistsError on 409', async () => {
    const client = makClient(mockFetch(409, { error: 'REPO_EXISTS' }));
    await expect(client.register({ org: 'acme', name: 'api', canonicalUrl: 'git@github.com:acme/api.git' }))
      .rejects.toBeInstanceOf(RepoExistsError);
  });

  it('throws on other 4xx', async () => {
    const client = makClient(mockFetch(400, { error: 'VALIDATION_ERROR' }));
    await expect(client.register({ org: 'acme', name: 'api', canonicalUrl: 'git@github.com:acme/api.git' }))
      .rejects.toThrow('Failed to register repo');
  });

  it('includes Authorization header when token set', async () => {
    const fetchFn = mockFetch(201, makeMeta());
    const client = makClient(fetchFn);
    await client.register({ org: 'acme', name: 'api', canonicalUrl: 'git@github.com:acme/api.git' });
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((call[1].headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
  });
});

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

describe('get()', () => {
  it('returns metadata on 200', async () => {
    const client = makClient(mockFetch(200, makeMeta()));
    const result = await client.get('acme', 'api');
    expect(result.name).toBe('api');
  });

  it('throws RepoNotFoundError on 404', async () => {
    const client = makClient(mockFetch(404, { error: 'REPO_NOT_FOUND' }));
    await expect(client.get('acme', 'missing'))
      .rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it('URL-encodes org and name', async () => {
    const fetchFn = mockFetch(200, makeMeta('my org', 'my/repo'));
    const client = makClient(fetchFn);
    try { await client.get('my org', 'my/repo'); } catch { /* ignore */ }
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('my%20org');
    expect(call[0]).toContain('my%2Frepo');
  });

  it('falls back to cache on network failure', async () => {
    const meta = makeMeta();
    const tmpCache = `/tmp/test-cache-${Date.now()}.json`;
    const { promises: fs } = await import('node:fs');
    await fs.writeFile(tmpCache, JSON.stringify({ repos: { 'acme/api': meta } }), 'utf8');

    const errFetch = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const client = new RepoRegistryClient({
      baseUrl: 'http://localhost:3000',
      cachePath: tmpCache,
      fetch: errFetch,
    });
    const result = await client.get('acme', 'api');
    expect(result.org).toBe('acme');

    await fs.unlink(tmpCache).catch(() => {});
  });

  it('does not fall back to cache for 404 (repo genuinely missing)', async () => {
    const meta = makeMeta();
    const tmpCache = `/tmp/test-cache-404-${Date.now()}.json`;
    const { promises: fs } = await import('node:fs');
    await fs.writeFile(tmpCache, JSON.stringify({ repos: { 'acme/api': meta } }), 'utf8');

    const notFoundFetch = mockFetch(404, { error: 'NOT_FOUND' });
    const client = new RepoRegistryClient({
      baseUrl: 'http://localhost:3000',
      cachePath: tmpCache,
      fetch: notFoundFetch,
    });
    await expect(client.get('acme', 'api')).rejects.toBeInstanceOf(RepoNotFoundError);

    await fs.unlink(tmpCache).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('update()', () => {
  it('returns updated metadata on 200', async () => {
    const updated = { ...makeMeta(), description: 'updated' };
    const client = makClient(mockFetch(200, updated));
    const result = await client.update('acme', 'api', { description: 'updated' });
    expect(result.description).toBe('updated');
  });

  it('throws RepoNotFoundError on 404', async () => {
    const client = makClient(mockFetch(404, { error: 'NOT_FOUND' }));
    await expect(client.update('acme', 'missing', { description: 'x' }))
      .rejects.toBeInstanceOf(RepoNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe('remove()', () => {
  it('resolves on 204', async () => {
    const fetchFn = vi.fn(async () => ({ status: 204, json: async () => ({}) })) as unknown as typeof fetch;
    const client = makClient(fetchFn);
    await expect(client.remove('acme', 'api')).resolves.toBeUndefined();
  });

  it('throws RepoNotFoundError on 404', async () => {
    const client = makClient(mockFetch(404, { error: 'NOT_FOUND' }));
    await expect(client.remove('acme', 'missing'))
      .rejects.toBeInstanceOf(RepoNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------

describe('search()', () => {
  it('returns search results', async () => {
    const body = { total: 2, repos: [makeMeta(), makeMeta('acme', 'web')] };
    const client = makClient(mockFetch(200, body));
    const result = await client.search();
    expect(result.total).toBe(2);
    expect(result.repos).toHaveLength(2);
  });

  it('appends query params when provided', async () => {
    const fetchFn = mockFetch(200, { total: 0, repos: [] });
    const client = makClient(fetchFn);
    await client.search({ query: 'api', org: 'acme', limit: 5, offset: 0 });
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('q=api');
    expect(call[0]).toContain('org=acme');
    expect(call[0]).toContain('limit=5');
    expect(call[0]).toContain('offset=0');
  });
});

// ---------------------------------------------------------------------------
// resolve()
// ---------------------------------------------------------------------------

describe('resolve()', () => {
  it('returns match when found by name', async () => {
    const body = { match: makeMeta(), ambiguous: false };
    const client = makClient(mockFetch(200, body));
    const result = await client.resolve({ name: 'api' });
    expect(result.match?.name).toBe('api');
    expect(result.ambiguous).toBe(false);
  });

  it('throws RepoAmbiguousError when server returns ambiguous=true', async () => {
    const candidates = [makeMeta('org1', 'shared'), makeMeta('org2', 'shared')];
    const body = { match: null, ambiguous: true, candidates };
    const client = makClient(mockFetch(200, body));
    await expect(client.resolve({ name: 'shared' }))
      .rejects.toBeInstanceOf(RepoAmbiguousError);
  });

  it('returns null match on 404', async () => {
    const client = makClient(mockFetch(404, {}));
    const result = await client.resolve({ name: 'nope' });
    expect(result.match).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('throws when neither name nor url provided', async () => {
    const client = makClient(mockFetch(200, {}));
    await expect(client.resolve({})).rejects.toThrow('requires at least one of');
  });

  it('falls back to cache on network failure for name lookup', async () => {
    const meta = makeMeta();
    const tmpCache = `/tmp/test-cache-resolve-${Date.now()}.json`;
    const { promises: fs } = await import('node:fs');
    await fs.writeFile(tmpCache, JSON.stringify({ repos: { 'acme/api': meta } }), 'utf8');

    const errFetch = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const client = new RepoRegistryClient({
      baseUrl: 'http://localhost:3000',
      cachePath: tmpCache,
      fetch: errFetch,
    });
    const result = await client.resolve({ name: 'api' });
    expect(result.match?.name).toBe('api');

    await fs.unlink(tmpCache).catch(() => {});
  });

  it('throws RepoAmbiguousError from cache when multiple orgs match', async () => {
    const repos = {
      'org1/shared': makeMeta('org1', 'shared'),
      'org2/shared': makeMeta('org2', 'shared'),
    };
    const tmpCache = `/tmp/test-cache-ambig-${Date.now()}.json`;
    const { promises: fs } = await import('node:fs');
    await fs.writeFile(tmpCache, JSON.stringify({ repos }), 'utf8');

    const errFetch = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const client = new RepoRegistryClient({
      baseUrl: 'http://localhost:3000',
      cachePath: tmpCache,
      fetch: errFetch,
    });
    await expect(client.resolve({ name: 'shared' })).rejects.toBeInstanceOf(RepoAmbiguousError);

    await fs.unlink(tmpCache).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe('Error classes', () => {
  it('RepoNotFoundError has correct code and name', () => {
    const err = new RepoNotFoundError('acme', 'api');
    expect(err.code).toBe('REPO_NOT_FOUND');
    expect(err.name).toBe('RepoNotFoundError');
    expect(err.message).toContain('acme/api');
  });

  it('RepoExistsError has correct code and name', () => {
    const err = new RepoExistsError('acme', 'api');
    expect(err.code).toBe('REPO_EXISTS');
    expect(err.name).toBe('RepoExistsError');
  });

  it('RepoAmbiguousError stores candidates', () => {
    const candidates = [{ org: 'a', name: 'x', canonicalUrl: 'u1' }];
    const err = new RepoAmbiguousError('x', candidates);
    expect(err.code).toBe('REPO_AMBIGUOUS');
    expect(err.candidates).toHaveLength(1);
  });
});
