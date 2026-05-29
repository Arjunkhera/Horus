import { describe, it, expect } from 'vitest';
import { Store } from '../src/store.js';
import { KeyManager } from '../src/keys.js';
import { createLocalJwkSet, createJwtVerifier, createPrincipalSigner } from '@horus/auth';
import { importJWK, type CryptoKey } from 'jose';

describe('KeyManager first-boot generation', () => {
  it('generates both keypairs once and is idempotent', async () => {
    const store = new Store(':memory:');
    const km = new KeyManager(store);

    expect((await km.firstBootEnsure()).generated).toBe(true);
    expect((await km.firstBootEnsure()).generated).toBe(false); // reused, not regenerated

    expect(km.clientJwks()).toHaveLength(1);
    expect(km.clientJwks()[0].kid).toBeTruthy();
    const internal = km.internalSigningKey();
    expect(internal.privateJwk).toBeTruthy();
    expect(internal.alg).toBe('ES256');
    store.close();
  });

  it('mints an X-Horus-Principal token with the internal key that the published internal JWKS verifies', async () => {
    const store = new Store(':memory:');
    const km = new KeyManager(store);
    await km.firstBootEnsure();

    const signing = km.internalSigningKey();
    const privateKey = (await importJWK(signing.privateJwk, signing.alg)) as CryptoKey;
    const sign = createPrincipalSigner({ privateKey, kid: signing.kid, alg: signing.alg, ttlSeconds: 60 });
    const token = await sign({ tenant: 'acme', user: 'alice', role: 'admin' });

    const verifier = createJwtVerifier({
      jwks: createLocalJwkSet(km.internalJwks()),
      expectedTenant: 'acme',
    });
    expect(await verifier.verify(`Bearer ${token}`)).toEqual({
      tenant: 'acme',
      user: 'alice',
      role: 'admin',
    });
    store.close();
  });
});
