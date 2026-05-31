/**
 * End-to-end tests for vault_create: payload-driven repo path (P2) and
 * collision detection (P3). Uses InMemoryVaultInfra + Fastify inject so the
 * full HTTP → service → provisioner → infra stack is exercised.
 */

import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.js';
import { KeyManager } from '../src/keys.js';
import { RequestService, ensureBootstrapAdmin } from '../src/service.js';
import { InMemoryVaultInfra } from '../src/infra.js';
import { onboardHandler, vaultCreateHandler } from '../src/handlers.js';
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
  };
  const service = new RequestService(store, handlers);
  const app = buildApp({ service, keys, store, mintClientToken: createClientTokenMinter(keys) });
  return { store, infra, app };
}

/** Issue a vault_create request as admin (auto-approved + reconciled). */
async function vaultCreate(
  app: Awaited<ReturnType<typeof setup>>['app'],
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/requests',
    headers: { 'x-operator-role': 'admin', 'x-operator-user': 'admin' },
    payload: { kind: 'vault_create', tenant: 'acme', payload },
  });
}

// ── P2: payload-driven repo path ─────────────────────────────────────────────

describe('vault_create — default org/repo_name (no opts)', () => {
  it('succeeds and records git_repo as default-org/vault-<slug>', async () => {
    const { infra, app } = await setup();
    const res = await vaultCreate(app, { namespace: 'acme/notes' });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('provisioned');
    expect(infra.gitRepos.get('acme/notes')).toBe('default-org/vault-acme_notes');
    await app.close();
  });
});

describe('vault_create — explicit git_org + repo_name', () => {
  it('creates repo under the specified org and name; registry reflects it', async () => {
    const { infra, app } = await setup();
    const res = await vaultCreate(app, {
      namespace: 'acme/notes',
      git_org: 'my-company',
      repo_name: 'horus-vault',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('provisioned');
    expect(infra.gitRepos.get('acme/notes')).toBe('my-company/horus-vault');
    await app.close();
  });

  it('rejects invalid git_org (non-GitHub-safe chars) with 201 but status=failed', async () => {
    // Validation errors in handlers throw inside the provisioner step, which records
    // them as req.error/failed. The HTTP status is still 201 for the request object itself
    // because it was accepted as a valid request — the step failure is in the reconcile phase.
    const { app } = await setup();
    const res = await vaultCreate(app, {
      namespace: 'acme/notes',
      git_org: 'invalid org!',
    });
    // The validation error thrown from the step causes a failed provision.
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('failed');
    expect(res.json().error).toMatch(/git_org/);
    await app.close();
  });

  it('rejects invalid repo_name (non-GitHub-safe chars)', async () => {
    const { app } = await setup();
    const res = await vaultCreate(app, {
      namespace: 'acme/notes',
      repo_name: 'invalid/name',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('failed');
    expect(res.json().error).toMatch(/repo_name/);
    await app.close();
  });
});

// ── P3: collision detection ───────────────────────────────────────────────────

describe('vault_create — NAMESPACE_EXISTS collision', () => {
  it('returns 409 NAMESPACE_EXISTS when a second request uses the same namespace', async () => {
    const { app } = await setup();

    // First request: succeeds.
    const first = await vaultCreate(app, { namespace: 'acme/v1' });
    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe('provisioned');

    // Second request for the same namespace → 409.
    const second = await vaultCreate(app, { namespace: 'acme/v1' });
    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body.error.code).toBe('NAMESPACE_EXISTS');
    expect(body.error.message).toMatch(/acme\/v1/);
    await app.close();
  });
});

describe('vault_create — REPO_PATH_IN_USE collision', () => {
  it('returns 409 REPO_PATH_IN_USE when another namespace already owns the repo path', async () => {
    const { app } = await setup();

    // First request for namespace1 claims myorg/shared-vault.
    const first = await vaultCreate(app, {
      namespace: 'acme/v1',
      git_org: 'myorg',
      repo_name: 'shared-vault',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe('provisioned');

    // Second request for namespace2 tries to claim the same repo path → 409.
    const second = await vaultCreate(app, {
      namespace: 'acme/v2',
      git_org: 'myorg',
      repo_name: 'shared-vault',
    });
    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body.error.code).toBe('REPO_PATH_IN_USE');
    expect(body.error.message).toMatch(/myorg\/shared-vault/);
    expect(body.error.details.conflicting_namespace).toBe('acme/v1');
    await app.close();
  });
});

describe('vault_create — COLLECTION_IN_USE collision', () => {
  it('returns 409 COLLECTION_IN_USE when two namespaces slug to the same collection name', async () => {
    const { app } = await setup();

    // 'a-b' and 'a.b' both slug to 'a_b' → collection collision.
    // We provide distinct repo_names so the REPO_PATH_IN_USE check doesn't fire first.
    const first = await vaultCreate(app, {
      namespace: 'a-b',
      git_org: 'myorg',
      repo_name: 'vault-ab-1',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe('provisioned');

    const second = await vaultCreate(app, {
      namespace: 'a.b',
      git_org: 'myorg',
      repo_name: 'vault-ab-2',
    });
    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body.error.code).toBe('COLLECTION_IN_USE');
    expect(body.error.message).toMatch(/a_b/);
    await app.close();
  });
});

describe('vault_create — retry idempotency', () => {
  it('a POST /requests/:id/retry of a partially-failed request does not false-collision', async () => {
    const { store, infra, app } = await setup();

    // Create a vault_create request manually in a partially-failed state.
    // All steps through ensure_neo4j_database completed; ensure_registry_entry failed.
    const now = new Date().toISOString();
    const req = {
      id: 'req-retry-1',
      kind: 'vault_create' as const,
      payload: { namespace: 'retry/ns', git_org: 'myorg', repo_name: 'retry-vault' },
      requester: 'admin',
      tenant: 'acme',
      status: 'failed' as const,
      decision: 'approved' as const,
      decidedBy: 'admin',
      error: 'simulated failure',
      // Simulate: collision check done, git done, typesense done, neo4j done, registry NOT done.
      steps: {
        check_namespace_collision: true,
        ensure_git_backing_store: true,
        ensure_typesense_collection: true,
        ensure_neo4j_database: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    store.insertRequest(req);

    // Prime infra state as if previous steps already ran for this namespace.
    // We set maps directly since those steps are marked done and won't re-run.
    infra.gitRepos.set('retry/ns', 'myorg/retry-vault');
    infra.collections.add('retry/ns');

    // Retry should only run ensure_registry_entry (the only incomplete step).
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${req.id}/retry`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('provisioned');
    expect(res.json().error).toBeNull();
    await app.close();
  });
});

describe('vault_create — error body shape', () => {
  it('collision error body matches { error: { code, message, details } }', async () => {
    const { app } = await setup();

    const first = await vaultCreate(app, { namespace: 'acme/v1' });
    expect(first.statusCode).toBe(201); // sanity
    const res = await vaultCreate(app, { namespace: 'acme/v1' });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(body.error).toHaveProperty('details');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
    await app.close();
  });
});
