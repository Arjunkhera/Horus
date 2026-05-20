/**
 * profile-guard — DeploymentProfile-aware sync strategy selector.
 *
 * Implements the Q9 locked decision:
 *   - enterprise mode → git-sync ENABLED  (corporate, git-backed vault)
 *   - saas mode       → git-sync DISABLED (remote per-user container;
 *                        durability moves to DB + S3 backup)
 *
 * This module is the ONLY place in `packages/anvil` that branches on
 * `DeploymentProfile.mode`. All callers should use `selectSyncStrategy`
 * rather than inspecting the profile directly.
 *
 * @see bootstrapV2   — wires the returned strategy into the boot sequence
 * @see src/index.ts  — applies gitSyncEnabled before starting GitSyncEngine
 */
import type { DeploymentProfile } from '@horus/scope';
import type { Backup } from '../backup/interface.js';
import { NoOpBackup } from '../backup/noop-backup.js';

// ---------------------------------------------------------------------------
// SyncStrategy — the resolved boot-time decision
// ---------------------------------------------------------------------------

export interface SyncStrategy {
  /**
   * Whether GitSyncEngine should be started.
   *
   * true  → enterprise mode; git-sync runs as before
   * false → saas/remote mode; git-sync must NOT be started
   */
  gitSyncEnabled: boolean;

  /**
   * The backup backend to use.
   *
   * In local mode: NoOpBackup (git-sync is the durability mechanism)
   * In remote mode: NoOpBackup by default; replaced by S3Backup once
   *   the Operator provisions the bucket (deferred post-alpha)
   */
  backup: Backup;
}

// ---------------------------------------------------------------------------
// isGitSyncEnabled
// ---------------------------------------------------------------------------

/**
 * Returns true when the given profile calls for git-sync to be active.
 *
 * Decision: git-sync is the durability mechanism for enterprise deployments
 * where Anvil vaults are git-backed. In saas (remote) mode, per-user Anvil
 * containers have no shared remote to push/pull against — enabling git-sync
 * would crash with "no remote configured" errors.
 */
export function isGitSyncEnabled(profile: DeploymentProfile): boolean {
  return profile.mode === 'enterprise';
}

// ---------------------------------------------------------------------------
// selectSyncStrategy
// ---------------------------------------------------------------------------

/**
 * Resolve the full sync strategy from a DeploymentProfile.
 *
 * @param profile  The active DeploymentProfile (from `@horus/scope`)
 * @param backup   Optional override backup backend; defaults to NoOpBackup
 */
export function selectSyncStrategy(
  profile: DeploymentProfile,
  backup?: Backup,
): SyncStrategy {
  return {
    gitSyncEnabled: isGitSyncEnabled(profile),
    backup: backup ?? new NoOpBackup(),
  };
}
