/**
 * @horus/router-core — error types.
 *
 * RouteResolutionError is the single error class for all router-level failures.
 * The `code` field drives HTTP status mapping in the router service:
 *
 *   REGISTRY_MISS        → 425 Too Early  (provisioning not complete, safe to retry)
 *   INSTANCE_UNAVAILABLE → 503 Service Unavailable
 *   VALIDATION_ERROR     → 400 Bad Request
 */

// ---------------------------------------------------------------------------
// Error codes (Q4 locked decision: 425 shape lives here)
// ---------------------------------------------------------------------------

export type RouteResolutionCode =
  | 'REGISTRY_MISS'        // Tenant/user not yet in registry (425)
  | 'INSTANCE_UNAVAILABLE' // Instance exists but is not reachable (503)
  | 'VALIDATION_ERROR';    // Input failed schema validation (400)

export interface RouteResolutionErrorOptions {
  /** Seconds the caller should wait before retrying (for 425/503 use-cases). */
  retryAfter?: number;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class RouteResolutionError extends Error {
  readonly code: RouteResolutionCode;
  readonly retryAfter: number | undefined;

  constructor(
    code: RouteResolutionCode,
    message: string,
    opts?: RouteResolutionErrorOptions,
  ) {
    super(message);
    this.name = 'RouteResolutionError';
    this.code = code;
    this.retryAfter = opts?.retryAfter;

    // Restore prototype chain (required when extending Error in TypeScript).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
