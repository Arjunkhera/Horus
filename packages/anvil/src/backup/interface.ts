/**
 * Backup interface — the contract every Anvil backup backend must satisfy.
 *
 * In remote (saas) mode, git-sync is disabled and durability moves to a
 * DB + S3 backup cycle. This interface is the seam between the bootstrap
 * and the concrete backend (NoOp for now; real S3 in a future story).
 *
 * @see NoOpBackup — safe default for local/enterprise mode and alpha scaffolding
 * @see S3Backup   — scaffold impl; full hardening deferred post-alpha
 */
export interface Backup {
  /**
   * Snapshot current state to durable storage.
   *
   * Implementations should capture:
   *  - Neo4j graph data (edges JSON)
   *  - Typesense collection state
   *
   * Must not throw — callers treat failure as non-fatal and log a warning.
   */
  snapshot(): Promise<void>;

  /**
   * Restore state from the most recent durable snapshot.
   *
   * Must not throw — callers treat failure as non-fatal.
   */
  restore(): Promise<void>;
}
