import { describe, it, expect, beforeEach } from 'vitest';
import { KubernetesVaultInfra, type HttpFetch, type KubernetesVaultInfraConfig } from '../src/infra-k8s.js';

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
    it('skips creation when repo already exists', async () => {
      const { fetch, calls } = createFake({
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('GET');
    });

    it('creates repo via org endpoint when owner is an org', async () => {
      const { fetch, calls } = createFake({
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(calls).toHaveLength(2);
      const createCall = calls[1];
      expect(createCall.method).toBe('POST');
      const body = JSON.parse(createCall.body!);
      expect(body.name).toBe('vault-acme_notes');
      expect(body.private).toBe(true);
      expect(body.auto_init).toBe(true);
    });

    it('falls back to user endpoint when org returns 404', async () => {
      const { fetch, calls } = createFake({
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'POST https://api.github.com/orgs/testorg/repos': { status: 404 },
        'POST https://api.github.com/user/repos': {
          status: 201,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      expect(calls).toHaveLength(3);
      expect(calls[2].method).toBe('POST');
      expect(calls[2].url).toBe('https://api.github.com/user/repos');
    });

    it('treats 422 (already exists race) as success', async () => {
      const { fetch } = createFake({
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'POST https://api.github.com/orgs/testorg/repos': {
          status: 422,
          body: { message: 'name already exists' },
        },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureGitBackingStore('acme/notes', 'git')).resolves.not.toThrow();
    });
  });

  describe('ensureTypesenseCollection', () => {
    it('skips creation when collection exists', async () => {
      const { fetch, calls } = createFake({
        'GET http://typesense:8108/collections/acme_notes': { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureTypesenseCollection('acme/notes');
      expect(calls).toHaveLength(1);
    });

    it('creates collection with BASE_SCHEMA fields when absent', async () => {
      const { fetch, calls } = createFake({
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 201, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureTypesenseCollection('acme/notes');
      expect(calls).toHaveLength(2);
      const body = JSON.parse(calls[1].body!);
      expect(body.name).toBe('acme_notes');
      expect(body.fields).toBeDefined();
      expect(body.fields.length).toBeGreaterThan(10);
      expect(body.default_sorting_field).toBe('modified_at');
    });

    it('treats 409 (conflict/exists) as success', async () => {
      const { fetch } = createFake({
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 409, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await expect(infra.ensureTypesenseCollection('acme/notes')).resolves.not.toThrow();
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
        'GET https://api.github.com/repos/testorg/vault-acme_notes': {
          status: 200,
          body: { full_name: 'testorg/vault-acme_notes' },
        },
        [`GET ${CM_GET_URL}`]: cmGetResponse(),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);
      await infra.ensureGitBackingStore('acme/notes', 'git');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const patch = JSON.parse(calls[2].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].git_repo).toBe('testorg/vault-acme_notes');
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
      const { fetch, calls } = createFake({
        'GET https://api.github.com/repos/testorg/vault-acme_notes': { status: 404 },
        'POST https://api.github.com/orgs/testorg/repos': { status: 201, body: {} },
        'GET http://typesense:8108/collections/acme_notes': { status: 404 },
        'POST http://typesense:8108/collections': { status: 201, body: {} },
        [`GET ${CM_GET_URL}`]: cmGetResponse({ default: { reader_endpoint: 'http://r:8000' } }),
        [`PATCH ${CM_PATCH_URL}`]: { status: 200, body: {} },
      });
      const infra = new KubernetesVaultInfra(baseConfig(), fetch);

      await infra.ensureGitBackingStore('acme/notes', 'git');
      await infra.ensureTypesenseCollection('acme/notes');
      await infra.ensureNeo4jDatabase('acme/notes');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      expect(calls).toHaveLength(6);
      const patch = JSON.parse(calls[5].body!);
      const registry = JSON.parse(patch.data['registry.yaml']);
      expect(registry.vaults['acme/notes'].typesense_collection).toBe('acme_notes');
      expect(registry.vaults['acme/notes'].git_repo).toBe('testorg/vault-acme_notes');
    });
  });
});
