/**
 * AC-1 — Library exposes a Principal type, CredentialProvider + CredentialVerifier
 * interfaces, and a working JWT reference pair (RS256/ES256) with JWKS kid-rotation.
 *
 * RED until @horus/auth is implemented (src/ does not yet exist).
 */
import { describe, it, expect } from 'vitest';
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtProvider,
  createJwtVerifier,
  type Principal,
  type CredentialProvider,
  type CredentialVerifier,
} from '../src/index';

describe('AC-1 surface + JWKS kid rotation', () => {
  it('exposes a working JWT reference pair that round-trips a Principal', async () => {
    const a = await createJwtKeyPair({ alg: 'RS256' });
    const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);

    const provider: CredentialProvider = createJwtProvider({
      privateKey: a.privateKey,
      kid: a.kid,
      alg: 'RS256',
      tenant: 't1',
      user: 'u1',
      role: 'admin',
      ttlSeconds: 300,
    });
    const verifier: CredentialVerifier = createJwtVerifier({ jwks, expectedTenant: 't1' });

    const header = await provider.authorizationHeader();
    expect(header).toMatch(/^Bearer .+/);

    const principal: Principal = await verifier.verify(header);
    expect(principal).toEqual({ tenant: 't1', user: 'u1', role: 'admin' });
  });

  it('supports kid rotation: old + new keys both verify, unknown kid rejected', async () => {
    const a = await createJwtKeyPair({ alg: 'RS256' });
    const b = await createJwtKeyPair({ alg: 'ES256' });

    const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);
    const verifier = createJwtVerifier({ jwks, expectedTenant: 't1' });

    const oldHeader = await createJwtProvider({
      privateKey: a.privateKey, kid: a.kid, alg: 'RS256',
      tenant: 't1', user: 'u1', role: 'admin', ttlSeconds: 300,
    }).authorizationHeader();

    // Rotate: add the new key to the live set (old key retained).
    jwks.addKey({ kid: b.kid, publicJwk: b.publicJwk });

    const newHeader = await createJwtProvider({
      privateKey: b.privateKey, kid: b.kid, alg: 'ES256',
      tenant: 't1', user: 'u2', role: 'admin', ttlSeconds: 300,
    }).authorizationHeader();

    expect((await verifier.verify(oldHeader)).user).toBe('u1');
    expect((await verifier.verify(newHeader)).user).toBe('u2');

    // A token signed by a key whose kid is not in the set must be rejected.
    const c = await createJwtKeyPair({ alg: 'RS256' });
    const orphanHeader = await createJwtProvider({
      privateKey: c.privateKey, kid: c.kid, alg: 'RS256',
      tenant: 't1', user: 'evil', role: 'admin', ttlSeconds: 300,
    }).authorizationHeader();
    await expect(verifier.verify(orphanHeader)).rejects.toBeTruthy();
  });
});
