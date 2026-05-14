/**
 * GET /health — liveness + readiness endpoint.
 */

import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/types.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  storage: StorageBackend,
): void {
  app.get('/health', async (_request, reply) => {
    let storageOk = false;
    let storageError: string | undefined;

    try {
      await storage.ping();
      storageOk = true;
    } catch (err) {
      storageError = (err as Error).message;
    }

    const status = storageOk ? 200 : 503;
    return reply.status(status).send({
      status: storageOk ? 'ok' : 'degraded',
      version: process.env['npm_package_version'] ?? 'unknown',
      storage: storageOk ? 'ok' : 'error',
      ...(storageError ? { storageDetail: storageError } : {}),
    });
  });
}
