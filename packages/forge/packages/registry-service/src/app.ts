/**
 * Fastify application factory.
 *
 * Creates and configures the Fastify instance with all routes and middleware.
 * Does NOT start listening — that is done in index.ts.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { ServiceConfig } from './config.js';
import type { StorageBackend } from './storage/types.js';
import type { AuthStrategy } from './auth/types.js';
import type { AuditLog } from './audit/audit-log.js';
import type { PublishPipeline } from './pipeline/publish-pipeline.js';
import type { RegistrySearchClient } from './search/registry-search.js';
import { registerAuthMiddleware } from './auth/middleware.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPublishRoute } from './routes/publish.js';
import { registerReadRoutes } from './routes/read.js';
import { registerTypeRoutes } from './routes/types.js';
import { registerSearchRoute } from './routes/search.js';
import { registerDepsRoute } from './routes/deps.js';

export interface AppDependencies {
  config: ServiceConfig;
  storage: StorageBackend;
  auth: AuthStrategy;
  auditLog: AuditLog;
  pipeline: PublishPipeline;
  /** Optional — search route is only registered when this is provided */
  search?: RegistrySearchClient;
  /** Name of the active auth strategy — threaded into every audit entry */
  strategyName?: string;
}

export function createApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: {
        // Ensure credentials never appear in logs
        paths: [
          'req.headers.authorization',
          '*.accessKeyId',
          '*.secretAccessKey',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
    },
    disableRequestLogging: false,
  });

  // Auth identification middleware (runs on every request)
  registerAuthMiddleware(app, deps.auth);

  // Routes
  registerHealthRoutes(app, deps.storage);
  registerPublishRoute(app, deps.pipeline);
  registerReadRoutes(app, deps.storage, deps.auditLog, deps.auth, deps.strategyName ?? deps.config.auth.strategy);
  registerTypeRoutes(app);
  if (deps.search) {
    registerSearchRoute(app, deps.search);
  }
  registerDepsRoute(app, deps.storage);

  // Global error handler
  app.setErrorHandler((err, _request, reply) => {
    app.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  // 404 handler
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: 'NOT_FOUND',
      message: 'Route not found',
    });
  });

  return app;
}
