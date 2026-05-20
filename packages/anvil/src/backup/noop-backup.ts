/**
 * NoOpBackup — safe no-operation implementation of the Backup interface.
 *
 * Used in:
 *  - Local / enterprise mode (git-sync handles durability; backup is a no-op)
 *  - Remote / saas mode until a real S3Backup is provisioned
 *
 * All methods resolve immediately without side-effects.
 */
import type { Backup } from './interface.js';

export class NoOpBackup implements Backup {
  async snapshot(): Promise<void> {
    // Intentional no-op.
  }

  async restore(): Promise<void> {
    // Intentional no-op.
  }
}
