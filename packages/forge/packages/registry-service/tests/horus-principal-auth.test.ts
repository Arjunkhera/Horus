/**
 * Tests for HorusPrincipalAuthStrategy (story b5f8f9c9).
 *
 * Forge verifies the gateway-minted `X-Horus-Principal` JWT against the shared
 * internal-signing public JWK, derives identity {tenant, user, role} + extension
 * claims from the payload, and maps the Horus role onto a Forge role
 * (consumer / publisher / registry-admin). This mirrors the Vault principal
 * middleware (services/vault/src/security/principal.py) so both services verify
 * the same token the same way.
 *
 * Keys are generated per-suite via jose so no external material is needed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey, type KeyObject } from 'jose';
import { HorusPrincipalAuthStrategy } from '../src/auth/horus-principal.js';
import type { HorusPrincipalAuthConfig } from '../src/config.js';
import type { ServiceUser } from '../src/types.js';

type KeyLike = CryptoKey | KeyObject;

const PRINCIPAL_HEADER = 'x-horus-principal';

function makeRequest(headers: Record<string, string>): {
  headers: Record<string, string | undefined>;
} {
  const lowercased: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowercased[k.toLowerCase()] = v;
  return { headers: lowercased };
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

let privateKey: KeyLike;
let publicJwk: Record<string, unknown>;
let otherPrivateKey: KeyLike;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = (await exportJWK(pair.publicKey)) as Record<string, unknown>;

  const other = await generateKeyPair('RS256', { extractable: true });
  otherPrivateKey = other.privateKey;
});

interface SignOpts {
  expSec?: number;
  alg?: string;
  key?: KeyLike;
  omitExp?: boolean;
}

async function signPrincipal(
  claims: Record<string, unknown>,
  opts: SignOpts = {},
): Promise<string> {
  const { expSec = 60, alg = 'RS256', key = privateKey, omitExp = false } = opts;
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT(claims).setProtectedHeader({ alg }).setIssuedAt(now);
  if (!omitExp) jwt = jwt.setExpirationTime(now + expSec);
  return jwt.sign(key);
}

function makeStrategy(
  overrides: Partial<HorusPrincipalAuthConfig> = {},
): HorusPrincipalAuthStrategy {
  const cfg: HorusPrincipalAuthConfig = {
    strategy: 'horus-principal',
    publicJwk,
    header: PRINCIPAL_HEADER,
    leewaySeconds: 30,
    ...overrides,
  };
  return new HorusPrincipalAuthStrategy(cfg);
}

const RESOURCE = { type: 'skill', id: 'x', version: '1.0.0' };

// ---------------------------------------------------------------------------
// identify()
// ---------------------------------------------------------------------------

describe('HorusPrincipalAuthStrategy — identify()', () => {
  it('derives identity {tenant, user, role} from verified claims', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal({ tenant: 't1', user: 'alice', role: 'publisher' });
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never);
    expect(user).not.toBeNull();
    const u = user as ServiceUser;
    expect(u.userId).toBe('alice');
    expect(u.name).toBe('alice');
    expect(u.tenant).toBe('t1');
    expect(u.role).toBe('publisher');
  });

  it('captures the roles[] array and extension claims', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal({
      tenant: 't1',
      user: 'alice',
      role: 'registry-admin',
      roles: ['registry-admin', 'publisher'],
      projectId: 'p-42',
    });
    const u = (await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never)) as ServiceUser;
    expect(u.roles).toEqual(['registry-admin', 'publisher']);
    expect(u.claims?.['projectId']).toBe('p-42');
    // standard claims must not leak into the extension bag
    expect(u.claims?.['tenant']).toBeUndefined();
    expect(u.claims?.['exp']).toBeUndefined();
  });

  it('returns null when the header is absent', async () => {
    const strat = makeStrategy();
    const user = await strat.identify(makeRequest({}) as never);
    expect(user).toBeNull();
  });

  it('returns null when the signature is invalid (tampered)', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal({ tenant: 't1', user: 'eve', role: 'publisher' });
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -2) + 'XX';
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': parts.join('.') }) as never);
    expect(user).toBeNull();
  });

  it('returns null when the token is signed by a different key', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal(
      { tenant: 't1', user: 'mallory', role: 'registry-admin' },
      { key: otherPrivateKey },
    );
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never);
    expect(user).toBeNull();
  });

  it('returns null when the token is expired', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal({ tenant: 't1', user: 'eve', role: 'publisher' }, { expSec: -120 });
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never);
    expect(user).toBeNull();
  });

  it('returns null when the token has no exp claim (require exp)', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal({ tenant: 't1', user: 'eve', role: 'publisher' }, { omitExp: true });
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never);
    expect(user).toBeNull();
  });

  it('returns null when required claims are missing (no role)', async () => {
    const strat = makeStrategy();
    const token = await signPrincipal({ tenant: 't1', user: 'eve' });
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never);
    expect(user).toBeNull();
  });

  it('returns null (fail-closed) when no public JWK is configured', async () => {
    const strat = makeStrategy({ publicJwk: undefined });
    const token = await signPrincipal({ tenant: 't1', user: 'alice', role: 'publisher' });
    const user = await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never);
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Horus role → Forge role mapping
// ---------------------------------------------------------------------------

describe('HorusPrincipalAuthStrategy — role mapping', () => {
  const cases: Array<[string, ServiceUser['role']]> = [
    ['registry-admin', 'registry-admin'],
    ['admin', 'registry-admin'],
    ['owner', 'registry-admin'],
    ['publisher', 'publisher'],
    ['maintainer', 'publisher'],
    ['consumer', 'consumer'],
    ['reader', 'consumer'],
    ['member', 'consumer'],
    ['something-unknown', 'consumer'],
  ];

  for (const [horusRole, forgeRole] of cases) {
    it(`maps Horus role '${horusRole}' → Forge role '${forgeRole}'`, async () => {
      const strat = makeStrategy();
      const token = await signPrincipal({ tenant: 't1', user: 'u', role: horusRole });
      const u = (await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never)) as ServiceUser;
      expect(u.role).toBe(forgeRole);
    });
  }

  it('honors an explicit roleMap override', async () => {
    const strat = makeStrategy({ roleMap: { editor: 'publisher' } });
    const token = await signPrincipal({ tenant: 't1', user: 'u', role: 'editor' });
    const u = (await strat.identify(makeRequest({ 'X-Horus-Principal': token }) as never)) as ServiceUser;
    expect(u.role).toBe('publisher');
  });
});

// ---------------------------------------------------------------------------
// authorize()
// ---------------------------------------------------------------------------

describe('HorusPrincipalAuthStrategy — authorize()', () => {
  const strat = makeStrategy();
  const consumer: ServiceUser = { userId: 'c', name: 'c', role: 'consumer' };
  const publisher: ServiceUser = { userId: 'p', name: 'p', role: 'publisher' };
  const admin: ServiceUser = { userId: 'a', name: 'a', role: 'registry-admin' };

  it('permits read for everyone, including unauthenticated (null)', () => {
    expect(strat.authorize(null, 'read', RESOURCE)).toBe('permit');
    expect(strat.authorize(consumer, 'read', RESOURCE)).toBe('permit');
  });

  it('denies publish for consumer and null', () => {
    expect(strat.authorize(consumer, 'publish', RESOURCE)).toBe('deny');
    expect(strat.authorize(null, 'publish', RESOURCE)).toBe('deny');
  });

  it('permits publish for publisher and registry-admin', () => {
    expect(strat.authorize(publisher, 'publish', RESOURCE)).toBe('permit');
    expect(strat.authorize(admin, 'publish', RESOURCE)).toBe('permit');
  });

  it('restricts verify/unverify to registry-admin', () => {
    expect(strat.authorize(admin, 'verify', RESOURCE)).toBe('permit');
    expect(strat.authorize(admin, 'unverify', RESOURCE)).toBe('permit');
    expect(strat.authorize(publisher, 'verify', RESOURCE)).toBe('deny');
    expect(strat.authorize(consumer, 'verify', RESOURCE)).toBe('deny');
  });
});
