/**
 * Entry point: load config, wire dependencies, start the HTTP server.
 */

import { loadConfig } from './config.js';
import { S3StorageBackend } from './storage/s3-backend.js';
import { BuiltinAuthStrategy } from './auth/builtin.js';
import { AuditLog } from './audit/audit-log.js';
import { PublishPipeline } from './pipeline/publish-pipeline.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  // 1. Load and validate config (fails-closed on bad config / missing credentials)
  const config = loadConfig();

  // 2. Create storage backend
  const storage = new S3StorageBackend(config.storage);

  // 3. Create audit log (sqlite)
  const auditLog = new AuditLog(config.dbPath);

  // 4. Create app (before auth bootstrap so the logger is available)
  // We need the Fastify logger for bootstrap messages, so we create a
  // temporary logger-compatible shim here, then replace with the real one.
  const pino = (await import('pino')).default;
  const bootstrapLogger = pino({ level: config.logLevel });

  // 5. Create auth strategy (bootstraps admin keys on first start)
  const auth = new BuiltinAuthStrategy(
    config.dbPath,
    config.auth.admins,
    bootstrapLogger as never, // pino is compatible with FastifyBaseLogger
  );

  // 6. Create publish pipeline
  const pipeline = new PublishPipeline(
    storage,
    auditLog,
    auth,
    config.server.coreVersion,
  );

  // 7. Build Fastify app
  const app = createApp({ config, storage, auth, auditLog, pipeline });

  // 8. Verify storage is reachable before accepting traffic
  try {
    await storage.ping();
    app.log.info('Storage backend is reachable');
  } catch (err) {
    app.log.fatal({ err }, 'Storage backend is unreachable — aborting startup');
    process.exit(1);
  }

  // 9. Start listening
  const { host, port } = config.server;
  await app.listen({ host, port });
  app.log.info({ host, port }, `Forge Registry Service listening`);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Received shutdown signal');
    await app.close();
    auditLog.close();
    if (auth instanceof BuiltinAuthStrategy) {
      auth.close();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
