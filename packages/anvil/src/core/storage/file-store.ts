/**
 * FileStore — binary file storage abstraction for Anvil V2.
 *
 * FileStore is intentionally separate from StorageBackend. StorageBackend
 * handles entity metadata CRUD (structured data, queries, indexes), while
 * FileStore handles binary file I/O (streaming large blobs, disk/cloud storage).
 * The two are independently swappable — you can run Postgres + local filesystem,
 * or SQLite + S3, without either layer knowing about the other.
 *
 * MVP implementation: LocalFileStore — stores files on the local filesystem
 * at `data/files/<entityId>/<filename>`. Files are NOT git-synced; they live
 * outside the vault and are local-only in MVP.
 *
 * Future: S3FileStore for cloud deployment, enabling shared storage across
 * instances and horizontal scaling.
 */

import { Readable } from 'node:stream';

/**
 * Metadata returned after successfully storing a file.
 *
 * The `storedPath` is an Anvil-managed path relative to the data root,
 * following the convention `data/files/<entityId>/<filename>`.
 */
export interface StoredFile {
  /** The entity this file belongs to */
  entityId: string;

  /** Original filename (preserved for display and content-type inference) */
  filename: string;

  /** File size in bytes */
  size: number;

  /** MIME type (e.g. "image/png", "application/pdf") */
  mimeType: string;

  /** Anvil-managed storage path: data/files/<entityId>/<filename> */
  storedPath: string;
}

/**
 * FileStore — interface for binary file storage operations.
 *
 * Implementations manage the physical storage of file blobs. This is
 * deliberately decoupled from entity metadata (StorageBackend) so that
 * storage backends can be mixed and matched independently:
 *
 * - **LocalFileStore** (MVP): writes to `data/files/` on the local filesystem.
 *   Files are not git-synced — they are local-only and excluded from vault sync.
 *
 * - **S3FileStore** (future): stores blobs in S3-compatible object storage
 *   for cloud deployments and multi-instance sharing.
 */
export interface FileStore {
  /**
   * Store a file from a source path into Anvil's managed storage.
   *
   * Copies the file at `sourcePath` into Anvil's storage directory,
   * organized under the entity's namespace. The original file is not
   * modified or removed.
   *
   * @param entityId - The entity this file is associated with
   * @param filename - The filename to store under (used in the stored path)
   * @param sourcePath - Absolute path to the source file on disk
   * @returns Metadata about the stored file including its managed path
   */
  store(entityId: string, filename: string, sourcePath: string): Promise<StoredFile>;

  /**
   * Get a readable stream for a stored file.
   *
   * Returns a Node.js Readable stream for the requested file, suitable
   * for piping to responses or other writable streams.
   *
   * @param entityId - The entity that owns the file
   * @param filename - The filename to retrieve
   * @returns A readable stream of the file contents
   * @throws If the file does not exist
   */
  get(entityId: string, filename: string): Promise<Readable>;

  /**
   * Delete all files associated with an entity.
   *
   * Removes the entire file directory for the given entity, including
   * all stored files. This is typically called when an entity is deleted.
   *
   * @param entityId - The entity whose files should be deleted
   */
  delete(entityId: string): Promise<void>;

  /**
   * Check if a specific file exists for an entity.
   *
   * @param entityId - The entity to check
   * @param filename - The filename to look for
   * @returns True if the file exists in storage
   */
  exists(entityId: string, filename: string): Promise<boolean>;
}
