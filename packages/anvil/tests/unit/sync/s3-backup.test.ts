/**
 * RED spec — TA-11: backup interface + NoOpBackup + S3Backup scaffold
 *
 * Tests that:
 *  - Backup interface has expected method shape (snapshot, restore)
 *  - NoOpBackup implements Backup and is a safe no-op
 *  - S3Backup (scaffold) exposes a scheduleBackup(intervalMs) function that
 *    starts an interval-based snapshot cycle (mocked timer)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Backup } from '../../../src/backup/interface.js';
import { NoOpBackup } from '../../../src/backup/noop-backup.js';
import { S3Backup, scheduleBackup } from '../../../src/backup/s3-backup.js';

// ---------------------------------------------------------------------------
// Backup interface conformance
// ---------------------------------------------------------------------------

describe('NoOpBackup', () => {
  let backup: Backup;

  beforeEach(() => {
    backup = new NoOpBackup();
  });

  it('implements Backup interface', () => {
    expect(typeof backup.snapshot).toBe('function');
    expect(typeof backup.restore).toBe('function');
  });

  it('snapshot() resolves without throwing', async () => {
    await expect(backup.snapshot()).resolves.toBeUndefined();
  });

  it('restore() resolves without throwing', async () => {
    await expect(backup.restore()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S3Backup scaffold
// ---------------------------------------------------------------------------

describe('S3Backup scaffold', () => {
  it('is constructable with bucket + keyPrefix', () => {
    const backup = new S3Backup({ bucket: 'test-bucket', keyPrefix: 'anvil/' });
    expect(backup).toBeDefined();
  });

  it('implements Backup interface', () => {
    const backup = new S3Backup({ bucket: 'test-bucket', keyPrefix: 'anvil/' });
    expect(typeof backup.snapshot).toBe('function');
    expect(typeof backup.restore).toBe('function');
  });

  it('snapshot() resolves (scaffold — no real S3 call)', async () => {
    const backup = new S3Backup({ bucket: 'test-bucket', keyPrefix: 'anvil/' });
    // Should not throw even though AWS SDK is not configured
    await expect(backup.snapshot()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// scheduleBackup — interval logic
// ---------------------------------------------------------------------------

describe('scheduleBackup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls snapshot on the interval', async () => {
    const backup = new NoOpBackup();
    const snapshotSpy = vi.spyOn(backup, 'snapshot');

    const handle = scheduleBackup(backup, 1000);

    // Advance clock twice
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(snapshotSpy).toHaveBeenCalledTimes(2);

    // Cleanup
    clearInterval(handle);
  });

  it('returns an interval handle that can be cleared', () => {
    const backup = new NoOpBackup();
    const handle = scheduleBackup(backup, 5000);
    expect(handle).toBeDefined();
    clearInterval(handle);
  });
});
