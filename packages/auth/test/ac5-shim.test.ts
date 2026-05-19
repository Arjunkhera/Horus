/**
 * AC-5 — Unit/integration tests present + a documented TS integration shim for
 * a consuming service (Fastify -> registry-service ServiceUser mapping).
 *
 * RED until @horus/auth (and its shim + README) are implemented.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  principalToServiceUser,
  makeAuthPreHandler,
} from '../src/shim/fastify-registry';
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtProvider,
  createJwtVerifier,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));

describe('AC-5 documented Fastify -> registry-service shim', () => {
  it('maps a Principal to a registry-service ServiceUser (admin preserved)', () => {
    expect(principalToServiceUser({ tenant: 't1', user: 'u1', role: 'admin' })).toEqual({
      userId: 'u1', name: 'u1', role: 'admin',
    });
  });

  it('collapses non-admin roles to anonymous (registry ServiceRole)', () => {
    expect(principalToServiceUser({ tenant: 't1', user: 'u9', role: 'viewer' })).toEqual({
      userId: 'u9', name: 'u9', role: 'anonymous',
    });
  });

  it('preHandler attaches serviceUser for a valid token and is safe on a bad one', async () => {
    const a = await createJwtKeyPair({ alg: 'RS256' });
    const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);
    const verifier = createJwtVerifier({ jwks, expectedTenant: 'acme' });
    const header = await createJwtProvider({
      privateKey: a.privateKey, kid: a.kid, alg: 'RS256',
      tenant: 'acme', user: 'alice', role: 'admin', ttlSeconds: 300,
    }).authorizationHeader();

    const preHandler = makeAuthPreHandler(verifier);

    const okReq: { headers: Record<string, string>; serviceUser?: unknown } = {
      headers: { authorization: header },
    };
    await preHandler(okReq as never, {} as never);
    expect(okReq.serviceUser).toEqual({ userId: 'alice', name: 'alice', role: 'admin' });

    const badReq: { headers: Record<string, string>; serviceUser?: unknown } = {
      headers: { authorization: 'Bearer not-a-real-token' },
    };
    await preHandler(badReq as never, {} as never); // must not throw
    expect(badReq.serviceUser).toBeUndefined();
  });

  it('ships a README that documents the integration shim', () => {
    const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
    expect(readme).toMatch(/integration shim/i);
    expect(readme).toMatch(/ServiceUser/);
  });
});
