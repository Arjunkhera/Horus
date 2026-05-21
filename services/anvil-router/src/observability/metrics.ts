/**
 * observability/metrics.ts — Prometheus metrics registry for anvil-router (TA-10).
 *
 * Exports a singleton prom-client Registry with the counters and histograms
 * required by the TA-10 acceptance criteria. The Registry is module-level so
 * that metrics accumulate correctly across requests within a single process.
 *
 * In tests, callers must reset the registry between test suites that care about
 * absolute counter values — or simply assert relative increments.
 *
 * Locked decisions applied:
 *   Cross-cutting concern "Observability" from design proposal b711ce02:
 *     counters: requests_total{method,status}, cache_hits_total, cache_misses_total
 *     histograms: request_duration_ms, upstream_latency_ms
 */

import { Registry, Counter, Histogram } from 'prom-client'

// ---------------------------------------------------------------------------
// Singleton registry — one per process
// ---------------------------------------------------------------------------

export const metricsRegistry = new Registry()

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/** Total inbound requests, labelled by HTTP method and response status code. */
export const requestsTotal = new Counter({
  name: 'anvil_router_requests_total',
  help: 'Total number of inbound requests handled by anvil-router',
  labelNames: ['method', 'status'] as const,
  registers: [metricsRegistry],
})

/** Registry cache hits — Principal → Anvil URL resolved from the in-process TTL cache. */
export const cacheHitsTotal = new Counter({
  name: 'anvil_router_cache_hits_total',
  help: 'Total number of registry lookups resolved from the in-process TTL cache',
  labelNames: [] as const,
  registers: [metricsRegistry],
})

/** Registry cache misses — Principal → Anvil URL not in TTL cache; SQLite queried. */
export const cacheMissesTotal = new Counter({
  name: 'anvil_router_cache_misses_total',
  help: 'Total number of registry lookups that missed the TTL cache and hit SQLite',
  labelNames: [] as const,
  registers: [metricsRegistry],
})

/** Upstream errors — connection-level errors (ECONNREFUSED, ETIMEDOUT, etc.). */
export const upstreamErrorsTotal = new Counter({
  name: 'anvil_router_upstream_errors_total',
  help: 'Total upstream connection-level errors (502/503/504 class)',
  labelNames: ['code'] as const,
  registers: [metricsRegistry],
})

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

/**
 * End-to-end request duration from the point the Fastify handler starts
 * processing to the point the response is sent.
 * Buckets chosen to cover typical HTTP latency ranges (ms).
 */
export const requestDurationMs = new Histogram({
  name: 'anvil_router_request_duration_ms',
  help: 'End-to-end request duration in milliseconds',
  labelNames: ['method', 'status'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [metricsRegistry],
})

/**
 * Latency of the upstream Anvil proxy call (from the moment reply.from() is
 * invoked to the moment the upstream response headers arrive).
 * Same bucket set as requestDurationMs; both are registered here.
 */
export const upstreamLatencyMs = new Histogram({
  name: 'anvil_router_upstream_latency_ms',
  help: 'Upstream Anvil instance proxy latency in milliseconds',
  labelNames: ['method', 'upstream_status'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [metricsRegistry],
})
