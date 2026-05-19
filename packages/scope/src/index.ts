/**
 * @horus/scope — scope-chain resolver + DeploymentProfile config module (F2).
 *
 * DeploymentProfile is the single source of every enterprise/SaaS behavioural
 * difference.  resolveScope() reads it uniformly — no branch per tenancy mode.
 */

import { z } from 'zod';
import type { Principal } from '@horus/auth';

export type { Principal };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Subsystem =
  | 'anvil'
  | 'vault'
  | 'forge-registry'
  | 'forge-artifactory';

export type ScopeCoordinate = {
  global?: string;
  tenant?: string;
  user?: string;
  key: string;
};

// ---------------------------------------------------------------------------
// DeploymentProfile schema (zod)
// ---------------------------------------------------------------------------

const SubsystemSchema = z.enum([
  'anvil',
  'vault',
  'forge-registry',
  'forge-artifactory',
]);

const PlacementSchema = z.record(
  SubsystemSchema,
  z.enum(['shared', 'per-user']),
);

const ScaleSchema = z.object({
  replicas: z.number().int().min(1).default(1),
  maxConcurrency: z.number().int().min(1).default(100),
});

const DeploymentProfileSchema = z.object({
  mode: z.enum(['enterprise', 'saas']),
  tenancy: z.enum(['multi-tenant', 'single-user']),
  placement: PlacementSchema,
  scale: ScaleSchema,
  credentialPair: z.string(),
  identitySource: z.string(),
  globalForgeLink: z.string(),
  governancePolicy: z.string(),
});

export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export function parseDeploymentProfile(input: unknown): DeploymentProfile {
  return DeploymentProfileSchema.parse(input);
}

// ---------------------------------------------------------------------------
// Reference profiles
// ---------------------------------------------------------------------------

export const enterpriseAlphaProfile: DeploymentProfile = {
  mode: 'enterprise',
  tenancy: 'multi-tenant',
  placement: {
    anvil: 'per-user',
    vault: 'shared',
    'forge-registry': 'shared',
    'forge-artifactory': 'shared',
  },
  scale: { replicas: 3, maxConcurrency: 500 },
  credentialPair: 'rsa-4096',
  identitySource: 'oidc',
  globalForgeLink: 'https://forge.enterprise.horus.internal',
  governancePolicy: 'enterprise-alpha-v1',
};

export const saasProfile: DeploymentProfile = {
  mode: 'saas',
  tenancy: 'single-user',
  placement: {
    anvil: 'per-user',
    vault: 'shared',
    'forge-registry': 'shared',
    'forge-artifactory': 'shared',
  },
  scale: { replicas: 1, maxConcurrency: 50 },
  credentialPair: 'es-256',
  identitySource: 'local',
  globalForgeLink: 'https://forge.saas.horus.io',
  governancePolicy: 'saas-v1',
};

// ---------------------------------------------------------------------------
// Tier policy per subsystem
// ---------------------------------------------------------------------------

// Which tiers are active for each subsystem. Order: global, tenant, user.
const TIER_POLICY: Record<
  Subsystem,
  { global: boolean; tenant: boolean; user: boolean }
> = {
  anvil:               { global: false, tenant: true,  user: true  },
  vault:               { global: false, tenant: true,  user: false },
  'forge-registry':    { global: false, tenant: true,  user: false },
  'forge-artifactory': { global: true,  tenant: true,  user: false },
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolveScope(
  principal: Principal,
  subsystem: Subsystem,
  profile: DeploymentProfile,
): ScopeCoordinate {
  const policy = TIER_POLICY[subsystem];

  // Under single-user tenancy the tenant namespace collapses to the user —
  // this is expressed purely by reading principal values, no code branching.
  const effectiveTenant =
    profile.tenancy === 'single-user' ? principal.user : principal.tenant;

  const globalVal = policy.global ? profile.globalForgeLink : undefined;
  const tenantVal = policy.tenant ? effectiveTenant : undefined;
  const userVal   = policy.user   ? principal.user  : undefined;

  // Build a stable key from the active tier values + subsystem so keys differ
  // across profiles and principals.
  const segments: string[] = [];
  if (globalVal !== undefined) segments.push(`g:${globalVal}`);
  if (tenantVal !== undefined) segments.push(`t:${tenantVal}`);
  if (userVal   !== undefined) segments.push(`u:${userVal}`);
  segments.push(`s:${subsystem}`);

  const key = segments.join('/');

  return {
    ...(globalVal !== undefined && { global: globalVal }),
    ...(tenantVal !== undefined && { tenant: tenantVal }),
    ...(userVal   !== undefined && { user: userVal }),
    key,
  };
}
