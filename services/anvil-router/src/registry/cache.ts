/**
 * TtlCache — generic in-process TTL cache.
 *
 * Entries are stored with an expiry timestamp; reads that encounter an expired
 * entry return undefined (lazy eviction). There is no active background sweep.
 *
 * Time checks use Date.now() so vi.useFakeTimers / vi.advanceTimersByTime work
 * in tests without any additional setup.
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, CacheEntry<V>>();
  private readonly ttlMs: number;

  /**
   * @param ttlMs Time-to-live in milliseconds (e.g. 60_000 for 60 seconds).
   */
  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /**
   * Returns the cached value, or undefined if the key is absent or expired.
   * Expired entries are lazily removed on access.
   */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Stores a value under key with a fresh TTL window.
   */
  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Removes a single entry regardless of TTL.
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Removes all entries.
   */
  clear(): void {
    this.store.clear();
  }
}
