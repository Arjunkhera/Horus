/**
 * Storage backend factory.
 *
 * Selects the appropriate StorageBackend implementation based on the
 * `storage.backend` field in the resolved ServiceConfig.
 */

import type { ServiceConfig } from '../config.js';
import type { StorageBackend } from './types.js';
import { S3StorageBackend } from './s3-backend.js';
import { GitStorageBackend } from './git-backend.js';

/**
 * Instantiate the configured StorageBackend.
 *
 * @throws if an unknown backend type is encountered
 */
export function createStorageBackend(config: ServiceConfig): StorageBackend {
  const { storage } = config;

  switch (storage.backend) {
    case 's3':
      return new S3StorageBackend(storage);

    case 'git':
      return new GitStorageBackend(storage);

    default: {
      // TypeScript exhaustiveness guard
      const _exhaustive: never = storage;
      throw new Error(
        `Unknown storage backend: ${(_exhaustive as { backend: string }).backend}`,
      );
    }
  }
}
