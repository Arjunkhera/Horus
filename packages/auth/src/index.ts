/**
 * @horus/auth — transport-agnostic JWT credential library.
 *
 * Asymmetric keys only (RS256 / ES256). No network calls during verify.
 * Tenant isolation is structural: the only exported verifier path enforces it.
 */

import {
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
  jwtVerify,
  type JWTVerifyGetKey,
  type CryptoKey,
  type KeyObject,
} from 'jose';
import { randomUUID } from 'node:crypto';

/** jose v6 removed the KeyLike union — inline it. */
type KeyLike = CryptoKey | KeyObject;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Principal = {
  tenant: string;
  user: string;
  role: string;
};

export interface CredentialProvider {
  authorizationHeader(): Promise<string>;
}

export interface CredentialVerifier {
  verify(header: string): Promise<Principal>;
}

// ---------------------------------------------------------------------------
// Key-pair generation
// ---------------------------------------------------------------------------

export type SupportedAlg = 'RS256' | 'ES256';

export interface JwtKeyPair {
  kid: string;
  privateKey: KeyLike;
  publicJwk: Record<string, unknown>;
}

export async function createJwtKeyPair({ alg }: { alg: SupportedAlg }): Promise<JwtKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  // exportJWK returns jose's JWK type; cast to our broader index-signature type.
  const publicJwk = await exportJWK(publicKey) as Record<string, unknown>;
  const kid = randomUUID();
  return { kid, privateKey, publicJwk };
}

// ---------------------------------------------------------------------------
// Local JWKS (in-memory, no network)
// ---------------------------------------------------------------------------

export interface LocalJwkSet {
  /** Add a key to the live set without evicting existing keys. */
  addKey(entry: { kid: string; publicJwk: Record<string, unknown> }): void;
  /**
   * Internal: resolve a public key by kid.
   * alg is passed from the JWT protected header so importJWK can succeed
   * even when the JWK itself does not embed "alg".
   */
  _resolveKey(kid: string, alg: string): Promise<KeyLike>;
}

export function createLocalJwkSet(
  initial: Array<{ kid: string; publicJwk: Record<string, unknown> }>,
): LocalJwkSet {
  // Map from kid → pre-imported public key
  const keyMap = new Map<string, KeyLike>();
  const rawMap = new Map<string, Record<string, unknown>>();

  for (const { kid, publicJwk } of initial) {
    rawMap.set(kid, publicJwk);
  }

  async function _resolveKey(kid: string, alg: string): Promise<KeyLike> {
    const cached = keyMap.get(kid);
    if (cached) return cached;

    const raw = rawMap.get(kid);
    if (!raw) throw new Error(`No key found for kid "${kid}"`);

    // Pass alg so importJWK knows the intended algorithm even if absent from JWK.
    const key = await importJWK(raw, alg) as KeyLike;
    keyMap.set(kid, key);
    return key;
  }

  function addKey({ kid, publicJwk }: { kid: string; publicJwk: Record<string, unknown> }): void {
    rawMap.set(kid, publicJwk);
    // Invalidate any previously cached import so the new JWK is picked up.
    keyMap.delete(kid);
  }

  return { addKey, _resolveKey };
}

// ---------------------------------------------------------------------------
// JWT provider (issues tokens, caches, auto-refreshes)
// ---------------------------------------------------------------------------

export interface JwtProviderOptions {
  privateKey: KeyLike;
  kid: string;
  alg: SupportedAlg;
  tenant: string;
  user: string;
  role: string;
  ttlSeconds: number;
  /** How many seconds before expiry to proactively refresh. Defaults to 30. */
  refreshSkewSeconds?: number;
}

export function createJwtProvider(opts: JwtProviderOptions): CredentialProvider {
  const {
    privateKey,
    kid,
    alg,
    tenant,
    user,
    role,
    ttlSeconds,
    refreshSkewSeconds = 30,
  } = opts;

  let cachedToken: string | null = null;
  /** exp timestamp in ms (epoch) */
  let cachedExpMs = 0;

  async function issue(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + ttlSeconds;
    cachedExpMs = expSec * 1000;

    const jwt = await new SignJWT({ tenant, user, role })
      .setProtectedHeader({ alg, kid })
      .setIssuedAt(nowSec)
      .setExpirationTime(expSec)
      .sign(privateKey);

    cachedToken = jwt;
    return jwt;
  }

  return {
    async authorizationHeader(): Promise<string> {
      const now = Date.now();
      const skewMs = refreshSkewSeconds * 1000;

      // If we have a cached token and we're not yet in the refresh skew window, reuse it.
      if (cachedToken !== null && now < cachedExpMs - skewMs) {
        return `Bearer ${cachedToken}`;
      }

      const token = await issue();
      return `Bearer ${token}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-principal signer (gateway principal normalization)
// ---------------------------------------------------------------------------

export interface PrincipalSignerOptions {
  privateKey: KeyLike;
  kid: string;
  alg: SupportedAlg;
  /** Token lifetime in seconds (e.g. 60 for the internal X-Horus-Principal JWT). */
  ttlSeconds: number;
}

/**
 * Build a per-principal token minter.
 *
 * Unlike {@link createJwtProvider} (fixed identity, cached), this signs an
 * arbitrary Principal on demand — used by the gateway to normalize any verified
 * client principal into a short-lived internal JWT (the X-Horus-Principal
 * header). Returns the raw compact JWT (no "Bearer " prefix).
 */
export function createPrincipalSigner(
  opts: PrincipalSignerOptions,
): (principal: Principal) => Promise<string> {
  const { privateKey, kid, alg, ttlSeconds } = opts;
  return async (principal: Principal): Promise<string> => {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({ tenant: principal.tenant, user: principal.user, role: principal.role })
      .setProtectedHeader({ alg, kid })
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + ttlSeconds)
      .sign(privateKey);
  };
}

// ---------------------------------------------------------------------------
// JWT verifier (offline, tenant-enforced)
// ---------------------------------------------------------------------------

export interface JwtVerifierOptions {
  jwks: LocalJwkSet;
  expectedTenant: string;
}

export function createJwtVerifier({ jwks, expectedTenant }: JwtVerifierOptions): CredentialVerifier {
  // Build a getKey function that jwtVerify accepts as its key argument.
  // We resolve from the local in-memory JWKS using the token's kid + alg headers.
  const getKey: JWTVerifyGetKey = async (header) => {
    const kid = header.kid;
    const alg = header.alg;
    if (!kid) throw new Error('JWT missing kid header');
    if (!alg) throw new Error('JWT missing alg header');
    return jwks._resolveKey(kid, alg);
  };

  return {
    async verify(authorizationHeader: string): Promise<Principal> {
      const token = authorizationHeader.replace(/^Bearer\s+/i, '');

      // Pin to asymmetric algorithms — defense against alg-confusion attacks
      // (e.g. an HS256 token forged with the RSA/EC public key as the secret).
      const { payload } = await jwtVerify(token, getKey, {
        algorithms: ['RS256', 'ES256'],
      });

      const tenant = payload['tenant'] as string | undefined;
      const user = payload['user'] as string | undefined;
      const role = payload['role'] as string | undefined;

      if (typeof tenant !== 'string' || typeof user !== 'string' || typeof role !== 'string') {
        throw new Error('JWT missing required claims: tenant, user, role');
      }

      if (tenant !== expectedTenant) {
        throw new Error(`Tenant mismatch: expected "${expectedTenant}", got "${tenant}"`);
      }

      return { tenant, user, role };
    },
  };
}

// ---------------------------------------------------------------------------
// Hardened verifier — structural tenant floor on top of any plugin
// ---------------------------------------------------------------------------

export function hardenedVerifier(plugin: CredentialVerifier, expectedTenant: string): CredentialVerifier {
  return {
    async verify(header: string): Promise<Principal> {
      const principal = await plugin.verify(header);

      if (principal.tenant !== expectedTenant) {
        throw new Error(
          `Tenant isolation violation: expected "${expectedTenant}", plugin returned "${principal.tenant}"`,
        );
      }

      return principal;
    },
  };
}
