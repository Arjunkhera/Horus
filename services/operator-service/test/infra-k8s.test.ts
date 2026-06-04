import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KubernetesVaultInfra,
  CollisionError,
  ConfigError,
  type HttpFetch,
  type KubernetesVaultInfraConfig,
} from '../src/infra-k8s.js';

function baseConfig(): KubernetesVaultInfraConfig {
  return {
    githubToken: 'ghp_test',
    githubOwner: 'testorg',
    typesenseUrl: 'http://typesense:8108',
    typesenseApiKey: 'ts-key',
    k8sApiUrl: 'https://kubernetes.default.svc',
    k8sToken: 'k8s-token',
    k8sNamespace: 'horus-system',
    configMapName: 'vault-registry',
    configMapKey: 'registry.yaml',
    readerEndpoint: 'http://vault-reader:8000',
    writerEndpoint: 'http://vault-writer:8000',
  };
}

type FakeCall = { url: string; method: string; body?: string; headers?: Record<string, string> };

function createFake(
  responses: Record<string, { status: number; body?: unknown }>,
): { fetch: HttpFetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fakeFetch: HttpFetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body, headers: init?.headers as Record<string, string> | undefined });
    const key = `${method} ${url}`;
    const match =
      responses[key] ??
      Object.entries(responses).find(([k]) => {
        if (k.endsWith('*')) return key.startsWith(k.slice(0, -1));
        return false;
      })?.[1];
    const res = match ?? { status: 404, body: { message: 'not found' } };
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      json: async () => res.body ?? {},
      text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {})),
    };
  };
  return { fetch: fakeFetch, calls };
}

// ── ConfigMap helpers (shared across tests) ─────────────────────────────────

const CM_GET_URL =
  'https://kubernetes.default.svc/api/v1/namespaces/horus-system/configmaps/vault-registry';
const CM_PATCH_URL = CM_GET_URL;

function cmGetResponse(vaults: Record<string, unknown> = {}): {
  status: number;
  body: unknown;
} {
  return {
    status: 200,
    body: {
      data: { 'registry.yaml': JSON.stringify({ vaults }, null, 2) },
    },
  };
}

/** Standard GET /user response for an org-type owner (not the token user). */
const GH_USER_ORG_OWNER = {
  status: 200,
  body: { login: 'tokenuser', type: 'User' },
};

/** GET /user response where login matches 'testorg' (config owner IS the token user). */
const GH_USER_IS_TESTORG = {
  status: 200,
  body: { login: 'testorg', type: 'User' },
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('KubernetesVaultInfra', () => {
  describe('ensureGitBackingStore', () => {
    it('skips creation when repo already exists and namespace is in registry (retry)', async () => {
      const { fetch, calls } = createFake({
        // Registry already has this namespace (completed prior run) with the same path.
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          'acme/notes': { git_repo: 'testorg/vault-acme_notes', reader_endpoint: 'http://r:8000' },
        }),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
        // GET /user is NOT reached because we return early before the create step.
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      // Reads ConfigMap (1) + checks GitHub (1) = 2 calls. No /user call since no create.
      expect(calls).toHaveLength(2);
      expect(calls[1].method).toBe('GET');
    });

    // ── Test A: owner equals token login → use /user/repos ──────────────────
    it('Test A: creates repo via /user/repos when git_org matches the token login', async () => {
      // Config owner is 'testorg'; GET /user returns login 'testorg' → same person.
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_IS_TESTORG,
        'POST https://api.github.com/user/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      // ConfigMap read (1) + GitHub existence check (2) + GET /user (3) + POST /user/repos (4)
      expect(calls).toHaveLength(4);
      const createCall = calls[3];
      expect(createCall.method).toBe('POST');
      expect(createCall.url).toBe('https://api.github.com/user/repos');
      const body = JSON.parse(createCall.body!);
      expect(body.name).toBe('vault-acme_notes');
      expect(body.private).toBe(true);
      expect(body.auto_init).toBe(true);
    });

    // ── Test A: login comparison is case-insensitive ──────────────────────────
    it('Test A (case-insensitive): routes to /user/repos when login differs only in case', async () => {
      // Config owner has capital 'T'; GitHub login is all-lowercase.
      const config = { ...baseConfig(), githubOwner: 'Testorg' };
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/Testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': { status: 200, body: { login: 'testorg', type: 'User' } },
        'POST https://api.github.com/user/repos': { status: 201, body: {} },
      });
      const infra = new KubernetesVaultInfra(config, fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      const createCall = calls[3];
      expect(createCall.url).toBe('https://api.github.com/user/repos');
    });

    // ── Test B: owner is a different name (an org) → use /orgs/{org}/repos ───
    it('Test B: creates repo via /orgs/{org}/repos when git_org is different from token login', async () => {
      // Config owner is 'testorg'; GET /user returns login 'tokenuser' → different.
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      // ConfigMap read (1) + GitHub existence check (2) + GET /user (3) + POST /orgs/ (4)
      expect(calls).toHaveLength(4);
      const createCall = calls[3];
      expect(createCall.method).toBe('POST');
      expect(createCall.url).toBe('https://api.github.com/orgs/testorg/repos');
      const body = JSON.parse(createCall.body!);
      expect(body.name).toBe('vault-acme_notes');
      expect(body.private).toBe(true);
      expect(body.auto_init).toBe(true);
    });

    // ── Test C: GET /user returns non-200 → falls back to org endpoint ────────
    it('Test C: falls back to /orgs/{org}/repos when GET /user returns non-200', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': { status: 401, body: { message: 'Bad credentials' } },
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      // Should NOT throw — non-200 /user means we fall back to org endpoint, no error from identity step.
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).resolves.not.toThrow();
      const createCall = calls.find(c => c.method === 'POST');
      expect(createCall?.url).toBe('https://api.github.com/orgs/testorg/repos');
    });

    // ── Test C: GET /user network failure → falls back to org endpoint ────────
    it('Test C (network error): falls back to org endpoint when GET /user throws', async () => {
      let callCount = 0;
      const fakeFetch: HttpFetch = async (url, init) => {
        const method = init?.method ?? 'GET';
        callCount++;
        if (url === 'https://api.github.com/user') {
          throw new Error('network timeout');
        }
        if (method === 'GET' && url === CM_GET_URL) {
          return {
            status: 200, ok: true,
            json: async () => ({ data: { 'registry.yaml': JSON.stringify({ vaults: {} }, null, 2) } }),
            text: async () => '',
          };
        }
        if (method === 'GET' && url === 'https://api.github.com/repos/testorg/vault-acme_notes') {
          return { status: 404, ok: false, json: async () => ({}), text: async () => '' };
        }
        if (method === 'POST' && url === 'https://api.github.com/orgs/testorg/repos') {
          return { status: 201, ok: true, json: async () => ({}), text: async () => '' };
        }
        return { status: 404, ok: false, json: async () => ({}), text: async () => '' };
      };
      const infra = new KubernetesVaultInfra(baseConfig(), fakeFetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).resolves.not.toThrow();
    });

    // ── GET /user is cached — second provision reuses the cached login ─────────
    it('caches GET /user result — second ensureGitBackingStore does not re-fetch identity', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/repos/testorg/vault-other_ns': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': { status: 201, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      await infra.ensureGitBackingStore('other/ns', 'git');
      // GET /user should appear exactly once in calls
      const userCalls = calls.filter(c => c.url === 'https://api.github.com/user');
      expect(userCalls).toHaveLength(1);
    });

    it('creates repo via org endpoint when owner is an org (empty registry)', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      // ConfigMap read (1) + GitHub existence check (2) + GET /user (3) + create (4)
      expect(calls).toHaveLength(4);
      const createCall = calls[3];
      expect(createCall.method).toBe('POST');
      expect(createCall.url).toBe('https://api.github.com/orgs/testorg/repos');
      const body = JSON.parse(createCall.body!);
      expect(body.name).toBe('vault-acme_notes');
      expect(body.private).toBe(true);
      expect(body.auto_init).toBe(true);
    });

    it('uses explicit git_org and repo_name from opts', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/custom-org/my-vault': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/custom-org/repos': {
          status: 201,
          body: { full_name: 'custom-org/my-vault' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git', {
        gitOrg: 'custom-org',
        repoName: 'my-vault',
      });
      // ConfigMap read (1) + GitHub check (2) + GET /user (3) + create (4).
      expect(calls).toHaveLength(4);
      expect(calls[1].url).toBe('https://api.github.com/repos/custom-org/my-vault');
      expect(calls[3].url).toBe('https://api.github.com/orgs/custom-org/repos');
      const body = JSON.parse(calls[3].body!);
      expect(body.name).toBe('my-vault');
    });

    it('throws on non-OK create including the endpoint used in the error message', async () => {
      // owner !== token login → org endpoint; org endpoint returns 403.
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 403,
          body: { message: 'forbidden' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).rejects.toThrow(
        /GitHub repo create failed for owner "testorg" via \/orgs\/testorg\/repos: HTTP 403/,
      );
    });

    it('error message includes /user/repos when owner is the token user', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_IS_TESTORG,
        'POST https://api.github.com/user/repos': {
          status: 403,
          body: { message: 'forbidden' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).rejects.toThrow(
        /GitHub repo create failed for owner "testorg" via \/user\/repos: HTTP 403/,
      );
    });

    it('treats 422 (already exists race) as success', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 422,
          body: { message: 'name already exists' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).resolves.not.toThrow();
    });

    it('throws ConfigError when GITHUB_OWNER is empty and no git_org provided', async () => {
      const config = { ...baseConfig(), githubOwner: '' };
      const { fetch } = createFake({});
      const infra = new KubernetesVaultInfra(config, fetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).rejects.toMatchObject({
        name: 'ConfigError',
      });
    });

    it('REPO_PATH_IN_USE: throws 409 when resolved path is owned by another namespace', async () => {
      // Registry already has 'other/vault' using the same repo path.
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          'other/vault': { git_repo: 'testorg/vault-acme_notes', reader_endpoint: 'http://r:8000' },
        }),
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(
        infra.ensureGitBackingStore('acme/notes', 'git'),
      ).rejects.toMatchObject({
        name: 'CollisionError',
        code: 'REPO_PATH_IN_USE',
      });
    });

    it('REPO_PATH_IN_USE: repo exists on GitHub but not in registry → throws, no silent adoption', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}), // no registry entry for 'acme/notes'
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(
        infra.ensureGitBackingStore('acme/notes', 'git'),
      ).rejects.toMatchObject({
        name: 'CollisionError',
        code: 'REPO_PATH_IN_USE',
      });
    });
  });

  describe('ensureTypesenseCollection', () => {
    it('skips creation when collection exists and namespace is in registry (retry)', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          'acme/notes': { typesense_collection: 'acme_notes', reader_endpoint: 'http://r:8000' },
        }),
        'GET http://typesense:8108/collections/acme_notes': { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureTypesenseCollection('acme/notes');
      expect(calls).toHaveLength(2);
    });

    it('creates collection with BASE_SCHEMA fields when absent', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 201, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureTypesenseCollection('acme/notes');
      expect(calls).toHaveLength(3);
      const body = JSON.parse(calls[2].body!);
      expect(body.name).toBe('acme_notes');
      expect(body.fields).toBeDefined();
      expect(body.fields.length).toBeGreaterThan(10);
      expect(body.default_sorting_field).toBe('modified_at');
    });

    it('treats 409 (conflict/exists) as success', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 409, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureTypesenseCollection('acme/notes')).resolves.not.toThrow();
    });

    it('COLLECTION_IN_USE: throws when slug is owned by another namespace in registry', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          'other/ns': { typesense_collection: 'acme_notes', reader_endpoint: 'http://r:8000' },
        }),
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(
        infra.ensureTypesenseCollection('acme/notes'),
      ).rejects.toMatchObject({
        name: 'CollisionError',
        code: 'COLLECTION_IN_USE',
      });
    });

    it('COLLECTION_IN_USE: collection exists on Typesense but not in registry → throws', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}), // no entry for 'acme/notes'
        'GET http://typesense:8108/collections/acme_notes': { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(
        infra.ensureTypesenseCollection('acme/notes'),
      ).rejects.toMatchObject({
        name: 'CollisionError',
        code: 'COLLECTION_IN_USE',
      });
    });
  });

  describe('ensureNeo4jDatabase', () => {
    it('is a no-op (Community single-db, dc028173)', async () => {
      const { fetch, calls } = createFake({});
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureNeo4jDatabase('acme/notes');
      expect(calls).toHaveLength(0);
    });
  });

  describe('ensureRegistryEntry', () => {
    it('reads ConfigMap, adds entry, patches back', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({ default: { reader_endpoint: 'http://r:8000' } }),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      expect(calls).toHaveLength(2);
      const patch = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes']).toEqual({
        reader_endpoint: 'http://vault-reader:8000',
        writer_endpoint: 'http://vault-writer:8000',
        typesense_collection: 'acme_notes',
        neo4j_db: 'acme_notes',
        git_repo: 'testorg/vault-acme_notes',
      });
      // Preserves existing entries
      expect(registry.vaults['default']).toBeDefined();
    });

    it('includes git_repo when ensureGitBackingStore was called first', async () => {
      const { fetch: fetch3, calls: calls3 } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra3 = new KubernetesVaultInfra(baseConfig(), fetch3);
      await infra3.ensureGitBackingStore('acme/notes', 'git');
      await infra3.ensureRegistryEntry('acme/notes', 'ignored');

      const patch = JSON.parse(calls3[calls3.length - 1].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].git_repo).toBe('testorg/vault-acme_notes');
    });

    it('isNamespaceRegistered returns true when namespace is in ConfigMap', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          'acme/notes': {
            git_repo: 'testorg/vault-acme_notes',
            reader_endpoint: 'http://r:8000',
            writer_endpoint: 'http://w:8000',
            typesense_collection: 'acme_notes',
            neo4j_db: 'acme_notes',
          },
        }),
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      expect(await infra.isNamespaceRegistered('acme/notes')).toBe(true);
      expect(await infra.isNamespaceRegistered('other/ns')).toBe(false);
    });

    // ── NEW: deterministic git_repo WITHOUT calling ensureGitBackingStore ────

    it('(adopt) writes git_repo derived from config.githubOwner without ensureGitBackingStore', async () => {
      // Simulate vault_attach: EMPTY gitRepos map — ensureGitBackingStore was never called.
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      // Do NOT call ensureGitBackingStore — that's the vault_attach path.
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      expect(calls).toHaveLength(2);
      const patchBody = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patchBody.data['registry.yaml']);
      const entry = registry.vaults['acme/notes'];
      // git_repo must be set deterministically even without ensureGitBackingStore.
      expect(entry.git_repo).toBe('testorg/vault-acme_notes');
      expect(entry.reader_endpoint).toBe('http://vault-reader:8000');
      expect(entry.writer_endpoint).toBe('http://vault-writer:8000');
      expect(entry.typesense_collection).toBe('acme_notes');
      expect(entry.neo4j_db).toBe('acme_notes');
    });

    it('(adopt) idempotency — calling ensureRegistryEntry twice produces identical complete entries', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);

      await infra.ensureRegistryEntry('acme/notes', 'ignored');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      // Two GET + two PATCH calls.
      expect(calls).toHaveLength(4);

      const patch1 = JSON.parse(calls[1].body!);
      const patch2 = JSON.parse(calls[3].body!);
      const reg1 = JSON.parse(patch1.data['registry.yaml']);
      const reg2 = JSON.parse(patch2.data['registry.yaml']);

      expect(reg1.vaults['acme/notes']).toEqual(reg2.vaults['acme/notes']);
      // All five fields must be present and non-empty.
      const entry = reg1.vaults['acme/notes'];
      expect(entry.git_repo).toBe('testorg/vault-acme_notes');
      expect(entry.reader_endpoint).toBeTruthy();
      expect(entry.writer_endpoint).toBeTruthy();
      expect(entry.typesense_collection).toBeTruthy();
      expect(entry.neo4j_db).toBeTruthy();
    });

    it('(adopt) PATCH uses content-type application/strategic-merge-patch+json', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const patchCall = calls[1];
      expect(patchCall.method).toBe('PATCH');
      expect(patchCall.headers?.['content-type']).toBe('application/strategic-merge-patch+json');
      expect(patchCall.url).toBe(CM_PATCH_URL);
    });

    it('(adopt) explicit gitOrg/repoName opts override config.githubOwner in git_repo', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureRegistryEntry('acme/notes', 'ignored', {
        gitOrg: 'custom-org',
        repoName: 'custom-vault',
      });

      const patchBody = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patchBody.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].git_repo).toBe('custom-org/custom-vault');
    });

    it('(adopt) omits git_repo (does NOT throw) when GITHUB_OWNER is empty and no opts.gitOrg provided', async () => {
      // FIX 1: graceful degradation — bare vault_attach with no git fields and empty owner
      // must succeed and write a complete-minus-git_repo entry.
      const config = { ...baseConfig(), githubOwner: '' };
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(config, fetch);
      // Must NOT throw — graceful degradation.
      await expect(infra.ensureRegistryEntry('acme/notes', 'ignored')).resolves.not.toThrow();

      expect(calls).toHaveLength(2);
      const patchBody = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patchBody.data['registry.yaml']);
      const entry = registry.vaults['acme/notes'];
      // git_repo must be ABSENT — owner was unresolvable.
      expect(entry.git_repo).toBeUndefined();
      // The rest of the entry must still be present.
      expect(entry.reader_endpoint).toBe('http://vault-reader:8000');
      expect(entry.writer_endpoint).toBe('http://vault-writer:8000');
      expect(entry.typesense_collection).toBe('acme_notes');
      expect(entry.neo4j_db).toBe('acme_notes');
    });
  });

  describe('removeRegistryEntry', () => {
    it('removes the namespace from the ConfigMap', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          default: { reader_endpoint: 'http://r:8000' },
          'acme/notes': { reader_endpoint: 'http://r:8000' },
        }),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.removeRegistryEntry('acme/notes');

      const patch = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes']).toBeUndefined();
      expect(registry.vaults['default']).toBeDefined();
    });
  });

  // ── readConfigMap / YAML-seed preservation (Defect 4) ────────────────────

  describe('readConfigMap — YAML-seed preservation', () => {
    it('parses YAML-seed format and returns the default entry intact', async () => {
      // Simulate the git-seeded YAML format (with comments, no JSON wrapper).
      const yamlSeed =
        '# vault-registry\nvaults:\n  default:\n    reader_endpoint: http://vault-reader:8000\n    writer_endpoint: http://vault-writer:8000\n';
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: {
          status: 200,
          body: { data: { 'registry.yaml': yamlSeed } },
        },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      // ensureRegistryEntry triggers a readConfigMap then patchConfigMap.
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      expect(calls).toHaveLength(2);
      const patch = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      // The seeded `default` entry must survive into the patched ConfigMap.
      expect(registry.vaults['default']).toBeDefined();
      expect(registry.vaults['default'].reader_endpoint).toBe('http://vault-reader:8000');
      // The new entry should also be present.
      expect(registry.vaults['acme/notes']).toBeDefined();
    });

    it('parses operator JSON output format correctly', async () => {
      // After the first operator write the ConfigMap contains JSON (valid YAML).
      const jsonContent = JSON.stringify({ vaults: { default: { reader_endpoint: 'http://r:8000' } } }, null, 2);
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: {
          status: 200,
          body: { data: { 'registry.yaml': jsonContent } },
        },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const patch = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['default']).toBeDefined();
      expect(registry.vaults['acme/notes']).toBeDefined();
    });

    it('returns empty vaults when ConfigMap data is absent or whitespace', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: {
          status: 200,
          body: { data: { 'registry.yaml': '   ' } },
        },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const patch = JSON.parse(calls[1].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes']).toBeDefined();
    });

    it('throws (does NOT silently return empty) when non-empty data is malformed', async () => {
      // 'key: [unclosed bracket' is invalid YAML (unclosed flow sequence) — the yaml
      // package throws a parse error on this, which readConfigMap must re-throw rather
      // than swallowing as an empty registry (the original bug).
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: {
          status: 200,
          body: { data: { 'registry.yaml': 'key: [unclosed bracket' } },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureRegistryEntry('acme/notes', 'ignored')).rejects.toThrow(
        /ConfigMap registry parse failed/,
      );
    });
  });

  describe('dropTypesenseCollection', () => {
    it('deletes the collection', async () => {
      const { fetch, calls } = createFake({
        'DELETE http://typesense:8108/collections/acme_notes': { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.dropTypesenseCollection('acme/notes');
      expect(calls[0].method).toBe('DELETE');
    });

    it('treats 404 as success (already gone)', async () => {
      const { fetch } = createFake({
        'DELETE http://typesense:8108/collections/acme_notes': { status: 404 },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.dropTypesenseCollection('acme/notes')).resolves.not.toThrow();
    });
  });

  describe('full C2 reconcile flow', () => {
    it('creates GitHub repo + Typesense collection + registry entry in order', async () => {
      // Both ensureGitBackingStore and ensureTypesenseCollection read ConfigMap first.
      // This fake returns the same empty registry for all GET CM calls.
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': { status: 201, body: {} },
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 201, body: {} },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);

      await infra.ensureGitBackingStore('acme/notes', 'git');
      await infra.ensureTypesenseCollection('acme/notes');
      await infra.ensureNeo4jDatabase('acme/notes');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      // Calls: GET CM + GET GH check + GET /user + POST GH + GET CM (ts) + GET TS + POST TS + GET CM (reg) + PATCH CM
      expect(calls.length).toBeGreaterThanOrEqual(7);
      const patchCall = calls[calls.length - 1];
      expect(patchCall.method).toBe('PATCH');
      const patch = JSON.parse(patchCall.body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].typesense_collection).toBe('acme_notes');
      expect(registry.vaults['acme/notes'].git_repo).toBe('testorg/vault-acme_notes');
    });

    it('explicit git_org/repo_name flow: registry git_repo reflects the explicit path', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/myorg/myvault': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/myorg/repos': { status: 201, body: {} },
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 201, body: {} },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);

      await infra.ensureGitBackingStore('acme/notes', 'git', {
        gitOrg: 'myorg',
        repoName: 'myvault',
      });
      await infra.ensureTypesenseCollection('acme/notes');
      await infra.ensureNeo4jDatabase('acme/notes');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const patchCall = calls[calls.length - 1];
      const patch = JSON.parse(patchCall.body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].git_repo).toBe('myorg/myvault');
    });

    it('user-account owner flow: uses /user/repos and registry git_repo is correct', async () => {
      // Owner 'Arjunkhera' matches the token login — production scenario.
      const config = { ...baseConfig(), githubOwner: 'Arjunkhera' };
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/Arjunkhera/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': { status: 200, body: { login: 'arjunkhera', type: 'User' } },
        'POST https://api.github.com/user/repos': { status: 201, body: { full_name: 'Arjunkhera/vault-acme_notes' } },
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 201, body: {} },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(config, fetch);

      await infra.ensureGitBackingStore('acme/notes', 'git');
      await infra.ensureTypesenseCollection('acme/notes');
      await infra.ensureNeo4jDatabase('acme/notes');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      // Assert /user/repos was used (not /orgs/)
      const createCall = calls.find(c => c.method === 'POST' && c.url.includes('github.com'));
      expect(createCall?.url).toBe('https://api.github.com/user/repos');

      const patchCall = calls[calls.length - 1];
      const patch = JSON.parse(patchCall.body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].git_repo).toBe('Arjunkhera/vault-acme_notes');
    });
  });

  // ── GitHub token resolution — Secret-rotation hot-reload (bug 52f1cda8) ──────
  // Regression guard: the operator must read GITHUB_TOKEN from the mounted file
  // on EVERY GitHub request, so a rotated Secret (hot-reloaded into the file)
  // takes effect without a pod restart. Previously the token was an env-var
  // snapshot frozen at construction, which went stale on rotation → 401s.
  describe('GitHub token resolution (Secret-rotation hot-reload)', () => {
    /** Authorization headers from GitHub API calls, in order. */
    function githubAuthHeaders(calls: FakeCall[]): string[] {
      return calls
        .filter(c => c.url.startsWith('https://api.github.com/'))
        .map(c => c.headers?.authorization ?? '');
    }

    /** Retry-path fake: namespace already owns the repo, so a single GitHub GET
     *  (carrying the Authorization header) runs and the method returns. */
    function retryPathFake() {
      return createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({
          'acme/notes': { git_repo: 'testorg/vault-acme_notes', reader_endpoint: 'http://r:8000' },
        }),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
    }

    it('reads githubTokenPath fresh on every request — a rotated token applies without reconstruction', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'op-token-'));
      const tokenFile = join(dir, 'GITHUB_TOKEN');
      try {
        writeFileSync(tokenFile, 'ghp_initial\n');
        const config = {
          ...baseConfig(),
          githubToken: 'ghp_stale_env',
          githubTokenPath: tokenFile,
        };
        const { fetch, calls } = retryPathFake();
        const infra = new KubernetesVaultInfra(config, fetch);

        await infra.ensureGitBackingStore('acme/notes', 'git');
        expect(githubAuthHeaders(calls)).toContain('Bearer ghp_initial');

        // Rotate the token on disk — SAME instance, no reconstruction.
        writeFileSync(tokenFile, 'ghp_rotated\n');
        await infra.ensureGitBackingStore('acme/notes', 'git');

        const headers = githubAuthHeaders(calls);
        expect(headers[headers.length - 1]).toBe('Bearer ghp_rotated');
        // The frozen env-var snapshot must never have been used.
        expect(headers).not.toContain('Bearer ghp_stale_env');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('trims trailing whitespace/newline from the token file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'op-token-'));
      const tokenFile = join(dir, 'GITHUB_TOKEN');
      try {
        writeFileSync(tokenFile, '  ghp_padded\n\n');
        const config = { ...baseConfig(), githubTokenPath: tokenFile };
        const { fetch, calls } = retryPathFake();
        const infra = new KubernetesVaultInfra(config, fetch);
        await infra.ensureGitBackingStore('acme/notes', 'git');
        expect(githubAuthHeaders(calls)).toContain('Bearer ghp_padded');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to the static env-var token when githubTokenPath is unreadable', async () => {
      const config = {
        ...baseConfig(),
        githubToken: 'ghp_env_fallback',
        githubTokenPath: join(tmpdir(), 'definitely-missing-operator-token-file'),
      };
      const { fetch, calls } = retryPathFake();
      const infra = new KubernetesVaultInfra(config, fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(githubAuthHeaders(calls)).toContain('Bearer ghp_env_fallback');
    });

    it('uses the static env-var token when no githubTokenPath is configured', async () => {
      const config = { ...baseConfig(), githubToken: 'ghp_only_env' };
      const { fetch, calls } = retryPathFake();
      const infra = new KubernetesVaultInfra(config, fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(githubAuthHeaders(calls)).toContain('Bearer ghp_only_env');
    });
  });

  // ── Enterprise GitHub host (githubApiHost / per-request gitApiHost) ──────────
  describe('enterprise GitHub host', () => {
    const GHE = 'https://github.intuit.com/api/v3';

    it('targets the GHE API base (https://<host>/api/v3) for every GitHub call when githubApiHost is set', async () => {
      const config = { ...baseConfig(), githubApiHost: 'github.intuit.com' };
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`GET ${GHE}/repos/testorg/vault-acme_notes`]: { status: 404 },
        [`GET ${GHE}/user`]: GH_USER_ORG_OWNER,
        [`POST ${GHE}/orgs/testorg/repos`]: { status: 201, body: {} },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(config, fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      // No call should touch the public api.github.com.
      expect(calls.some((c) => c.url.includes('api.github.com'))).toBe(false);
      expect(calls[1].url).toBe(`${GHE}/repos/testorg/vault-acme_notes`);
      expect(calls[2].url).toBe(`${GHE}/user`);
      expect(calls[3].url).toBe(`${GHE}/orgs/testorg/repos`);
    });

    it('honors a per-request gitApiHost override over the operator-wide default', async () => {
      // Operator default is public github.com; the payload pins this vault to GHE.
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        [`GET ${GHE}/repos/testorg/vault-acme_notes`]: { status: 404 },
        [`GET ${GHE}/user`]: GH_USER_IS_TESTORG,
        [`POST ${GHE}/user/repos`]: { status: 201, body: {} },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git', { gitApiHost: 'github.intuit.com' });
      expect(calls.some((c) => c.url.includes('api.github.com'))).toBe(false);
      expect(calls[3].url).toBe(`${GHE}/user/repos`);
    });

    it('treats githubApiHost "github.com" as the public api.github.com base', async () => {
      const config = { ...baseConfig(), githubApiHost: 'github.com' };
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'GET https://api.github.com/user': GH_USER_ORG_OWNER,
        'POST https://api.github.com/orgs/testorg/repos': { status: 201, body: {} },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(config, fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(calls[1].url).toBe('https://api.github.com/repos/testorg/vault-acme_notes');
      expect(calls[3].url).toBe('https://api.github.com/orgs/testorg/repos');
    });
  });
});
