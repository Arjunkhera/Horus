/**
 * @horus/tenancy — per-user Anvil tenancy plumbing contract (F3).
 *
 * This is NOT a service implementation. It is the interface scaffolding + written
 * contract that Track A (Anvil service) and Track E (Operator) implement against.
 *
 * F1 dependency: Principal from @horus/auth
 * F2 dependency: resolveScope / DeploymentProfile from @horus/scope
 */

export type { Principal } from '@horus/auth';
import type { Principal } from '@horus/auth';
import {
  resolveScope,
  type DeploymentProfile,
  type Subsystem,
} from '@horus/scope';

// Re-export Subsystem so consumers that import everything from this package
// don't need a direct @horus/scope import.
export type { Subsystem, DeploymentProfile };

// ---------------------------------------------------------------------------
// Per-user Anvil resource shape
// ---------------------------------------------------------------------------

/**
 * The two Anvil-level resources that must exist before a user can write notes.
 * Each is derived from the F2 ScopeCoordinate so the names are deterministic
 * and unique per (tenant, user) pair under the active DeploymentProfile.
 */
export type PerUserAnvilResource = {
  /** Typesense collection name — safe for the Typesense REST API (no dots/slashes). */
  typesenseCollection: string;
  /** Neo4j database name — safe for the bolt protocol (lowercase, hyphens only). */
  neo4jDatabase: string;
};

/** Sanitise a string to characters legal in Typesense collection names. */
function sanitiseCollection(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Sanitise a string to characters legal in Neo4j database names. */
function sanitiseDatabase(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

/**
 * Derive the per-user Anvil resource names from the F2 scope coordinate.
 *
 * The coordinate's `tenant` and `user` segments are used verbatim so the names
 * are stable across restarts and contain the user identifier (tests assert this).
 * Under the SaaS single-user profile, tenant collapses to user (F2 semantics) —
 * both fields still carry the user value, satisfying the containment assertion.
 */
export function derivePerUserAnvilResource(
  principal: Principal,
  profile: DeploymentProfile,
): PerUserAnvilResource {
  const coord = resolveScope(principal, 'anvil', profile);

  // coord.tenant and coord.user are always present for the 'anvil' subsystem
  // (TIER_POLICY for anvil: tenant=true, user=true).
  const tenant = coord.tenant ?? principal.tenant;
  const user = coord.user ?? principal.user;

  const typesenseCollection = sanitiseCollection(`anvil_${tenant}_${user}`);
  const neo4jDatabase = sanitiseDatabase(`anvil-${tenant}-${user}`);

  return { typesenseCollection, neo4jDatabase };
}

// ---------------------------------------------------------------------------
// Provisioning step contract
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'done';

/**
 * A single idempotent provisioning step for the C2 retry-safe Operator handler.
 *
 * `ensure` must be called with a shared `completed` set. If the step's id is
 * already in that set, the step short-circuits and returns 'done' immediately
 * (status-checkpointing). Otherwise it executes its work, records the id, and
 * returns 'done'. No network I/O — this is a reference contract.
 */
export interface ProvisioningStep {
  id: string;
  describe: string;
  owner: string;
  ensure(ctx: { completed: Set<string> }): Promise<StepStatus>;
}

/**
 * Neutral owner for the schema-bootstrap step.
 * Explicitly NOT 'anvil' — the Anvil service must not own its own schema
 * initialisation; that responsibility belongs to the Operator layer.
 */
export const SCHEMA_BOOTSTRAP_OWNER = 'horus-provisioner';

function makeStep(
  id: string,
  describe: string,
  owner: string,
): ProvisioningStep {
  return {
    id,
    describe,
    owner,
    async ensure(ctx) {
      // Idempotent: if already completed in this run, return immediately.
      if (ctx.completed.has(id)) return 'done';
      // No real I/O — contract scaffold only.
      ctx.completed.add(id);
      return 'done';
    },
  };
}

/**
 * Ordered reference provisioning plan for a single per-user Anvil allocation.
 *
 * Steps:
 *   1. create-typesense-collection — Typesense collection for user notes index
 *   2. create-neo4j-database       — Neo4j database for the user's graph
 *   3. schema-bootstrap            — Load Anvil default type definitions into the
 *                                    Neo4j database; owned by the neutral Operator,
 *                                    NOT by Anvil itself.
 */
export const perUserAnvilProvisioningPlan: ProvisioningStep[] = [
  makeStep(
    'create-typesense-collection',
    'Create the per-user Typesense collection for Anvil note indexing',
    'anvil',
  ),
  makeStep(
    'create-neo4j-database',
    'Create the per-user Neo4j database for the Anvil graph layer',
    'anvil',
  ),
  makeStep(
    'schema-bootstrap',
    'Bootstrap Anvil default type schemas into the per-user Neo4j database',
    SCHEMA_BOOTSTRAP_OWNER,
  ),
];

// ---------------------------------------------------------------------------
// Scoping enforcement contract
// ---------------------------------------------------------------------------

/**
 * Guards cross-user data access using the F2 scope coordinate as the
 * canonical identity key. Mirrors the F1 tenant-isolation floor.
 *
 * `assertAccess` throws if the two principals resolve to different scope keys
 * under the active DeploymentProfile, allowing same-user access and blocking
 * cross-user access in a profile-agnostic way.
 */
export interface ScopingEnforcement {
  assertAccess(
    principal: Principal,
    target: { principal: Principal; subsystem?: Subsystem },
  ): void;
}

export function createScopingEnforcement(
  profile: DeploymentProfile,
): ScopingEnforcement {
  return {
    assertAccess(principal, target) {
      const subsystem: Subsystem = target.subsystem ?? 'anvil';
      const callerKey = resolveScope(principal, subsystem, profile).key;
      const targetKey = resolveScope(target.principal, subsystem, profile).key;

      if (callerKey !== targetKey) {
        throw new Error(
          `Access denied: scope "${callerKey}" cannot access scope "${targetKey}"`,
        );
      }
    },
  };
}
