import { describe, it, expect } from 'vitest';
import { createJwtVerifier, createLocalJwkSet } from '@horus/auth';
import { Store } from '../src/store.js';
import { KeyManager } from '../src/keys.js';
import { RequestService, ensureBootstrapAdmin } from '../src/service.js';
import { InMemoryVaultInfra } from '../src/infra.js';
import { onboardHandler, vaultCreateHandler } from '../src/handlers.js';
import { createClientTokenMinter } from '../src/tokens.js';
import { buildApp } from '../src/app.js';
import type { HandlerMap } from '../src/provisioner.js';

async function setup() {
  const store = new Store(':memory:');
  const keys = new KeyManager(store);
  await keys.firstBootEnsure();
  ensureBootstrapAdmin(store, 'admin', 'acme');
  const infra = new InMemoryVaultInfra();
  const handlers: HandlerMap = {
    onboard: onboardHandler(store),
    vault_create: vaultCreateHandler(infra),
  };
  const service = new RequestService(store, handlers);
  const app = buildApp({ service, keys, store, mintClientToken: createClientTokenMinter(keys) });
  return { store, keys, app };
}

describe('operator-service HTTP API', () => {
  it('onboards a user then mints a client token the client-facing JWKS verifies', async () => {
    const { keys, app } = await setup();

    const onboard = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: { 'x-operator-role': 'admin', 'x-operator-user': 'admin' },
      payload: { kind: 'onboard', tenant: 'acme', payload: { userId: 'alice', role: 'user' } },
    });
    expect(onboard.statusCode).toBe(201);
    expect(onboard.json().status).toBe('provisioned');

    const minted = await app.inject({ method: 'POST', url: '/tokens', payload: { userId: 'alice' } });
    expect(minted.statusCode).toBe(200);
    const { token, expiresIn } = minted.json();
    expect(expiresIn).toBe(86400);

    const verifier = createJwtVerifier({
      jwks: createLocalJwkSet(keys.clientJwks()),
      expectedTenant: 'acme',
    });
    expect(await verifier.verify(`Bearer ${token}`)).toEqual({
      tenant: 'acme',
      user: 'alice',
      role: 'user',
    });
    await app.close();
  });

  it('forced bootstrap-admin rotation clears mustRotate', async () => {
    const { store, app } = await setup();
    expect(store.getUser('admin')?.mustRotate).toBe(true);
    const res = await app.inject({ method: 'POST', url: '/admin/rotate', payload: { adminId: 'admin' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().mustRotate).toBe(false);
    expect(store.getUser('admin')?.mustRotate).toBe(false);
    await app.close();
  });

  it('rejects an unknown kind with 400', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/requests',
      payload: { kind: 'nonsense', tenant: 'acme' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('exports the principal bundle for admin (private + public keys) and 403s non-admin', async () => {
    const { keys, app } = await setup();

    const ok = await app.inject({
      method: 'GET',
      url: '/admin/principal-bundle',
      headers: { 'x-operator-role': 'admin', 'x-operator-user': 'admin' },
    });
    expect(ok.statusCode).toBe(200);
    const bundle = ok.json();
    expect(bundle.clientJwks).toEqual(keys.clientJwks());
    expect(bundle.internalSigningKey.kid).toBe(keys.internalSigningKey().kid);
    // The signing key must carry the EC private scalar 'd'; the published pub jwk must not.
    expect(bundle.internalSigningKey.privateJwk).toHaveProperty('d');
    expect(bundle.internalPublicJwk).not.toHaveProperty('d');
    expect(bundle.internalPublicJwk.kty).toBe('EC');

    const denied = await app.inject({
      method: 'GET',
      url: '/admin/principal-bundle',
      headers: { 'x-operator-role': 'user', 'x-operator-user': 'mallory' },
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });
});
