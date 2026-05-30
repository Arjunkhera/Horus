/**
 * Keypair management (§H). On first boot operator-service generates BOTH the
 * client-facing verify keypair and the internal signing keypair, persists them
 * (PVC-backed SQLite), and is idempotent: subsequent boots reuse the stored
 * keys. The public JWKs + internal private JWK are exported out-of-band to
 * horus-service (HORUS_CLIENT_JWKS_JSON / HORUS_INTERNAL_SIGNING_KEY_JSON).
 */

import { exportJWK } from 'jose';
import { createJwtKeyPair, type SupportedAlg } from '@horus/auth';
import type { Store } from './store.js';

const ALG: SupportedAlg = 'ES256';
export const CLIENT_KEY = 'client-facing';
export const INTERNAL_KEY = 'internal-signing';

export interface StoredKeyPair {
  kid: string;
  alg: SupportedAlg;
  publicJwk: Record<string, unknown>;
  privateJwk: Record<string, unknown>;
}

export class KeyManager {
  constructor(private readonly store: Store) {}

  /** Idempotent: generate any missing keypair, reuse existing. */
  async firstBootEnsure(): Promise<{ generated: boolean }> {
    let generated = false;
    for (const name of [CLIENT_KEY, INTERNAL_KEY]) {
      if (!this.store.getKey(name)) {
        await this.generate(name);
        generated = true;
      }
    }
    return { generated };
  }

  private async generate(name: string): Promise<void> {
    const kp = await createJwtKeyPair({ alg: ALG });
    const privateJwk = (await exportJWK(kp.privateKey)) as Record<string, unknown>;
    const stored: StoredKeyPair = { kid: kp.kid, alg: ALG, publicJwk: kp.publicJwk, privateJwk };
    this.store.putKey(name, stored);
    this.store.audit('operator-service', 'keypair.generated', name);
  }

  private load(name: string): StoredKeyPair {
    const k = this.store.getKey(name) as StoredKeyPair | null;
    if (!k) throw new Error(`Keypair not initialized: ${name}. Run firstBootEnsure().`);
    return k;
  }

  /** Public JWKS array used by horus-service to verify inbound client tokens. */
  clientJwks(): Array<{ kid: string; publicJwk: Record<string, unknown> }> {
    const k = this.load(CLIENT_KEY);
    return [{ kid: k.kid, publicJwk: k.publicJwk }];
  }

  /** Internal signing key used by horus-service to mint X-Horus-Principal tokens. */
  internalSigningKey(): { kid: string; alg: SupportedAlg; privateJwk: Record<string, unknown> } {
    const k = this.load(INTERNAL_KEY);
    return { kid: k.kid, alg: k.alg, privateJwk: k.privateJwk };
  }

  /** Client-facing signing key — used to mint a user's initial client token. */
  clientSigningKey(): { kid: string; alg: SupportedAlg; privateJwk: Record<string, unknown> } {
    const k = this.load(CLIENT_KEY);
    return { kid: k.kid, alg: k.alg, privateJwk: k.privateJwk };
  }

  /** Public JWKS for the internal key — published so backends (e.g. Vault) verify X-Horus-Principal. */
  internalJwks(): Array<{ kid: string; publicJwk: Record<string, unknown> }> {
    const k = this.load(INTERNAL_KEY);
    return [{ kid: k.kid, publicJwk: k.publicJwk }];
  }
}
