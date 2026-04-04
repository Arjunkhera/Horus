/**
 * StorageBackend — V2 entity persistence interface for Anvil.
 *
 * This module defines the core abstraction for persisting entities. Implementations
 * manage the dual-write to both the filesystem (markdown + frontmatter) and the
 * SQLite index, keeping them in sync atomically.
 *
 * Concerns explicitly **not** covered by this interface:
 * - Full-text / semantic search (Typesense) — see the search layer
 * - Graph relationships (Neo4j) — see the graph layer
 *
 * @module core/storage/storage-backend
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** Full entity with all metadata, as stored on disk and indexed in SQLite. */
export interface Entity {
  /** Unique identifier (UUID). */
  id: string
  /** Note type (e.g. "task", "note", "journal"). */
  type: string
  /** Human-readable title. */
  title: string
  /** Type-specific frontmatter fields. */
  fields: Record<string, unknown>
  /** Markdown body content. */
  body: string
  /** Timestamp when the entity was first created. */
  created: Date
  /** Timestamp of the most recent modification. */
  modified: Date
  /** Tags associated with the entity. */
  tags: string[]
  /** Relative path to the backing markdown file. */
  filePath: string
}

/** Result returned after a successful create or update operation. */
export interface EntityResult {
  id: string
  type: string
  title: string
  filePath: string
  status: 'created' | 'updated'
}

/** Paginated list of entities. */
export interface EntityList {
  entities: Entity[]
  /** Total number of entities matching the filters (ignoring limit/offset). */
  total: number
  limit: number
  offset: number
}

/**
 * Filters for querying entities.
 *
 * All specified fields are combined with AND semantics.
 * The index signature allows implementations to accept custom field filters
 * beyond the well-known properties listed here.
 */
export interface EntityFilters {
  type?: string
  status?: string
  priority?: string
  /** Tags to match — entities must have ALL specified tags. */
  tags?: string[]
  /** Free-text query matched against title and body. */
  query?: string
  createdAfter?: Date
  createdBefore?: Date
  modifiedAfter?: Date
  modifiedBefore?: Date
  /** Custom field filters. */
  [key: string]: unknown
}

/** Sort specification for list queries. */
export interface SortOptions {
  /** Field name to sort by (e.g. "modified", "title", "created"). */
  field: string
  direction: 'asc' | 'desc'
}

/** Report returned by {@link StorageBackend.rebuild}. */
export interface RebuildReport {
  /** Number of files successfully processed. */
  processed: number
  /** Number of files skipped (e.g. non-markdown, hidden). */
  skipped: number
  /** Number of files that failed to parse or index. */
  failed: number
  /** Per-file error details for failed files. */
  errors: Array<{ file: string; error: string }>
  /** Wall-clock duration of the rebuild in milliseconds. */
  duration: number
}

/** Health check result describing the state of each persistence layer. */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error'
  sqlite: { available: boolean; noteCount?: number }
  filesystem: { available: boolean; path: string }
  details?: string
}

// ---------------------------------------------------------------------------
// Main interface
// ---------------------------------------------------------------------------

/**
 * Core persistence interface for Anvil V2 entities.
 *
 * **Dual-write invariant** — Implementations MUST update both the filesystem
 * (markdown files with YAML frontmatter) and the SQLite index atomically for
 * every mutating operation (`createEntity`, `updateEntity`, `deleteEntity`).
 * If either write fails the operation must roll back so the two stores never
 * diverge.
 *
 * **Separate concerns** — Search indexing (Typesense) and graph relationships
 * (Neo4j) are handled by dedicated layers that subscribe to storage events.
 * They are intentionally excluded from this interface to keep persistence
 * focused and testable.
 *
 * **Recovery** — The {@link rebuild} method reconstructs the SQLite index
 * entirely from the filesystem. Use it after corruption, migration, or when
 * bootstrapping a fresh database from an existing vault directory.
 */
export interface StorageBackend {
  /**
   * Create a new entity.
   *
   * Generates a unique ID, writes the markdown file, and inserts the SQLite row.
   *
   * @param type  - Note type identifier (must exist in the type registry).
   * @param fields - Frontmatter fields (title, status, priority, etc.).
   * @param body   - Markdown body content.
   * @returns Result containing the new entity's id, type, title, filePath, and status.
   */
  createEntity(
    type: string,
    fields: Record<string, unknown>,
    body: string,
  ): Promise<EntityResult>

  /**
   * Update an existing entity.
   *
   * Merges provided fields/body into the existing entity, rewrites the file,
   * and updates the SQLite row.
   *
   * @param id     - Entity UUID.
   * @param fields - Fields to merge (omitted fields are preserved).
   * @param body   - New body content (omit to keep existing).
   */
  updateEntity(
    id: string,
    fields?: Record<string, unknown>,
    body?: string,
  ): Promise<EntityResult>

  /**
   * Delete an entity by ID.
   *
   * Removes both the backing file and the SQLite row.
   *
   * @param id - Entity UUID.
   * @throws If the entity does not exist.
   */
  deleteEntity(id: string): Promise<void>

  /**
   * Retrieve a single entity by ID.
   *
   * @param id - Entity UUID.
   * @returns The full entity.
   * @throws If the entity does not exist.
   */
  getEntity(id: string): Promise<Entity>

  /**
   * List entities with optional filtering, sorting, and pagination.
   *
   * @param filters - Query filters (all conditions are ANDed).
   * @param sort    - Sort field and direction.
   * @param limit   - Maximum number of entities to return (default: 50).
   * @param offset  - Number of entities to skip (default: 0).
   */
  listEntities(
    filters?: EntityFilters,
    sort?: SortOptions,
    limit?: number,
    offset?: number,
  ): Promise<EntityList>

  /**
   * Initialize the storage backend.
   *
   * Called once at startup. Implementations should open database connections,
   * verify the vault directory exists, run migrations, etc.
   */
  initialize(): Promise<void>

  /**
   * Rebuild the SQLite index from the filesystem.
   *
   * Scans every markdown file in the vault, parses frontmatter, and
   * upserts into the database. Use for recovery after corruption or
   * when bootstrapping from an existing vault.
   */
  rebuild(): Promise<RebuildReport>

  /**
   * Check the health of both persistence layers.
   *
   * Returns an aggregate status plus per-layer details.
   */
  healthCheck(): Promise<HealthStatus>
}
