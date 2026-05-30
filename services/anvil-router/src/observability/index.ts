/**
 * observability/index.ts — public surface for the TA-10 observability module.
 */

export {
  metricsRegistry,
  requestsTotal,
  cacheHitsTotal,
  cacheMissesTotal,
  upstreamErrorsTotal,
  requestDurationMs,
  upstreamLatencyMs,
} from './metrics.js'
export { buildErrorBody, sendError } from './errors.js'
export type { ErrorBody, ErrorEnvelope } from './errors.js'
export { default as observabilityPlugin } from './middleware.js'
export type { ObservabilityPluginOptions, RequestLogEntry, LogCaptureFn } from './middleware.js'
