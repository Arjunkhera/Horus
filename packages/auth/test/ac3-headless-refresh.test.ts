/**
 * AC-3 — Auto-refresh works headlessly (no interactive login). Deterministic
 * via fake timers; no stdin / prompt is ever read.
 *
 * RED until @horus/auth is implemented.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtProvider,
  createJwtVerifier,
} from '../src/index';

describe('AC-3 headless auto-refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-issues a fresh token near expiry with no interactive step', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const a = await createJwtKeyPair({ alg: 'RS256' });
    const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);
    const verifier = createJwtVerifier({ jwks, expectedTenant: 't1' });

    const provider = createJwtProvider({
      privateKey: a.privateKey, kid: a.kid, alg: 'RS256',
      tenant: 't1', user: 'u1', role: 'admin',
      ttlSeconds: 60, refreshSkewSeconds: 15,
    });

    const h1 = await provider.authorizationHeader();
    // Within TTL and outside the refresh skew → same token.
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
    const h2 = await provider.authorizationHeader();
    expect(h2).toBe(h1);

    // Inside the refresh skew (>=45s, exp at 60s, skew 15s) → refreshed token.
    vi.setSystemTime(new Date('2026-01-01T00:00:50Z'));
    const h3 = await provider.authorizationHeader();
    expect(h3).not.toBe(h1);

    // Both tokens still resolve to the same Principal (headless, no prompt).
    expect(await verifier.verify(h1)).toEqual({ tenant: 't1', user: 'u1', role: 'admin' });
    expect(await verifier.verify(h3)).toEqual({ tenant: 't1', user: 'u1', role: 'admin' });
  });
});
