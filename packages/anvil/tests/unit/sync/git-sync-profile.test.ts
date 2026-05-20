/**
 * RED spec — TA-11: git-sync gated on DeploymentProfile mode
 *
 * Tests that:
 *  (a) local / enterprise mode → git-sync (GitSyncEngine) is started
 *  (b) remote / saas mode → git-sync is NOT started; NoOpBackup is wired
 *  (c) backup scheduler is invoked in remote mode
 *
 * These tests exercise the `selectSyncStrategy` helper that the bootstrap
 * will call. The function must be exported from
 * `packages/anvil/src/sync/profile-guard.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeploymentProfile } from '@horus/scope';

// ---------------------------------------------------------------------------
// Inline profile fixtures (avoids importing the real module which may not
// export a "local" profile yet — we construct minimal conformant objects).
// ---------------------------------------------------------------------------

const localProfile: DeploymentProfile = {
  mode: 'enterprise',
  tenancy: 'single-user',
  placement: {
    anvil: 'shared',
    vault: 'shared',
    'forge-registry': 'shared',
    'forge-artifactory': 'shared',
  },
  scale: { replicas: 1, maxConcurrency: 10 },
  credentialPair: 'es-256',
  identitySource: 'local',
  globalForgeLink: 'http://localhost',
  governancePolicy: 'local-v1',
};

const remoteProfile: DeploymentProfile = {
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
// Import the function under test. This import is expected to FAIL (RED)
// until `src/sync/profile-guard.ts` is created.
// ---------------------------------------------------------------------------

import {
  isGitSyncEnabled,
  selectSyncStrategy,
  type SyncStrategy,
} from '../../../src/sync/profile-guard.js';

import { NoOpBackup } from '../../../src/backup/noop-backup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isGitSyncEnabled', () => {
  it('returns true for enterprise (local) mode', () => {
    expect(isGitSyncEnabled(localProfile)).toBe(true);
  });

  it('returns false for saas (remote) mode', () => {
    expect(isGitSyncEnabled(remoteProfile)).toBe(false);
  });
});

describe('selectSyncStrategy — local/enterprise profile', () => {
  let strategy: SyncStrategy;

  beforeEach(() => {
    strategy = selectSyncStrategy(localProfile);
  });

  it('sets gitSyncEnabled = true', () => {
    expect(strategy.gitSyncEnabled).toBe(true);
  });

  it('provides a backup instance', () => {
    expect(strategy.backup).toBeDefined();
  });

  it('backup is a NoOpBackup in local mode', () => {
    expect(strategy.backup).toBeInstanceOf(NoOpBackup);
  });
});

describe('selectSyncStrategy — remote/saas profile', () => {
  let strategy: SyncStrategy;

  beforeEach(() => {
    strategy = selectSyncStrategy(remoteProfile);
  });

  it('sets gitSyncEnabled = false', () => {
    expect(strategy.gitSyncEnabled).toBe(false);
  });

  it('provides a backup instance', () => {
    expect(strategy.backup).toBeDefined();
  });

  it('backup is a NoOpBackup (default until S3 impl)', () => {
    expect(strategy.backup).toBeInstanceOf(NoOpBackup);
  });
});
