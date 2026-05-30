/**
 * @horus/router-core — RouterConfig.
 *
 * RouterConfig is passed to the anvil-router at startup. It drives
 * registry lookup, TTL caching, and upstream call timeout behaviour.
 */

// ---------------------------------------------------------------------------
// RouterConfig
// ---------------------------------------------------------------------------

export interface RouterConfig {
  /** Absolute path to the SQLite registry database file. */
  registryDbPath: string;
  /**
   * TTL (in seconds) for in-memory registry cache entries.
   * Set to 0 to disable caching.
   */
  ttlSeconds: number;
  /**
   * Upstream request timeout in milliseconds.
   * Applied to proxied MCP/REST calls to per-user Anvil instances.
   */
  upstreamTimeoutMs: number;
}
