/**
 * operator-service domain model: the governed Request primitive and its state
 * machine (§F / catalog db07326b).
 *
 * Alpha: all admin-originated requests auto-approve (no human gate). Provisioning
 * is idempotent and resumable — `failed` re-enters the Provisioner, which skips
 * already-completed steps via the `steps` ledger.
 */

export type RequestKind =
  | 'onboard' // A1: create user/tenant record + issue bundle
  | 'vault_create' // C2: logical vault provisioning (git + typesense + neo4j + registry)
  | 'vault_attach' // C2: attach an existing vault to a router (registry entry only)
  | 'vault_delete' // crude teardown of a vault
  | 'teardown'; // crude tenant/user teardown

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'provisioning'
  | 'provisioned'
  | 'failed'
  | 'rejected'
  | 'torn_down';

export type Decision = 'approved' | 'rejected';

export interface ProvisioningRequest {
  id: string;
  kind: RequestKind;
  payload: Record<string, unknown>;
  requester: string;
  tenant: string;
  status: RequestStatus;
  decision: Decision | null;
  decidedBy: string | null;
  /** Last failure message (cleared on successful provision). */
  error: string | null;
  /** Idempotent-resume ledger: stepName → completed. */
  steps: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

/** Allowed status transitions. */
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['provisioning'],
  provisioning: ['provisioned', 'torn_down', 'failed'],
  failed: ['provisioning'], // resumable retry
  provisioned: ['provisioning'], // re-reconcile (e.g. teardown re-enters)
  rejected: [],
  torn_down: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(from: RequestStatus, to: RequestStatus) {
    super(`Invalid request transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Terminal success status per kind (teardown ends at torn_down, others at provisioned). */
export function terminalSuccess(kind: RequestKind): RequestStatus {
  return kind === 'vault_delete' || kind === 'teardown' ? 'torn_down' : 'provisioned';
}

/**
 * Options for deriving a registry entry's git backing store reference.
 * Used by ensureRegistryEntry (and extracted from ensureGitBackingStore opts).
 */
export interface RegistryEntryOpts {
  /** GitHub org/owner for the backing repo. Defaults to config.githubOwner. */
  gitOrg?: string;
  /** Explicit repo name. Defaults to `vault-${namespaceSlug(namespace)}`. */
  repoName?: string;
  /** GitHub API hostname for this vault's backing repo. */
  gitApiHost?: string;
}
