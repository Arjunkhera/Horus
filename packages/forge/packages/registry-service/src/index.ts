/**
 * Entry point: load config, wire dependencies, start the HTTP server.
 */

import { loadConfig } from './config.js';
import { createStorageBackend } from './storage/factory.js';
import { BuiltinAuthStrategy } from './auth/builtin.js';
import { createAuthStrategy } from './auth/strategy-factory.js';
import { AuditLog } from './audit/audit-log.js';
import { PublishPipeline } from './pipeline/publish-pipeline.js';
import { RegistrySearchClient } from './search/registry-search.js';
import { RepoSearchClient } from './search/repo-search.js';
import { RepoStorageAdapter, type RepoStorage } from './storage/repo-storage.js';
import { S3RepoStorageAdapter } from './storage/repo-storage-s3.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  // 1. Load and validate config (fails-closed on bad config / missing credentials)
  const config = loadConfig();

  // 2. Create storage backend (S3 or Git, determined by config)
  const storage = createStorageBackend(config);

  // 3. Create audit log (sqlite)
  const auditLog = new AuditLog(config.dbPath);

  // 4. Create app (before auth bootstrap so the logger is available)
  // We need the Fastify logger for bootstrap messages, so we create a
  // temporary logger-compatible shim here, then replace with the real one.
  const pino = (await import('pino')).default;
  const bootstrapLogger = pino({ level: config.logLevel });

  // 5. Create the auth strategy from config (builtin | webhook | trusted-headers |
  // horus-principal). This previously hardcoded BuiltinAuthStrategy, so a configured
  // strategy such as horus-principal was never actually used and all principal-authed
  // writes fell through to deny.
  const auth = createAuthStrategy(
    config.auth,
    config.dbPath,
    bootstrapLogger as never, // pino is compatible with FastifyBaseLogger
  );

  // 6. Create search clients (optional — disabled when Typesense not configured)
  const search = RegistrySearchClient.create(config);
  const tsConfig = config.typesense;
  const repoSearch = tsConfig
    ? RepoSearchClient.create({
        host: tsConfig.host,
        port: tsConfig.port,
        protocol: tsConfig.protocol,
        apiKey: tsConfig.apiKey,
      })
    : null;
  if (search) {
    bootstrapLogger.info('Typesense search is enabled');
  } else {
    bootstrapLogger.info('Typesense search is disabled (FORGE_REGISTRY_TYPESENSE_HOST not set)');
  }

  // 7. Create publish pipeline
  const pipeline = new PublishPipeline(
    storage,
    auditLog,
    auth,
    config.server.coreVersion,
    search ?? undefined,
    { warn: (obj, msg) => bootstrapLogger.warn(obj, msg) },
  );

  // 7b. Create repo storage adapter. The repo registry is SHARED, so it lives in
  // whichever backend the registry is deployed with: S3 for the deployed/shared
  // registry, filesystem for the git/solo-dev backend. Both serve the /repos API.
  const repoStorage: RepoStorage = config.storage.backend === 's3'
    ? new S3RepoStorageAdapter(config.storage)
    : new RepoStorageAdapter(config.storage.localPath);

  // 8. Build Fastify app
  const app = createApp({
    config, storage, auth, auditLog, pipeline,
    search: search ?? undefined,
    repoStorage,
    repoSearch: repoSearch ?? undefined,
  });

  // 9. Verify storage is reachable before accepting traffic
  try {
    await storage.ping();
    app.log.info('Storage backend is reachable');
  } catch (err) {
    app.log.fatal({ err }, 'Storage backend is unreachable — aborting startup');
    process.exit(1);
  }

  // 10. Reconcile the artifact search index from storage on startup. rebuild()
  // idempotently upserts every stored artifact every time, so the index always
  // converges to storage — healing any partial index from a failed publish-time
  // index, regardless of doc count.
  if (search) {
    void search
      .rebuild(storage, {
        info: (msg) => app.log.info(msg),
        warn: (obj, msg) => app.log.warn(obj, msg),
      })
      .catch(() => {
        // rebuild is best-effort; startup continues regardless
      });
  }

  // 10b. Cold rebuild repo search index from storage
  if (repoSearch) {
    void repoStorage
      .listAll()
      .then((repos) => repoSearch.rebuildFromStorage(repos))
      .then((count) => {
        app.log.info(`Repo search cold rebuild complete: indexed ${count} repos`);
      })
      .catch(() => {
        // rebuild is best-effort; startup continues regardless
      });
  }

  // 11. Start listening
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
