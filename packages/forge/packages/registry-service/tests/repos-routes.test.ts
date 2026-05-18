/**
 * Integration tests for the repo registry routes (RR-4).
 *
 * Uses createApp with in-memory stubs for RepoStorageAdapter and RepoSearchClient.
 * The app is built once per describe block and torn down after.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import type { StorageBackend } from '../src/storage/types.js';
import type { AuditLog } from '../src/audit/audit-log.js';
import type { AuthStrategy } from '../src/auth/types.js';
import type { PublishPipeline } from '../src/pipeline/publish-pipeline.js';
import type { RepoStorageAdapter } from '../src/storage/repo-storage.js';
import type { RepoSearchClient } from '../src/search/repo-search.js';
import type { RepoMetadata } from '../src/types/repo-metadata.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeStubStorage(): StorageBackend {
  return {
    exists: vi.fn(async () => false),
    writeBundle: vi.fn(async () => {}),
    readBundle: vi.fn(async () => { throw new Error('not found'); }),
    listVersions: vi.fn(async () => []),
    listArtifacts: vi.fn(async () => []),
    healthCheck: vi.fn(async () => ({ ok: true })),
    ping: vi.fn(async () => {}),
  } as unknown as StorageBackend;
}

const stubAuditLog: AuditLog = { append: vi.fn(async () => {}) };

const allowAuth: AuthStrategy = {
  identify: vi.fn(async () => null),
  authorize: vi.fn(() => 'permit' as const),
};

const denyAuth: AuthStrategy = {
  identify: vi.fn(async () => null),
  authorize: vi.fn(() => 'deny' as const),
};

const stubPipeline = {} as PublishPipeline;

function validMeta(org = 'acme', name = 'my-repo'): RepoMetadata {
  return {
    org,
    name,
    canonicalUrl: `git@github.com:${org}/${name}.git`,
    registeredAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeRepoStorage(initial: RepoMetadata[] = []): RepoStorageAdapter {
  const store = new Map<string, RepoMetadata>(
    initial.map((m) => [`${m.org}/${m.name}`, m]),
  );
  return {
    write: vi.fn(async (org, name, meta) => { store.set(`${org}/${name}`, meta); }),
    read: vi.fn(async (org, name) => store.get(`${org}/${name}`) ?? null),
    delete: vi.fn(async (org, name) => {
      const key = `${org}/${name}`;
      const had = store.has(key);
      store.delete(key);
      return had;
    }),
    exists: vi.fn(async (org, name) => store.has(`${org}/${name}`)),
    listAll: vi.fn(async () => [...store.values()]),
  } as unknown as RepoStorageAdapter;
}

function makeRepoSearch(): RepoSearchClient {
  const docs = new Map<string, RepoMetadata>();
  return {
    ensureCollection: vi.fn(async () => {}),
    index: vi.fn(async (meta: RepoMetadata) => { docs.set(`${meta.org}/${meta.name}`, meta); }),
    remove: vi.fn(async (org: string, name: string) => { docs.delete(`${org}/${name}`); }),
    search: vi.fn(async (params: { query?: string; limit?: number; offset?: number }) => {
      const all = [...docs.values()];
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;
      return { total: all.length, repos: all.slice(offset, offset + limit) };
    }),
    resolveByName: vi.fn(async (name: string) => {
      const matches = [...docs.values()].filter((m) => m.name === name);
      if (matches.length === 0) return { match: null, ambiguous: false };
      if (matches.length === 1) return { match: matches[0], ambiguous: false };
      return { match: null, ambiguous: true, candidates: matches };
    }),
    resolveByUrl: vi.fn(async (url: string) => {
      for (const m of docs.values()) {
        if (m.canonicalUrl === url) return m;
      }
      return null;
    }),
    rebuildFromStorage: vi.fn(async () => 0),
  } as unknown as RepoSearchClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(
  repoStorage: RepoStorageAdapter,
  repoSearch: RepoSearchClient | undefined,
  auth: AuthStrategy = allowAuth,
): FastifyInstance {
  return createApp({
    config: {
      logLevel: 'silent',
      server: { host: '0.0.0.0', port: 3000, coreVersion: '0.0.0' },
      storage: { backend: 'git', url: 'x', localPath: '/tmp/test' },
      auth: { strategy: 'builtin', admins: [] },
      dbPath: ':memory:',
    } as never,
    storage: makeStubStorage(),
    auth,
    auditLog: stubAuditLog,
    pipeline: stubPipeline,
    repoStorage,
    repoSearch,
  });
}

// ---------------------------------------------------------------------------
// POST /repos
// ---------------------------------------------------------------------------

describe('POST /repos', () => {
  let app: FastifyInstance;
  let repoStorage: RepoStorageAdapter;
  let repoSearch: RepoSearchClient;

  beforeAll(async () => {
    repoStorage = makeRepoStorage();
    repoSearch = makeRepoSearch();
    app = buildApp(repoStorage, repoSearch);
    await app.ready();
  });

  afterAll(() => app.close());

  it('creates a repo and returns 201 with full metadata', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { org: 'acme', name: 'api', canonicalUrl: 'git@github.com:acme/api.git' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<RepoMetadata>();
    expect(body.org).toBe('acme');
    expect(body.name).toBe('api');
    expect(body.registeredAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
    expect(repoStorage.write).toHaveBeenCalled();
    expect(repoSearch.index).toHaveBeenCalled();
  });

  it('returns 409 on duplicate org/name', async () => {
    const payload = { org: 'dup', name: 'repo', canonicalUrl: 'git@github.com:dup/repo.git' };
    await app.inject({ method: 'POST', url: '/repos', payload });
    const res = await app.inject({ method: 'POST', url: '/repos', payload });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('REPO_EXISTS');
  });

  it('returns 400 on missing required fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/repos', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when auth denies', async () => {
    const denyApp = buildApp(makeRepoStorage(), makeRepoSearch(), denyAuth);
    await denyApp.ready();
    const res = await denyApp.inject({
      method: 'POST',
      url: '/repos',
      payload: { org: 'x', name: 'y', canonicalUrl: 'git@github.com:x/y.git' },
    });
    expect(res.statusCode).toBe(403);
    await denyApp.close();
  });
});

// ---------------------------------------------------------------------------
// GET /repos/:org/:name
// ---------------------------------------------------------------------------

describe('GET /repos/:org/:name', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp(makeRepoStorage([validMeta()]), makeRepoSearch());
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns 200 with metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/acme/my-repo' });
    expect(res.statusCode).toBe(200);
    expect(res.json<RepoMetadata>().org).toBe('acme');
  });

  it('returns 404 for unknown repo', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/acme/unknown' });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /repos/:org/:name
// ---------------------------------------------------------------------------

describe('PATCH /repos/:org/:name', () => {
  let app: FastifyInstance;
  let repoStorage: RepoStorageAdapter;

  beforeAll(async () => {
    repoStorage = makeRepoStorage([
      {
        ...validMeta(),
        workflow: { type: 'owner', pushTo: 'origin', prTarget: { repo: 'acme/my-repo', branch: 'main' } },
      },
    ]);
    app = buildApp(repoStorage, makeRepoSearch());
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns 200 with merged metadata', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/repos/acme/my-repo',
      payload: { description: 'updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<RepoMetadata>().description).toBe('updated');
  });

  it('deep-merges workflow — preserves pushTo when patching mergeStrategy', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/repos/acme/my-repo',
      payload: { workflow: { mergeStrategy: 'squash' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<RepoMetadata>();
    expect(body.workflow?.mergeStrategy).toBe('squash');
    expect(body.workflow?.pushTo).toBe('origin');
    expect(body.workflow?.prTarget).toBeDefined();
  });

  it('returns 404 for unknown repo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/repos/acme/nope',
      payload: { description: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /repos/:org/:name
// ---------------------------------------------------------------------------

describe('DELETE /repos/:org/:name', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp(makeRepoStorage([validMeta()]), makeRepoSearch());
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns 204 on successful delete', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/repos/acme/my-repo' });
    expect(res.statusCode).toBe(204);
  });

  it('returns 404 on second delete (already gone)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/repos/acme/my-repo' });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /repos (list/search)
// ---------------------------------------------------------------------------

describe('GET /repos', () => {
  let app: FastifyInstance;
  let repoSearch: RepoSearchClient;

  beforeAll(async () => {
    repoSearch = makeRepoSearch();
    const storage = makeRepoStorage([validMeta('acme', 'api'), validMeta('acme', 'web')]);
    // Pre-populate search
    await repoSearch.index(validMeta('acme', 'api'));
    await repoSearch.index(validMeta('acme', 'web'));
    app = buildApp(storage, repoSearch);
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns all repos with total', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ total: number; repos: RepoMetadata[] }>();
    expect(body.total).toBe(2);
    expect(body.repos).toHaveLength(2);
  });

  it('passes query params to search client', async () => {
    await app.inject({ method: 'GET', url: '/repos?q=api&limit=5&offset=0' });
    expect(repoSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'api', limit: 5, offset: 0 }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /repos/resolve
// ---------------------------------------------------------------------------

describe('GET /repos/resolve', () => {
  let app: FastifyInstance;
  let repoSearch: RepoSearchClient;

  beforeAll(async () => {
    repoSearch = makeRepoSearch();
    await repoSearch.index(validMeta('acme', 'Horus'));
    await repoSearch.index(validMeta('acme2', 'Horus'));   // same name, different org → ambiguous
    await repoSearch.index(validMeta('acme', 'unique'));
    app = buildApp(makeRepoStorage(), repoSearch);
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns single match by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/resolve?name=unique' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ match: RepoMetadata; ambiguous: boolean }>();
    expect(body.ambiguous).toBe(false);
    expect(body.match.name).toBe('unique');
  });

  it('returns ambiguous when multiple orgs have same name', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/resolve?name=Horus' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ambiguous: boolean; candidates: RepoMetadata[] }>();
    expect(body.ambiguous).toBe(true);
    expect(body.candidates).toHaveLength(2);
  });

  it('returns 404 when name not found', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/resolve?name=nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('resolves by URL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/repos/resolve?url=git%40github.com%3Aacme%2Funique.git',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ match: RepoMetadata }>();
    expect(body.match.name).toBe('unique');
  });

  it('returns 400 when neither name nor url provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/resolve' });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Full CRUD lifecycle
// ---------------------------------------------------------------------------

describe('Full CRUD lifecycle', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp(makeRepoStorage(), makeRepoSearch());
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST → GET → PATCH → GET (verify) → DELETE → GET (404)', async () => {
    const payload = { org: 'lifecycle', name: 'test', canonicalUrl: 'git@github.com:lifecycle/test.git' };

    // POST
    const post = await app.inject({ method: 'POST', url: '/repos', payload });
    expect(post.statusCode).toBe(201);

    // GET
    const get1 = await app.inject({ method: 'GET', url: '/repos/lifecycle/test' });
    expect(get1.statusCode).toBe(200);

    // PATCH
    const patch = await app.inject({
      method: 'PATCH',
      url: '/repos/lifecycle/test',
      payload: { description: 'patched' },
    });
    expect(patch.statusCode).toBe(200);

    // GET after patch
    const get2 = await app.inject({ method: 'GET', url: '/repos/lifecycle/test' });
    expect(get2.json<RepoMetadata>().description).toBe('patched');

    // DELETE
    const del = await app.inject({ method: 'DELETE', url: '/repos/lifecycle/test' });
    expect(del.statusCode).toBe(204);

    // GET after delete
    const get3 = await app.inject({ method: 'GET', url: '/repos/lifecycle/test' });
    expect(get3.statusCode).toBe(404);
  });
});
