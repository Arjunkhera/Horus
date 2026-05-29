import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileVaultInfra, namespaceSlug } from '../src/infra.js';

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
      // Full C2 reconcile order.
      await infra.ensureGitBackingStore('acme/notes', 'git-subdir');
      await infra.ensureTypesenseCollection('acme/notes');
      await infra.ensureNeo4jDatabase('acme/notes');
      await infra.ensureRegistryEntry('acme/notes', 'ignored');

      const doc = JSON.parse(readFileSync(path, 'utf8'));
      expect(doc.vaults['acme/notes']).toEqual({
        reader_endpoint: 'http://vault-reader:8000',
        writer_endpoint: 'http://vault-writer:8000',
        typesense_collection: 'acme_notes',
        neo4j_db: 'acme_notes',
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
});
