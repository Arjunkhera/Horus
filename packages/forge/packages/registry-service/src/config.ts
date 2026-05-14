/**
 * Service configuration schema and loader.
 *
 * Config is loaded from:
 *   1. FORGE_REGISTRY_CONFIG env var (path to a YAML file)
 *   2. Individual FORGE_REGISTRY_* env vars as overrides
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const AdminUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const BuiltinAuthConfigSchema = z.object({
  strategy: z.literal('builtin'),
  admins: z.array(AdminUserSchema).min(1),
});

const AuthConfigSchema = z.discriminatedUnion('strategy', [
  BuiltinAuthConfigSchema,
]);

const S3StorageConfigSchema = z.object({
  backend: z.literal('s3'),
  bucket: z.string().min(1),
  region: z.string().default('us-east-1'),
  /** Optional prefix prepended to all object keys */
  prefix: z.string().default(''),
  /**
   * Access key ID — loaded from env, never stored in YAML.
   * Must be provided via FORGE_REGISTRY_S3_ACCESS_KEY_ID.
   */
  accessKeyId: z.string().optional(),
  /**
   * Secret access key — loaded from env, never stored in YAML.
   * Must be provided via FORGE_REGISTRY_S3_SECRET_ACCESS_KEY.
   */
  secretAccessKey: z.string().optional(),
  /** Custom endpoint URL (for localstack / MinIO) */
  endpoint: z.string().url().optional(),
  /** Force path style for S3 SDK (required for MinIO) */
  forcePathStyle: z.boolean().default(false),
});

const StorageConfigSchema = z.discriminatedUnion('backend', [
  S3StorageConfigSchema,
]);

const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(3000),
  /** Current forge/core version — used for compatibility checks */
  coreVersion: z.string().default('0.1.0'),
});

const TypesenseConfigSchema = z.object({
  /** Typesense host (e.g., "localhost" or "typesense.example.com") */
  host: z.string().min(1),
  /** Typesense port (default: 8108) */
  port: z.number().int().min(1).max(65535).default(8108),
  /** Protocol: "http" or "https" */
  protocol: z.enum(['http', 'https']).default('http'),
  /**
   * Typesense API key — loaded from env, never stored in YAML.
   * Must be provided via FORGE_REGISTRY_TYPESENSE_API_KEY.
   */
  apiKey: z.string().min(1),
});

export const ServiceConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  storage: StorageConfigSchema,
  auth: AuthConfigSchema,
  /** Path to sqlite db file for auth keys and audit log */
  dbPath: z.string().default('/tmp/forge-registry.db'),
  /** Minimum log level: fatal | error | warn | info | debug | trace */
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Optional Typesense config — search is disabled when absent */
  typesense: TypesenseConfigSchema.optional(),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type RegistryConfig = ServiceConfig;
export type TypesenseConfig = z.infer<typeof TypesenseConfigSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type BuiltinAuthConfig = z.infer<typeof BuiltinAuthConfigSchema>;
export type S3StorageConfig = z.infer<typeof S3StorageConfigSchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load service config from a YAML file + env var overrides.
 *
 * Env vars take precedence over file values.
 * S3 credentials are ONLY accepted from env vars — never from config files.
 *
 * @throws if config is invalid or S3 credentials are missing at runtime
 */
export function loadConfig(): ServiceConfig {
  const configPath = process.env['FORGE_REGISTRY_CONFIG'];
  let raw: Record<string, unknown> = {};

  if (configPath) {
    try {
      const content = readFileSync(configPath, 'utf8');
      raw = parseYaml(content) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to load config from '${configPath}': ${(err as Error).message}`,
      );
    }
  }

  // Env overrides ─────────────────────────────────────────────────────────
  const server: Record<string, unknown> = {
    ...((raw['server'] as Record<string, unknown>) ?? {}),
  };
  if (process.env['FORGE_REGISTRY_HOST']) server['host'] = process.env['FORGE_REGISTRY_HOST'];
  if (process.env['FORGE_REGISTRY_PORT']) server['port'] = parseInt(process.env['FORGE_REGISTRY_PORT'], 10);
  if (process.env['FORGE_REGISTRY_CORE_VERSION']) server['coreVersion'] = process.env['FORGE_REGISTRY_CORE_VERSION'];

  // S3 credentials — only from env, strip from any raw yaml value
  const storage = (raw['storage'] as Record<string, unknown> | undefined) ?? {};
  if (storage['accessKeyId']) delete storage['accessKeyId'];
  if (storage['secretAccessKey']) delete storage['secretAccessKey'];

  // Inject credentials from env
  const s3Config: Record<string, unknown> = { ...storage };
  if (process.env['FORGE_REGISTRY_S3_BUCKET']) s3Config['bucket'] = process.env['FORGE_REGISTRY_S3_BUCKET'];
  if (process.env['FORGE_REGISTRY_S3_REGION']) s3Config['region'] = process.env['FORGE_REGISTRY_S3_REGION'];
  if (process.env['FORGE_REGISTRY_S3_PREFIX']) s3Config['prefix'] = process.env['FORGE_REGISTRY_S3_PREFIX'];
  if (process.env['FORGE_REGISTRY_S3_ENDPOINT']) s3Config['endpoint'] = process.env['FORGE_REGISTRY_S3_ENDPOINT'];
  if (process.env['FORGE_REGISTRY_S3_FORCE_PATH_STYLE']) {
    s3Config['forcePathStyle'] = process.env['FORGE_REGISTRY_S3_FORCE_PATH_STYLE'] === 'true';
  }

  // Inject credentials last so file values can never override
  if (process.env['FORGE_REGISTRY_S3_ACCESS_KEY_ID']) {
    s3Config['accessKeyId'] = process.env['FORGE_REGISTRY_S3_ACCESS_KEY_ID'];
  }
  if (process.env['FORGE_REGISTRY_S3_SECRET_ACCESS_KEY']) {
    s3Config['secretAccessKey'] = process.env['FORGE_REGISTRY_S3_SECRET_ACCESS_KEY'];
  }

  const combined: Record<string, unknown> = {
    ...raw,
    server,
    storage: s3Config,
  };

  if (process.env['FORGE_REGISTRY_DB_PATH']) combined['dbPath'] = process.env['FORGE_REGISTRY_DB_PATH'];
  if (process.env['FORGE_REGISTRY_LOG_LEVEL']) combined['logLevel'] = process.env['FORGE_REGISTRY_LOG_LEVEL'];

  // Typesense config — all from env, host required to enable
  if (process.env['FORGE_REGISTRY_TYPESENSE_HOST']) {
    const tsConfig: Record<string, unknown> = {
      ...((raw['typesense'] as Record<string, unknown>) ?? {}),
      host: process.env['FORGE_REGISTRY_TYPESENSE_HOST'],
    };
    if (process.env['FORGE_REGISTRY_TYPESENSE_PORT']) {
      tsConfig['port'] = parseInt(process.env['FORGE_REGISTRY_TYPESENSE_PORT'], 10);
    }
    if (process.env['FORGE_REGISTRY_TYPESENSE_PROTOCOL']) {
      tsConfig['protocol'] = process.env['FORGE_REGISTRY_TYPESENSE_PROTOCOL'];
    }
    if (process.env['FORGE_REGISTRY_TYPESENSE_API_KEY']) {
      tsConfig['apiKey'] = process.env['FORGE_REGISTRY_TYPESENSE_API_KEY'];
    }
    combined['typesense'] = tsConfig;
  }

  const result = ServiceConfigSchema.safeParse(combined);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid service configuration:\n${issues}`);
  }

  const config = result.data;

  // Fail-closed: S3 credentials must be present at startup
  if (config.storage.backend === 's3') {
    const s3 = config.storage;
    if (!s3.accessKeyId || !s3.secretAccessKey) {
      // Allow missing credentials only when a custom endpoint is set (e.g., localstack with no-auth mode)
      // In production, credentials are mandatory.
      if (!s3.endpoint) {
        throw new Error(
          'S3 credentials are required. Set FORGE_REGISTRY_S3_ACCESS_KEY_ID and ' +
            'FORGE_REGISTRY_S3_SECRET_ACCESS_KEY environment variables.',
        );
      }
    }
  }

  return config;
}
