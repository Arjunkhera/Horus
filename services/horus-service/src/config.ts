/**
 * Environment → resolved runtime config for horus-service.
 *
 * Two-key model (§E / ADR-0008):
 *   - client-facing verify key(s): HORUS_CLIENT_JWKS_JSON (public JWKs) verify
 *     inbound client tokens.
 *   - internal signing key: HORUS_INTERNAL_SIGNING_KEY_JSON (private JWK) mints
 *     the short-lived X-Horus-Principal JWT injected to backends.
 */

import { importJWK, type CryptoKey } from 'jose';
import {
  createJwtVerifier,
  createLocalJwkSet,
  createPrincipalSigner,
  hardenedVerifier,
  type CredentialVerifier,
  type Principal,
  type SupportedAlg,
} from '@horus/auth';
import type { Upstreams } from './app.js';

export interface ResolvedConfig {
  port: number;
  host: string;
  upstreams: Upstreams;
  tokenVerifier: CredentialVerifier;
  principalSigner: (p: Principal) => Promise<string>;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

interface PublicJwkEntry {
  kid: string;
  publicJwk: Record<string, unknown>;
}

interface InternalSigningKey {
  kid: string;
  alg: SupportedAlg;
  privateJwk: Record<string, unknown>;
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedConfig> {
  const expectedTenant = required(env, 'HORUS_SERVICE_TENANT');
  const vaultRouter = required(env, 'HORUS_VAULT_ROUTER_URL');
  const forgeRegistry = required(env, 'HORUS_FORGE_REGISTRY_URL');
  const events = env.HORUS_EVENTS_URL ?? vaultRouter;
  const port = Number(env.HORUS_SERVICE_PORT ?? '8080');
  const host = env.HORUS_SERVICE_HOST ?? '0.0.0.0';
  const ttlSeconds = Number(env.HORUS_INTERNAL_TTL_SECONDS ?? '60');

  const clientKeys = JSON.parse(required(env, 'HORUS_CLIENT_JWKS_JSON')) as PublicJwkEntry[];
  const jwks = createLocalJwkSet(clientKeys);
  const tokenVerifier = hardenedVerifier(
    createJwtVerifier({ jwks, expectedTenant }),
    expectedTenant,
  );

  const internal = JSON.parse(
    required(env, 'HORUS_INTERNAL_SIGNING_KEY_JSON'),
  ) as InternalSigningKey;
  const privateKey = (await importJWK(internal.privateJwk, internal.alg)) as CryptoKey;
  const principalSigner = createPrincipalSigner({
    privateKey,
    kid: internal.kid,
    alg: internal.alg,
    ttlSeconds,
  });

  return {
    port,
    host,
    upstreams: { vaultRouter, forgeRegistry, events },
    tokenVerifier,
    principalSigner,
  };
}
