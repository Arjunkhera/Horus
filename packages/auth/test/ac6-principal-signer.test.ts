import { describe, it, expect } from 'vitest';
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtVerifier,
  createPrincipalSigner,
  type Principal,
} from '../src/index.js';

describe('createPrincipalSigner', () => {
  it('mints a per-principal JWT that the matching verifier accepts', async () => {
    const kp = await createJwtKeyPair({ alg: 'ES256' });
    const sign = createPrincipalSigner({
      privateKey: kp.privateKey,
      kid: kp.kid,
      alg: 'ES256',
      ttlSeconds: 60,
    });
    const verifier = createJwtVerifier({
      jwks: createLocalJwkSet([{ kid: kp.kid, publicJwk: kp.publicJwk }]),
      expectedTenant: 'acme',
    });

    const principal: Principal = { tenant: 'acme', user: 'alice', role: 'admin' };
    const token = await sign(principal);

    expect(token.split('.')).toHaveLength(3); // compact JWS, no Bearer prefix
    const out = await verifier.verify(`Bearer ${token}`);
    expect(out).toEqual(principal);
  });

  it('sets a ~ttlSeconds expiry', async () => {
    const kp = await createJwtKeyPair({ alg: 'ES256' });
    const sign = createPrincipalSigner({
      privateKey: kp.privateKey,
      kid: kp.kid,
      alg: 'ES256',
      ttlSeconds: 60,
    });
    const token = await sign({ tenant: 't', user: 'u', role: 'r' });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(60);
  });
});
