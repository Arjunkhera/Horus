/**
 * S3Backup — scaffold implementation of the Backup interface for remote mode.
 *
 * This module provides:
 *  1. `S3Backup` class — implements `Backup`; snapshot/restore methods are
 *     wired up but the actual S3 upload/download logic is stubbed with
 *     a TODO comment. Full hardening (retry, exponential backoff, encryption,
 *     multi-part upload) is deferred to post-alpha.
 *  2. `scheduleBackup(backup, intervalMs)` — starts a repeating interval
 *     that calls `backup.snapshot()`. Returns the interval handle so callers
 *     can clear it on shutdown.
 *
 * @alpha
 * TODO: harden for alpha — implement real S3 upload retry logic, exponential
 * backoff, encryption at rest, and multi-part upload for large Neo4j dumps.
 */
import type { Backup } from './interface.js';

// ---------------------------------------------------------------------------
// S3Backup options
// ---------------------------------------------------------------------------

export interface S3BackupOptions {
  /** S3 bucket name (Operator-provisioned) */
  bucket: string;
  /** Key prefix for all objects written by this instance */
  keyPrefix: string;
}

// ---------------------------------------------------------------------------
// S3Backup
// ---------------------------------------------------------------------------

export class S3Backup implements Backup {
  private readonly opts: S3BackupOptions;

  constructor(opts: S3BackupOptions) {
    this.opts = opts;
  }

  /**
   * Snapshot current state to S3.
   *
   * TODO: harden for alpha — implement real S3 upload:
   *   1. Dump Neo4j edges to JSON via EdgeBackup
   *   2. Export Typesense collection via Typesense export API
   *   3. Upload both to `s3://${bucket}/${keyPrefix}/<timestamp>/`
   *   4. Add retry with exponential backoff
   */
  async snapshot(): Promise<void> {
    // Scaffold only — no real S3 calls in this story.
    // The interval is wired; the upload body is a stub.
    process.stderr.write(
      JSON.stringify({
        level: 'debug',
        message: `[s3-backup] snapshot stub called (bucket=${this.opts.bucket}, prefix=${this.opts.keyPrefix})`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }

  /**
   * Restore state from the most recent S3 snapshot.
   *
   * TODO: harden for alpha — implement real S3 restore:
   *   1. List objects under `${keyPrefix}` sorted by timestamp
   *   2. Download the latest snapshot bundle
   *   3. Import edges into Neo4j via EdgeBackup
   *   4. Re-ingest Typesense export
   */
  async restore(): Promise<void> {
    // Scaffold only — no real S3 calls in this story.
    process.stderr.write(
      JSON.stringify({
        level: 'debug',
        message: `[s3-backup] restore stub called (bucket=${this.opts.bucket}, prefix=${this.opts.keyPrefix})`,
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}

// ---------------------------------------------------------------------------
// scheduleBackup — interval helper
// ---------------------------------------------------------------------------

/**
 * Start a repeating backup cycle.
 *
 * Calls `backup.snapshot()` every `intervalMs` milliseconds.
 * Snapshot errors are caught and logged as warnings — the interval
 * continues regardless.
 *
 * @param backup    The Backup implementation to call
 * @param intervalMs  Milliseconds between snapshots
 * @returns  The interval handle; pass to `clearInterval` on shutdown
 */
export function scheduleBackup(backup: Backup, intervalMs: number): ReturnType<typeof setInterval> {
  return setInterval(() => {
    backup.snapshot().catch((err: unknown) => {
      process.stderr.write(
        JSON.stringify({
          level: 'warn',
          message: `[s3-backup] snapshot failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        }) + '\n',
      );
    });
  }, intervalMs);
}
