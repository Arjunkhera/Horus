/**
 * TrustedHeadersAuthStrategy — reads pre-authenticated user identity
 * from HTTP headers set by a trusted reverse proxy.
 *
 * NOTE: This is a stub. Full implementation is delivered in story 1c.3.
 */

import type { FastifyRequest } from 'fastify';
import type { AuthDecision, AuthStrategy } from './types.js';
import type { ServiceAction, ServiceResource, ServiceUser } from '../types.js';
import type { TrustedHeadersAuthConfig } from '../config.js';

export class TrustedHeadersAuthStrategy implements AuthStrategy {
  constructor(_config: TrustedHeadersAuthConfig) {
    // Will be wired up in 1c.3
  }

  async identify(_request: FastifyRequest): Promise<ServiceUser | null> {
    throw new Error('TrustedHeadersAuthStrategy.identify: not implemented (story 1c.3)');
  }

  authorize(
    _user: ServiceUser | null,
    _action: ServiceAction,
    _resource: ServiceResource,
  ): AuthDecision {
    throw new Error('TrustedHeadersAuthStrategy.authorize: not implemented (story 1c.3)');
  }
}
