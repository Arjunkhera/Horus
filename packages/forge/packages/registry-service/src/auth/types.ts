/**
 * AuthStrategy interface and related types.
 *
 * The interface is intentionally minimal for Phase A.
 * 1c will add WebhookAuthStrategy and trusted-headers.
 */

import type { FastifyRequest } from 'fastify';
import type { ServiceAction, ServiceResource, ServiceUser } from '../types.js';

export type AuthDecision = 'permit' | 'deny';

/**
 * Pluggable authentication + authorization interface.
 */
export interface AuthStrategy {
  /**
   * Identify the caller from an incoming request.
   * Returns null for anonymous (unauthenticated) callers.
   * Must NEVER throw — return null on any parsing failure.
   */
  identify(request: FastifyRequest): Promise<ServiceUser | null>;

  /**
   * Decide whether the identified user may perform an action on a resource.
   */
  authorize(
    user: ServiceUser | null,
    action: ServiceAction,
    resource: ServiceResource,
  ): AuthDecision;
}
