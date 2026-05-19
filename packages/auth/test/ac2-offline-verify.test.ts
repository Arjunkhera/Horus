/**
 * AC-2 — A service can verify a token OFFLINE (no network callback) and obtain
 * a Principal. The test fails if any network fetch is attempted during verify.
 *
 * RED until @horus/auth is implemented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtProvider,
  createJwtVerifier,
} from '../src/index';

describe('AC-2 offline verification (no JWKS network callback)', () => {
  const realFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => {
      throw new Error('network fetch attempted during offline verify');
    });
    // Any attempt to reach the network during verify must blow up the test.
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('verifies against a local JWK set without touching the network', async () => {
    const a = await createJwtKeyPair({ alg: 'RS256' });
    const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);

    const header = await createJwtProvider({
      privateKey: a.privateKey, kid: a.kid, alg: 'RS256',
      tenant: 'acme', user: 'alice', role: 'admin', ttlSeconds: 300,
    }).authorizationHeader();

    const verifier = createJwtVerifier({ jwks, expectedTenant: 'acme' });
    const principal = await verifier.verify(header);

    expect(principal).toEqual({ tenant: 'acme', user: 'alice', role: 'admin' });
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
