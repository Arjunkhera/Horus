/**
 * Tests for TrustedHeadersAuthStrategy.
 *
 * JWT tests use a generated RSA key pair so no external key material is needed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, importPKCS8 } from 'jose';
import { TrustedHeadersAuthStrategy } from '../src/auth/trusted-headers.js';
import type { TrustedHeadersAuthConfig } from '../src/config.js';
import type { ServiceUser } from '../src/types.js';

const generateKeyPairAsync = promisify(generateKeyPair);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TrustedHeadersAuthConfig = {
  strategy: 'trusted-headers',
  headers: {
    user_id: 'X-User-Id',
    role: 'X-Role',
  },
};

function makeRequest(headers: Record<string, string>): {
  headers: Record<string, string | undefined>;
} {
  // Fastify lowercases header names, so we do the same here
  const lowercased: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowercased[k.toLowerCase()] = v;
  }
  return { headers: lowercased };
}

// ---------------------------------------------------------------------------
// Key material (generated once per suite)
// ---------------------------------------------------------------------------

let publicKeyPem: string;
let privateKeyPem: string;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPairAsync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  } as Parameters<typeof generateKeyPair>[1]);
  publicKeyPem = publicKey as unknown as string;
  privateKeyPem = privateKey as unknown as string;
});

async function signJwt(payload: Record<string, unknown>, expMin = 5): Promise<string> {
  const pk = await importPKCS8(privateKeyPem, 'RS256');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime(`${expMin}m`)
    .sign(pk);
}

// ---------------------------------------------------------------------------
// Suite: no JWT
// ---------------------------------------------------------------------------

describe('TrustedHeadersAuthStrategy — no JWT', () => {
  const strat = new TrustedHeadersAuthStrategy(DEFAULT_CONFIG);

  it('identify() returns ServiceUser for valid headers (admin)', async () => {
    const req = makeRequest({ 'X-User-Id': 'alice', 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).not.toBeNull();
    expect((user as ServiceUser).userId).toBe('alice');
    expect((user as ServiceUser).role).toBe('admin');
  });

  it('identify() returns ServiceUser for valid headers (non-admin → anonymous)', async () => {
    const req = makeRequest({ 'X-User-Id': 'bob', 'X-Role': 'viewer' });
    const user = await strat.identify(req as never);
    expect(user).not.toBeNull();
    expect((user as ServiceUser).userId).toBe('bob');
    expect((user as ServiceUser).role).toBe('anonymous');
  });

  it('identify() returns null when user_id header is missing', async () => {
    const req = makeRequest({ 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });

  it('identify() returns anonymous role when role header is missing', async () => {
    const req = makeRequest({ 'X-User-Id': 'carol' });
    const user = await strat.identify(req as never);
    expect(user).not.toBeNull();
    expect((user as ServiceUser).role).toBe('anonymous');
  });

  it('identify() returns null when all headers are missing', async () => {
    const req = makeRequest({});
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });

  it('identify() trims whitespace from header values', async () => {
    const req = makeRequest({ 'X-User-Id': '  dave  ', 'X-Role': '  admin  ' });
    const user = await strat.identify(req as never);
    expect(user).not.toBeNull();
    expect((user as ServiceUser).userId).toBe('dave');
    expect((user as ServiceUser).role).toBe('admin');
  });

  // ── authorize ────────────────────────────────────────────────────────────

  it('authorize() permits read for anonymous (null user)', () => {
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    expect(strat.authorize(null, 'read', resource)).toBe('permit');
  });

  it('authorize() permits read for admin', () => {
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    const admin: ServiceUser = { userId: 'alice', name: 'Alice', role: 'admin' };
    expect(strat.authorize(admin, 'read', resource)).toBe('permit');
  });

  it('authorize() denies publish for anonymous (null user)', () => {
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    expect(strat.authorize(null, 'publish', resource)).toBe('deny');
  });

  it('authorize() permits publish for admin', () => {
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    const admin: ServiceUser = { userId: 'alice', name: 'Alice', role: 'admin' };
    expect(strat.authorize(admin, 'publish', resource)).toBe('permit');
  });

  it('authorize() denies publish for anonymous role user', () => {
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    const anonUser: ServiceUser = { userId: 'bob', name: 'bob', role: 'anonymous' };
    expect(strat.authorize(anonUser, 'publish', resource)).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// Suite: JWT enabled
// ---------------------------------------------------------------------------

describe('TrustedHeadersAuthStrategy — JWT enabled', () => {
  let strat: TrustedHeadersAuthStrategy;

  beforeAll(() => {
    // publicKeyPem is set in the top-level beforeAll — available here after
    // beforeAll ordering (outer runs before inner).
    const cfg: TrustedHeadersAuthConfig = {
      strategy: 'trusted-headers',
      headers: {
        user_id: 'X-User-Id',
        role: 'X-Role',
      },
      jwt: {
        enabled: true,
        publicKey: publicKeyPem,
        // JWT is carried in the default user_id header (signed claim)
        header: 'X-User-Id',
      },
    };
    strat = new TrustedHeadersAuthStrategy(cfg);
  });

  it('identify() returns user when JWT is valid and identity headers present', async () => {
    const token = await signJwt({ sub: 'alice' });
    const req = makeRequest({ 'X-User-Id': token, 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).not.toBeNull();
    // userId is the raw header value (the JWT token string in this config)
    expect((user as ServiceUser).role).toBe('admin');
  });

  it('identify() returns null when JWT header is absent', async () => {
    const req = makeRequest({ 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });

  it('identify() returns null when JWT signature is invalid', async () => {
    // Tamper with a valid token (flip a char in the signature segment)
    const token = await signJwt({ sub: 'eve' });
    const parts = token.split('.');
    // Corrupt signature segment
    parts[2] = parts[2].slice(0, -2) + 'XX';
    const badToken = parts.join('.');

    const req = makeRequest({ 'X-User-Id': badToken, 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });

  it('identify() returns null when JWT is expired', async () => {
    const token = await signJwt({ sub: 'eve' }, -1); // expired 1 minute ago
    const req = makeRequest({ 'X-User-Id': token, 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });

  it('identify() returns null when JWT is a plain string (not a JWT)', async () => {
    const req = makeRequest({ 'X-User-Id': 'not-a-jwt', 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite: JWT enabled but public key is invalid / missing
// ---------------------------------------------------------------------------

describe('TrustedHeadersAuthStrategy — JWT enabled, bad key', () => {
  it('identify() returns null (fail-closed) when publicKey is a garbage string', async () => {
    const cfg: TrustedHeadersAuthConfig = {
      strategy: 'trusted-headers',
      headers: { user_id: 'X-User-Id', role: 'X-Role' },
      jwt: { enabled: true, publicKey: 'not-a-real-pem', header: 'X-User-Id' },
    };
    const strat = new TrustedHeadersAuthStrategy(cfg);
    const token = await signJwt({ sub: 'alice' });
    const req = makeRequest({ 'X-User-Id': token, 'X-Role': 'admin' });
    const user = await strat.identify(req as never);
    expect(user).toBeNull();
  });
});
