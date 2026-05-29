/**
 * Pre-provisioned config bundle (resolves spec §8 open question).
 *
 * Emitted by `horus operator user add`, consumed by `horus setup --config <path>`.
 * The shape is constrained by the client-side validator `preprovisionedSchema`
 * in ./config.ts (all fields optional, `.passthrough()`, YAML). For the static
 * token provider, `token_provider.config` is the raw bearer token (matches how
 * setup.ts / login.ts and TOKEN_PROVIDER_CONFIG consume it).
 */

import { stringify as stringifyYaml } from 'yaml';

export const BUNDLE_VERSION = '1';

export interface AssignedVault {
  /** Logical namespace as `owner/vault`. */
  namespace: string;
  /** Upstream endpoint the control plane routes this vault to. */
  endpoint: string;
  default?: boolean;
}

export interface BundleInput {
  controlPlaneUrl: string;
  /** Minted initial client token (becomes token_provider.config for kind=static). */
  initialToken: string;
  tokenProviderKind?: string;
  vaults?: AssignedVault[];
  version?: string;
  dataDir?: string;
  runtime?: 'docker' | 'podman';
}

export interface PreprovisionedBundle {
  version: string;
  control_plane_url: string;
  token_provider: { kind: string; config: string };
  vaults: Record<string, { endpoint: string; default?: boolean }>;
  data_dir?: string;
  runtime?: 'docker' | 'podman';
}

export function buildBundle(input: BundleInput): PreprovisionedBundle {
  const vaults: PreprovisionedBundle['vaults'] = {};
  for (const v of input.vaults ?? []) {
    vaults[v.namespace] = v.default ? { endpoint: v.endpoint, default: true } : { endpoint: v.endpoint };
  }
  const bundle: PreprovisionedBundle = {
    version: input.version ?? BUNDLE_VERSION,
    control_plane_url: input.controlPlaneUrl,
    token_provider: { kind: input.tokenProviderKind ?? 'static', config: input.initialToken },
    vaults,
  };
  if (input.dataDir) bundle.data_dir = input.dataDir;
  if (input.runtime) bundle.runtime = input.runtime;
  return bundle;
}

export function serializeBundle(bundle: PreprovisionedBundle): string {
  return stringifyYaml(bundle);
}
