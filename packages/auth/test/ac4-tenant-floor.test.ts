/**
 * AC-4 — The tenant-isolation check CANNOT be disabled by a Verifier plugin.
 * An adversarial plugin returning a wrong-tenant Principal is still rejected,
 * because the floor is structural (the only exported verifier path runs it).
 *
 * RED until @horus/auth is implemented.
 */
import { describe, it, expect } from 'vitest';
import * as authModule from '../src/index';
import {
  hardenedVerifier,
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtProvider,
  createJwtVerifier,
  type CredentialVerifier,
  type Principal,
} from '../src/index';

describe('AC-4 non-pluggable tenant-isolation floor', () => {
  it('rejects a wrong-tenant Principal even from an adversarial plugin', async () => {
    const evil: CredentialVerifier = {
      // Lies: claims a different tenant than the one the service expects.
      verify: async (): Promise<Principal> => ({ tenant: 'attacker', user: 'mallory', role: 'admin' }),
    };
    const hardened = hardenedVerifier(evil, 'tenant-A');
    await expect(hardened.verify('Bearer anything')).rejects.toBeTruthy();
  });

  it('permits a matching-tenant Principal from a benign plugin', async () => {
    const benign: CredentialVerifier = {
      verify: async (): Promise<Principal> => ({ tenant: 'tenant-A', user: 'bob', role: 'admin' }),
    };
    const hardened = hardenedVerifier(benign, 'tenant-A');
    expect(await hardened.verify('Bearer anything')).toEqual({
      tenant: 'tenant-A', user: 'bob', role: 'admin',
    });
  });

  it('the reference JWT verifier itself enforces the expected tenant', async () => {
    const a = await createJwtKeyPair({ alg: 'RS256' });
    const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);

    // Token minted for tenant t2, but the verifier is bound to t1.
    const crossTenantHeader = await createJwtProvider({
      privateKey: a.privateKey, kid: a.kid, alg: 'RS256',
      tenant: 't2', user: 'u1', role: 'admin', ttlSeconds: 300,
    }).authorizationHeader();

    const verifier = createJwtVerifier({ jwks, expectedTenant: 't1' });
    await expect(verifier.verify(crossTenantHeader)).rejects.toBeTruthy();
  });

  it('exposes no unfloored verify escape hatch on the public surface', () => {
    const exported = Object.keys(authModule);
    for (const banned of ['unsafeVerify', 'rawVerify', 'verifyWithoutTenant', 'bypassTenant']) {
      expect(exported).not.toContain(banned);
    }
  });
});
