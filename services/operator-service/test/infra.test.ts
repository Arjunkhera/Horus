import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileVaultInfra, InMemoryVaultInfra, InMemoryCollisionError, namespaceSlug } from '../src/infra.js';

const fsAdapter = { readFileSync, writeFileSync, existsSync };

describe('namespaceSlug', () => {
  it('slugs owner/vault into a datastore-safe name', () => {
    expect(namespaceSlug('acme/notes')).toBe('acme_notes');
    expect(namespaceSlug('a-b/c.d')).toBe('a_b_c_d');
  });
});

describe('FileVaultInfra (vault-registry writer)', () => {
  it('writes/removes a registry entry in vault-router parse shape, idempotently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-'));
    const path = join(dir, 'registry.json');
    const infra = new FileVaultInfra(
      path,
      'http://vault-reader:8000',
      'http://vault-writer:8000',
      fsAdapter,
    );
    try {
      // Full C2 reconcile order. git_org + repo_name are explicit here so the
      // git_repo value in the registry is predictable.
      await infra.ensureGitBackingStore('acme/notes', 'git-subdir', {
        gitOrg: 'my-org',
        repoName: 'my-vault',
      });
      await infra.ensureTypesenseCollection('acme/notes');
      await infra.ensureNeo4jDatabase('acme/notes');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const doc = JSON.parse(readFileSync(path, 'utf8'));
      expect(doc.vaults['acme/notes']).toEqual({
        reader_endpoint: 'http://vault-reader:8000',
        writer_endpoint: 'http://vault-writer:8000',
        typesense_collection: 'acme_notes',
        neo4j_db: 'acme_notes',
        git_repo: 'my-org/my-vault',
      });

      // Idempotent re-ensure → single entry.
      await infra.ensureRegistryEntry('acme/notes', 'ignored');
      expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).vaults)).toEqual(['acme/notes']);

      // Teardown removes the registry entry (git preserved — not touched here).
      await infra.removeRegistryEntry('acme/notes');
      expect(JSON.parse(readFileSync(path, 'utf8')).vaults).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults repo name to vault-<slug> when no opts provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-'));
    const path = join(dir, 'registry.json');
    const infra = new FileVaultInfra(
      path,
      'http://vault-reader:8000',
      'http://vault-writer:8000',
      fsAdapter,
    );
    try {
      await infra.ensureGitBackingStore('acme/notes', 'git-subdir');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      // Should default to default-org/vault-acme_notes (InMemoryVaultInfra default-org).
      expect(doc.vaults['acme/notes'].git_repo).toBe('default-org/vault-acme_notes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('InMemoryVaultInfra collision detection', () => {
  it('REPO_PATH_IN_USE: same repo path claimed by a different namespace throws', async () => {
    const infra = new InMemoryVaultInfra();
    await infra.ensureGitBackingStore('acme/v1', 'git', { gitOrg: 'myorg', repoName: 'my-vault' });

    await expect(
      infra.ensureGitBackingStore('acme/v2', 'git', { gitOrg: 'myorg', repoName: 'my-vault' }),
    ).rejects.toMatchObject({
      name: 'CollisionError',
      code: 'REPO_PATH_IN_USE',
    });
  });

  it('REPO_PATH_IN_USE: same namespace + same path (retry) is idempotent', async () => {
    const infra = new InMemoryVaultInfra();
    await infra.ensureGitBackingStore('acme/v1', 'git', { gitOrg: 'myorg', repoName: 'my-vault' });
    // Retry with same namespace + same path should not throw.
    await expect(
      infra.ensureGitBackingStore('acme/v1', 'git', { gitOrg: 'myorg', repoName: 'my-vault' }),
    ).resolves.not.toThrow();
  });

  it('COLLECTION_IN_USE: same slug claimed by a different namespace throws', async () => {
    const infra = new InMemoryVaultInfra();
    await infra.ensureTypesenseCollection('acme/notes');

    // 'org/notes' slugs to 'org_notes' — different from 'acme_notes', so no collision.
    await expect(infra.ensureTypesenseCollection('org/notes')).resolves.not.toThrow();

    // Force a collision: two namespaces that slug to the same string.
    // 'a-b' and 'a.b' both slug to 'a_b'.
    const infra2 = new InMemoryVaultInfra();
    await infra2.ensureTypesenseCollection('a-b');
    await expect(infra2.ensureTypesenseCollection('a.b')).rejects.toMatchObject({
      name: 'CollisionError',
      code: 'COLLECTION_IN_USE',
    });
  });

  it('isNamespaceRegistered returns true after registering, false before', async () => {
    const infra = new InMemoryVaultInfra();
    expect(await infra.isNamespaceRegistered('acme/v1')).toBe(false);

    await infra.ensureGitBackingStore('acme/v1', 'git', { gitOrg: 'myorg', repoName: 'r1' });
    await infra.ensureRegistryEntry('acme/v1', 'http://endpoint');
    expect(await infra.isNamespaceRegistered('acme/v1')).toBe(true);

    await infra.removeRegistryEntry('acme/v1');
    expect(await infra.isNamespaceRegistered('acme/v1')).toBe(false);
  });

  it('ensureRegistryEntry is idempotent (re-register same namespace)', async () => {
    const infra = new InMemoryVaultInfra();
    await infra.ensureGitBackingStore('acme/v1', 'git', { gitOrg: 'myorg', repoName: 'r1' });
    await infra.ensureRegistryEntry('acme/v1', 'http://endpoint');
    // Re-registering same namespace does not throw (idempotent within same infra instance).
    await expect(
      infra.ensureRegistryEntry('acme/v1', 'http://endpoint'),
    ).resolves.not.toThrow();
  });

  it('InMemoryCollisionError has the expected shape', () => {
    const err = new InMemoryCollisionError(
      'REPO_PATH_IN_USE',
      'test message',
      { repo_path: 'org/name', conflicting_namespace: 'ns1' },
    );
    expect(err.name).toBe('CollisionError');
    expect(err.code).toBe('REPO_PATH_IN_USE');
    expect(err.details).toEqual({ repo_path: 'org/name', conflicting_namespace: 'ns1' });
  });
});
