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
 *
 * Implementing a new strategy requires only this interface.
 * Adding a 4th strategy requires zero changes to the core service —
 * only config.ts (new discriminated union arm) and strategy-factory.ts
 * (new switch case) need updating.
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

  /**
   * Optional cleanup hook called during graceful shutdown.
   * Strategies that hold open file handles or connections should implement this.
   */
  close?(): void;
}
