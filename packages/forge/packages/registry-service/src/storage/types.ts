/**
 * StorageBackend interface for the registry service.
 *
 * Intentionally different from @forge/core's DataAdapter:
 *   - Versioned storage: every write is keyed by (type, id, version)
 *   - Atomic multi-file writes via a bundle map
 *   - Health checking
 *   - Metadata access (for immutability checks without downloading content)
 */

import type { ArtifactType } from '@forge/core';

/**
 * Metadata about a stored artifact version (cheap to fetch).
 */
export interface StoredVersionMeta {
  type: ArtifactType;
  id: string;
  version: string;
  /** Epoch ms when the version was stored */
  publishedAt: number;
  /** Map of filename → sha256 hex */
  checksums: Record<string, string>;
}

/**
 * Rich metadata about a stored artifact version, extended with search fields.
 * Used for the cold-rebuild path.
 */
export interface ArtifactIndexMeta {
  type: ArtifactType;
  id: string;
  version: string;
  /** Display name — from metadata.yaml */
  name?: string;
  /** Description — from metadata.yaml */
  description?: string;
  /** Tags — from metadata.yaml */
  tags?: string[];
  /** Whether the artifact has been verified */
  verified?: boolean;
  /** Epoch ms when stored */
  publishedAt: number;
}

/**
 * A complete bundle ready to be written atomically.
 * Keys are filenames (e.g., "metadata.yaml", "SKILL.md", "manifest.yaml").
 * Values are raw file contents as Buffer or string.
 */
export type BundleFiles = Map<string, Buffer | string>;

/**
 * A complete bundle read from storage.
 * Keys are filenames; values are raw contents as Buffer.
 */
export type StoredBundle = Map<string, Buffer>;

/**
 * Server-side versioned storage backend.
 */
export interface StorageBackend {
  /**
   * Check backend connectivity and availability.
   * @returns true if healthy, throws with diagnostic on failure
   */
  ping(): Promise<boolean>;

  /**
   * Check whether a specific {type, id, version} triple already exists.
   * Used for immutability enforcement before any write.
   */
  exists(type: ArtifactType, id: string, version: string): Promise<boolean>;

  /**
   * Fetch lightweight metadata for a stored version (no content download).
   * Returns null if not found.
   */
  getMeta(type: ArtifactType, id: string, version: string): Promise<StoredVersionMeta | null>;

  /**
   * Atomically write all files in the bundle for a given version.
   * Implementations must ensure that a partial write is not visible to readers.
   *
   * @throws if version already exists (immutability violation)
   * @throws if backend is unreachable
   */
  writeBundle(
    type: ArtifactType,
    id: string,
    version: string,
    files: BundleFiles,
  ): Promise<void>;

  /**
   * Read all files for a stored version.
   * @throws if version does not exist
   */
  readBundle(type: ArtifactType, id: string, version: string): Promise<StoredBundle>;

  /**
   * List all stored versions for a given artifact, sorted descending.
   */
  listVersions(type: ArtifactType, id: string): Promise<string[]>;

  /**
   * Return lightweight metadata for every stored artifact across all types.
   * Used for cold-rebuilding the search index on startup.
   *
   * Implementations may return best-effort data (e.g., name/description parsed
   * from metadata.yaml if available, or left undefined otherwise).
   */
  listAll(): Promise<ArtifactIndexMeta[]>;

  /**
   * Set the verified flag for an artifact-id (not per-version).
   * All current and future versions of this artifact-id inherit the flag.
   */
  setVerified(type: ArtifactType, id: string, verified: boolean): Promise<void>;

  /**
   * Check whether an artifact-id has been verified.
   * Returns false if the artifact-id has no verification record.
   */
  isVerified(type: ArtifactType, id: string): Promise<boolean>;
}
