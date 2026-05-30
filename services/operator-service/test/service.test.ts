import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.js';
import { InMemoryVaultInfra } from '../src/infra.js';
import { RequestService, ensureBootstrapAdmin } from '../src/service.js';
import {
  onboardHandler,
  vaultCreateHandler,
  vaultAttachHandler,
  vaultDeleteHandler,
} from '../src/handlers.js';
import type { HandlerMap } from '../src/provisioner.js';

function setup() {
  const store = new Store(':memory:');
  const infra = new InMemoryVaultInfra();
  const handlers: HandlerMap = {
    onboard: onboardHandler(store),
    vault_create: vaultCreateHandler(infra),
    vault_attach: vaultAttachHandler(infra),
    vault_delete: vaultDeleteHandler(infra),
    teardown: vaultDeleteHandler(infra),
  };
  return { store, infra, service: new RequestService(store, handlers) };
}

describe('RequestService', () => {
  it('admin-originated vault_create auto-approves and reconciles all four logical resources', async () => {
    const { service, infra } = setup();
    const req = await service.create({
      kind: 'vault_create',
      payload: { namespace: 'acme/notes', target_router: 'vault-router', backing_store_adapter: 'git-subdir' },
      requester: 'admin',
      tenant: 'acme',
      requesterRole: 'admin',
    });
    expect(req.status).toBe('provisioned');
    expect(infra.git.has('acme/notes')).toBe(true);
    expect(infra.collections.has('acme/notes')).toBe(true);
    expect(infra.databases.has('acme/notes')).toBe(true);
    expect(infra.registry.get('acme/notes')).toBe('vault-router/vaults/acme/notes');
  });

  it('non-admin requests stay pending until approved', async () => {
    const { service, infra } = setup();
    const req = await service.create({
      kind: 'vault_create',
      payload: { namespace: 'acme/x' },
      requester: 'alice',
      tenant: 'acme',
      requesterRole: 'user',
    });
    expect(req.status).toBe('pending');
    expect(infra.registry.has('acme/x')).toBe(false);

    const approved = await service.approve(req.id, 'admin');
    expect(approved.status).toBe('provisioned');
    expect(approved.decidedBy).toBe('admin');
  });

  it('onboard creates the user record', async () => {
    const { service, store } = setup();
    await service.create({
      kind: 'onboard',
      payload: { userId: 'bob', assignedVaults: ['acme/notes'], role: 'user' },
      requester: 'admin',
      tenant: 'acme',
      requesterRole: 'admin',
    });
    const user = store.getUser('bob');
    expect(user?.assignedVaults).toEqual(['acme/notes']);
    expect(user?.tenant).toBe('acme');
  });

  it('reject moves the request to rejected without provisioning', async () => {
    const { service, infra } = setup();
    const req = await service.create({
      kind: 'vault_create',
      payload: { namespace: 'acme/y' },
      requester: 'alice',
      tenant: 'acme',
      requesterRole: 'user',
    });
    const rejected = service.reject(req.id, 'admin');
    expect(rejected.status).toBe('rejected');
    expect(infra.registry.has('acme/y')).toBe(false);
  });
});

describe('ensureBootstrapAdmin', () => {
  it('creates a forced-rotation admin once (idempotent)', () => {
    const store = new Store(':memory:');
    expect(ensureBootstrapAdmin(store, 'admin', 'acme')).toBe(true);
    const admin = store.getUser('admin');
    expect(admin?.role).toBe('admin');
    expect(admin?.mustRotate).toBe(true);
    expect(ensureBootstrapAdmin(store, 'admin', 'acme')).toBe(false); // idempotent
    store.close();
  });
});
