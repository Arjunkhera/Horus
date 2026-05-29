/**
 * Mints a user's initial client token, signed with the client-facing key so
 * horus-service's TokenVerifier (which holds the matching public JWKS) accepts
 * it. This is the "initial token" placed in the pre-provisioned bundle (A1).
 */

import { importJWK, type CryptoKey } from 'jose';
import { createPrincipalSigner, type Principal } from '@horus/auth';
import type { KeyManager } from './keys.js';

export type ClientTokenMinter = (principal: Principal, ttlSeconds: number) => Promise<string>;

export function createClientTokenMinter(keys: KeyManager): ClientTokenMinter {
  const signing = keys.clientSigningKey();
  let keyPromise: Promise<CryptoKey> | null = null;
  const getKey = (): Promise<CryptoKey> =>
    (keyPromise ??= importJWK(signing.privateJwk, signing.alg) as Promise<CryptoKey>);

  return async (principal, ttlSeconds) => {
    const privateKey = await getKey();
    const sign = createPrincipalSigner({ privateKey, kid: signing.kid, alg: signing.alg, ttlSeconds });
    return sign(principal);
  };
}
