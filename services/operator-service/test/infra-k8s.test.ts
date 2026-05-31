import { describe, it, expect, beforeEach } from 'vitest';
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
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      // Reads ConfigMap (1) + checks GitHub (1) = 2 calls.
      expect(calls).toHaveLength(2);
      expect(calls[1].method).toBe('GET');
    });

    it('creates repo via org endpoint when owner is an org (empty registry)', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(calls).toHaveLength(3);
      const createCall = calls[2];
      expect(createCall.method).toBe('POST');
      const body = JSON.parse(createCall.body!);
      expect(body.name).toBe('vault-acme_notes');
      expect(body.private).toBe(true);
      expect(body.auto_init).toBe(true);
    });

    it('uses explicit git_org and repo_name from opts', async () => {
      const { fetch, calls } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/custom-org/my-vault': { status: 404 },
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
      // ConfigMap read (1) + GitHub check (2) + create (3).
      expect(calls).toHaveLength(3);
      expect(calls[1].url).toBe('https://api.github.com/repos/custom-org/my-vault');
      expect(calls[2].url).toBe('https://api.github.com/orgs/custom-org/repos');
      const body = JSON.parse(calls[2].body!);
      expect(body.name).toBe('my-vault');
    });

    it('does NOT fall back to user/repos — throws on non-OK org create', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 403,
          body: { message: 'forbidden' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).rejects.toThrow(
        /GitHub repo create failed for org "testorg": HTTP 403/,
      );
    });

    it('treats 422 (already exists race) as success', async () => {
      const { fetch } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
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
      });
      // Preserves existing entries
      expect(registry.vaults['default']).toBeDefined();
    });

    it('includes git_repo when ensureGitBackingStore was called first', async () => {
      const { fetch, calls } = createFake({
        // First call: registry is empty (for ensureGitBackingStore check).
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
        // ensureRegistryEntry reads the map again (now also empty, no collision).
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      // Make CM_GET_URL return empty registry on BOTH calls (GET happens twice).
      const { fetch: fetch2, calls: calls2 } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch2);
      // For the repo-exists+no-registry path: we need the registry to have this namespace
      // to avoid REPO_PATH_IN_USE. Let's use the create path instead (repo doesn't exist).
      const { fetch: fetch3, calls: calls3 } = createFake({
        [`GET ${CM_GET_URL}`]: cmGetResponse({}),
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
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

      // Calls: GET CM (git check) + GET GH + POST GH + GET CM (ts check) + GET TS + POST TS + GET CM (reg) + PATCH CM
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
  });
});
