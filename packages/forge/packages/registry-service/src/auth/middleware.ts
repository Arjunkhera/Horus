/**
 * Fastify preHandler hook that runs identify() and attaches the result
 * to request.serviceUser.
 *
 * Authorization (permit/deny) is enforced per-route, not here.
 * This hook is registered globally so every route has access to request.serviceUser.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthStrategy } from './types.js';

export function registerAuthMiddleware(
  app: FastifyInstance,
  strategy: AuthStrategy,
): void {
  app.addHook('preHandler', async (request, _reply) => {
    request.serviceUser = (await strategy.identify(request)) ?? undefined;
  });
}
