/**
 * HorusPrincipalAuthStrategy — verifies the gateway-minted `X-Horus-Principal`
 * JWT and derives caller identity from its claims.
 *
 * horus-service (the public API gateway) normalizes any verified client
 * principal into a short-lived (60s) internal JWT signed with the internal
 * signing key, and injects it as the `X-Horus-Principal` header on the
 * downstream request. This strategy verifies that token's *signature* against
 * the signing key's PUBLIC half (distributed out-of-band as a K8s Secret),
 * then derives identity {tenant, user, role} + extension claims from the
 * payload and maps the Horus role onto a Forge role.
 *
 * This mirrors the Vault principal middleware
 * (services/vault/src/security/principal.py) so both services verify the same
 * token the same way (RS256/ES256 only, require exp, clock-skew leeway).
 *
 * Security invariants:
 *  - identify() NEVER throws — returns null on any parsing/verification failure.
 *  - Asymmetric algorithms only (RS256/ES256) — pinned to defend against
 *    alg-confusion (e.g. an HS256 token forged with the public key as secret).
 *  - Fail-closed: a missing/invalid token or unconfigured key yields a null
 *    identity, so write actions are denied.
 */

import { importJWK, jwtVerify, type CryptoKey, type KeyObject } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { AuthDecision, AuthStrategy } from './types.js';
import type { ServiceAction, ServiceResource, ServiceRole, ServiceUser } from '../types.js';
import type { HorusPrincipalAuthConfig } from '../config.js';

/** jose v6 removed the KeyLike union type — inline it here. */
type KeyLike = CryptoKey | KeyObject;

type ForgeRole = 'consumer' | 'publisher' | 'registry-admin';

/** Default Horus-role → Forge-role mapping (keys matched case-insensitively). */
const DEFAULT_ROLE_MAP: Record<string, ForgeRole> = {
  'registry-admin': 'registry-admin',
  admin: 'registry-admin',
  owner: 'registry-admin',
  publisher: 'publisher',
  maintainer: 'publisher',
  writer: 'publisher',
  consumer: 'consumer',
  reader: 'consumer',
  viewer: 'consumer',
  member: 'consumer',
};

/** Registered JWT claims that must not leak into the extension-claims bag. */
const STANDARD_CLAIMS = new Set(['tenant', 'user', 'role', 'roles', 'iat', 'exp', 'nbf', 'aud', 'iss', 'jti', 'sub']);

export class HorusPrincipalAuthStrategy implements AuthStrategy {
  private readonly cfg: HorusPrincipalAuthConfig;
  private readonly header: string;
  private readonly leeway: number;
  private readonly roleMap: Record<string, ForgeRole>;

  /** Cached imported public key. */
  private key: KeyLike | null = null;
  private keyReady = false;

  constructor(cfg: HorusPrincipalAuthConfig) {
    this.cfg = cfg;
    this.header = (cfg.header ?? 'x-horus-principal').toLowerCase();
    this.leeway = cfg.leewaySeconds ?? 30;

    // Lowercase override keys so matching is case-insensitive.
    const overrides: Record<string, ForgeRole> = {};
    for (const [k, v] of Object.entries(cfg.roleMap ?? {})) {
      overrides[k.toLowerCase()] = v;
    }
    this.roleMap = { ...DEFAULT_ROLE_MAP, ...overrides };
  }

  private async ensureKey(): Promise<KeyLike | null> {
    if (this.keyReady) return this.key;
    this.keyReady = true;

    const jwk = this.cfg.publicJwk;
    if (!jwk) return null;

    try {
      const alg = jwk['kty'] === 'EC' ? 'ES256' : 'RS256';
      this.key = (await importJWK(jwk, alg)) as KeyLike;
    } catch {
      this.key = null;
    }
    return this.key;
  }

  private getHeader(request: FastifyRequest): string | null {
    const value = (request.headers as Record<string, string | string[] | undefined>)[this.header];
    if (!value) return null;
    const str = Array.isArray(value) ? value[0] : value;
    return str ? str.trim() : null;
  }

  private mapRole(horusRole: string): ServiceRole {
    return this.roleMap[horusRole.toLowerCase()] ?? 'consumer';
  }

  async identify(request: FastifyRequest): Promise<ServiceUser | null> {
    try {
      const token = this.getHeader(request);
      if (!token) return null;

      const key = await this.ensureKey();
      if (!key) return null; // unconfigured — fail closed

      let payload: Record<string, unknown>;
      try {
        const result = await jwtVerify(token, key, {
          algorithms: ['RS256', 'ES256'],
          clockTolerance: this.leeway,
          requiredClaims: ['exp'],
        });
        payload = result.payload as Record<string, unknown>;
      } catch {
        return null; // invalid signature / expired / missing exp
      }

      const tenant = payload['tenant'];
      const user = payload['user'];
      const role = payload['role'];
      if (typeof tenant !== 'string' || typeof user !== 'string' || typeof role !== 'string') {
        return null; // missing required claims
      }

      const roles = Array.isArray(payload['roles'])
        ? (payload['roles'] as unknown[]).filter((r): r is string => typeof r === 'string')
        : [];

      const claims: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (!STANDARD_CLAIMS.has(k)) claims[k] = v;
      }

      return {
        userId: user,
        name: user,
        role: this.mapRole(role),
        tenant,
        roles,
        claims,
      };
    } catch {
      return null; // must NEVER throw
    }
  }

  authorize(user: ServiceUser | null, action: ServiceAction, _resource: ServiceResource): AuthDecision {
    // Reads are public (R6) — even unauthenticated callers may read.
    if (action === 'read') return 'permit';

    const role = user?.role;

    if (action === 'publish') {
      return role === 'publisher' || role === 'registry-admin' ? 'permit' : 'deny';
    }

    // verify / unverify are governance actions — registry-admin only.
    if (action === 'verify' || action === 'unverify') {
      return role === 'registry-admin' ? 'permit' : 'deny';
    }

    return 'deny';
  }
}
