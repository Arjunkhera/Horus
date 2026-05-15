/**
 * TrustedHeadersAuthStrategy — reads caller identity from HTTP headers set by
 * an upstream proxy (Envoy, nginx, Istio, etc.).
 *
 * The service performs NO further AuthN; it trusts the proxy to authenticate
 * the caller and inject the configured headers.
 *
 * Optional JWT validation: when `jwt.enabled` is true the strategy expects the
 * same (or a separate) header to carry a signed JWT. The JWT is verified
 * against the configured public key before any header claim is trusted.
 *
 * Security invariants:
 *  - identify() NEVER throws — returns null on any parsing / verification failure.
 *  - JWT verification uses asymmetric keys only (RS256/ES256); symmetric keys
 *    are not supported through this path.
 */

import { createPublicKey } from 'node:crypto';
import { importSPKI, jwtVerify, type KeyLike } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { AuthDecision, AuthStrategy } from './types.js';
import type { ServiceAction, ServiceResource, ServiceUser } from '../types.js';
import type { TrustedHeadersAuthConfig } from '../config.js';

export class TrustedHeadersAuthStrategy implements AuthStrategy {
  private readonly cfg: TrustedHeadersAuthConfig;
  /** Cached public key for JWT verification */
  private publicKey: KeyLike | null = null;
  /** Whether the key import has been attempted (avoids repeated work) */
  private keyReady = false;

  constructor(cfg: TrustedHeadersAuthConfig) {
    this.cfg = cfg;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async ensurePublicKey(): Promise<KeyLike | null> {
    if (this.keyReady) return this.publicKey;
    this.keyReady = true;

    const pem = this.cfg.jwt?.publicKey;
    if (!pem) return null;

    try {
      this.publicKey = await importSPKI(pem, 'RS256', { extractable: false });
    } catch {
      // Try generic key import (covers EC keys, different alg hints, etc.)
      try {
        const raw = createPublicKey(pem);
        this.publicKey = raw as unknown as KeyLike;
      } catch {
        // Bad PEM — treat as no key; identify() will return null
        this.publicKey = null;
      }
    }
    return this.publicKey;
  }

  /**
   * Read a single header value from the Fastify request.
   * Fastify lowercases all header names, so we normalise the configured name.
   */
  private getHeader(request: FastifyRequest, headerName: string): string | null {
    const key = headerName.toLowerCase();
    const value = (request.headers as Record<string, string | string[] | undefined>)[key];
    if (!value) return null;
    const str = Array.isArray(value) ? value[0] : value;
    return str ? str.trim() : null;
  }

  // ---------------------------------------------------------------------------
  // AuthStrategy interface
  // ---------------------------------------------------------------------------

  async identify(request: FastifyRequest): Promise<ServiceUser | null> {
    try {
      // 1. JWT gate (when enabled) — must pass before we trust any header claim
      if (this.cfg.jwt?.enabled) {
        const jwtHeaderName = this.cfg.jwt.header ?? this.cfg.headers.user_id;
        const token = this.getHeader(request, jwtHeaderName);
        if (!token) return null;

        const key = await this.ensurePublicKey();
        if (!key) return null; // misconfigured — fail closed

        try {
          await jwtVerify(token, key);
        } catch {
          return null; // invalid / expired JWT
        }
      }

      // 2. Read identity headers
      const userId = this.getHeader(request, this.cfg.headers.user_id);
      if (!userId) return null;

      const rawRole = this.getHeader(request, this.cfg.headers.role);

      // Map to known ServiceRole; unknown roles collapse to 'anonymous'
      const role: ServiceUser['role'] = rawRole === 'admin' ? 'admin' : 'anonymous';

      return {
        userId,
        // Use userId as display name unless a separate name header is added later
        name: userId,
        role,
      };
    } catch {
      // Must NEVER throw
      return null;
    }
  }

  authorize(
    user: ServiceUser | null,
    action: ServiceAction,
    _resource: ServiceResource,
  ): AuthDecision {
    // Same role→action map as BuiltinAuthStrategy (R6: anonymous reads are fine)
    if (action === 'read') {
      return 'permit';
    }

    if (action === 'publish') {
      if (user?.role === 'admin') return 'permit';
      return 'deny';
    }

    return 'deny';
  }
}
