/**
 * vault-attach.test.ts
 *
 * End-to-end test for vault_attach request lifecycle using InMemoryVaultInfra +
 * Fastify inject. Verifies that the resulting registry entry is COMPLETE (all
 * five fields present) after a vault_attach request is approved and reconciled.
 *
 * Mirrors vault-create.test.ts request lifecycle exactly.
 */

import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.js';
import { KeyManager } from '../src/keys.js';
import { RequestService, ensureBootstrapAdmin } from '../src/service.js';
import { InMemoryVaultInfra } from '../src/infra.js';
import { onboardHandler, vaultCreateHandler, vaultAttachHandler } from '../src/handlers.js';
import { createClientTokenMinter } from '../src/tokens.js';
import { buildApp } from '../src/app.js';
import type { HandlerMap } from '../src/provisioner.js';

// ── Test harness ─────────────────────────────────────────────────────────────

async function setup() {
  const store = new Store(':memory:');
  const keys = new KeyManager(store);
  await keys.firstBootEnsure();
  ensureBootstrapAdmin(store, 'admin', 'acme');
  const infra = new InMemoryVaultInfra();
  const handlers: HandlerMap = {
    vault_create: vaultCreateHandler(infra),
    vault_attach: vaultAttachHandler(infra),
  };
  const service = new RequestService(store, handlers);
  const app = buildApp({ service, keys, store, mintClientToken: createClientTokenMinter(keys) });
  return { store, infra, app };
}

/** Issue a vault_attach request as admin (auto-approved + reconciled). */
async function vaultAttach(
  app: Awaited<ReturnType<typeof setup>>['app'],
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/requests',
    headers: { 'x-operator-role': 'admin', 'x-operator-user': 'admin' },
    payload: { kind: 'vault_attach', tenant: 'acme', payload },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('vault_attach — complete registry entry', () => {
  it('produces a complete registry entry with all five fields including git_repo', async () => {
    const { infra, app } = await setup();

    const res = await vaultAttach(app, { namespace: 'acme/notes' });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('provisioned');

    // Check the in-memory registry has the namespace.
    expect(infra.registry.has('acme/notes')).toBe(true);

    // FIX 2: explicit git_repo assertion — must fail if derivation is broken.
    // InMemoryVaultInfra default githubOwner is 'default-org', namespace slug is
    // 'acme_notes', so git_repo must be 'default-org/vault-acme_notes'.
    const gitRepo = infra.gitRepos.get('acme/notes');
    expect(gitRepo).toBe('default-org/vault-acme_notes');

    // Also verify via the fullEntries map.
    const fullEntry = infra.fullEntries.get('acme/notes');
    expect(fullEntry).toBeDefined();
    expect(fullEntry?.git_repo).toBe('default-org/vault-acme_notes');

    await app.close();
  });

  it('with git_org and repo_name: registry entry has correct git_repo', async () => {
    const { infra, app } = await setup();

    const res = await vaultAttach(app, {
      namespace: 'acme/notes',
      git_org: 'my-company',
      repo_name: 'my-vault',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('provisioned');

    // InMemoryVaultInfra must set git_repo from the opts passed from vaultAttachHandler.
    // The gitRepos map should reflect what was derived.
    const gitRepo = infra.gitRepos.get('acme/notes');
    // With the new implementation, gitRepos is set from opts in ensureRegistryEntry.
    expect(gitRepo).toBe('my-company/my-vault');

    await app.close();
  });
});

describe('vault_attach — complete entry shape via InMemory fullEntries', () => {
  it('all five fields are present in the stored entry', async () => {
    const { infra, app } = await setup();

    const res = await vaultAttach(app, { namespace: 'acme/notes' });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('provisioned');

    // FIX 2: unconditional assertion on fullEntries — must fail if git_repo derivation is broken.
    const entry = infra.fullEntries.get('acme/notes');
    expect(entry).toBeDefined();
    expect(entry?.reader_endpoint).toBeTruthy();
    expect(entry?.writer_endpoint).toBeTruthy();
    expect(entry?.typesense_collection).toBeTruthy();
    expect(entry?.neo4j_db).toBeTruthy();
    // git_repo must be present and equal the expected deterministic value.
    expect(entry?.git_repo).toBe('default-org/vault-acme_notes');

    await app.close();
  });

  it('degraded path: vault_attach with no resolvable owner omits git_repo and does NOT throw', async () => {
    // FIX 1 coverage: InMemoryVaultInfra with empty githubOwner should omit git_repo
    // rather than throw. This matches the K8s adapter's graceful degradation.
    // We use the same setup() helper but override the infra with an empty githubOwner.
    const store = new Store(':memory:');
    const keys = new KeyManager(store);
    await keys.firstBootEnsure();
    ensureBootstrapAdmin(store, 'admin', 'acme');
    // Empty githubOwner → no owner resolvable.
    const infra = new InMemoryVaultInfra({ githubOwner: '' });
    const handlers: HandlerMap = {
      vault_create: vaultCreateHandler(infra),
      vault_attach: vaultAttachHandler(infra),
    };
    const service = new RequestService(store, handlers);
    const app = buildApp({ service, keys, store, mintClientToken: createClientTokenMinter(keys) });

    const res = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: { 'x-operator-role': 'admin', 'x-operator-user': 'admin' },
      payload: { kind: 'vault_attach', tenant: 'acme', payload: { namespace: 'acme/notes' } },
    });

    // Must succeed — graceful degradation, not a throw.
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('provisioned');

    // git_repo must be absent (owner was unresolvable).
    const entry = infra.fullEntries.get('acme/notes');
    expect(entry).toBeDefined();
    expect(entry?.git_repo).toBeUndefined();
    // Other fields must still be present.
    expect(entry?.typesense_collection).toBeTruthy();
    expect(entry?.neo4j_db).toBeTruthy();

    await app.close();
  });
});
