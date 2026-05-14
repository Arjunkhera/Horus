/**
 * WebhookAuthStrategy — delegates identity resolution and authorization
 * to an external HTTP webhook.
 *
 * NOTE: This is a stub. Full implementation is delivered in story 1c.2.
 */

import type { FastifyRequest } from 'fastify';
import type { AuthDecision, AuthStrategy } from './types.js';
import type { ServiceAction, ServiceResource, ServiceUser } from '../types.js';
import type { WebhookAuthConfig } from '../config.js';

export class WebhookAuthStrategy implements AuthStrategy {
  constructor(_config: WebhookAuthConfig) {
    // Will be wired up in 1c.2
  }

  async identify(_request: FastifyRequest): Promise<ServiceUser | null> {
    throw new Error('WebhookAuthStrategy.identify: not implemented (story 1c.2)');
  }

  authorize(
    _user: ServiceUser | null,
    _action: ServiceAction,
    _resource: ServiceResource,
  ): AuthDecision {
    throw new Error('WebhookAuthStrategy.authorize: not implemented (story 1c.2)');
  }
}
