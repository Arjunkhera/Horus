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

/**
 * JWT validation sub-config for TrustedHeadersAuthStrategy.
 *
 * When `enabled` is true the strategy verifies a signed JWT carried in the
 * request before trusting any header claim.  `header` names the header that
 * contains the JWT (defaults to the `user_id` header when absent).
 */
const TrustedHeadersJwtConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** PEM-encoded public key used to verify JWT signatures. */
  publicKey: z.string().min(1).optional(),
  /**
   * Header that carries the JWT.  Defaults to the `headers.user_id` value
   * when omitted so the proxy can put the JWT in the same header as the
   * user-id claim (e.g. a signed `X-User-Id` JWT).
   */
  header: z.string().min(1).optional(),
});

const TrustedHeadersAuthConfigSchema = z.object({
  strategy: z.literal('trusted-headers'),
  headers: z.object({
    /** Header name that carries the caller's user ID (e.g. "X-User-Id"). */
    user_id: z.string().min(1),
    /** Header name that carries the caller's role (e.g. "X-Role"). */
    role: z.string().min(1),
  }),
  jwt: TrustedHeadersJwtConfigSchema.optional(),
});

const WebhookAuthConfigSchema = z.object({
  strategy: z.literal('webhook'),
  webhook: z.object({
    /** URL of the external auth webhook endpoint */
    url: z.string().url(),
    /** Timeout in milliseconds for webhook calls (default: 500ms) */
    timeout_ms: z.number().int().min(1).default(500),
    /**
     * fail_mode controls what happens when the webhook is unreachable or returns
     * a non-2xx response.
     * - 'deny' (default): fail closed — request is denied
     * - 'permit': fail open — request is allowed through (with a warning)
     */
    fail_mode: z.enum(['deny', 'permit']).default('deny'),
    /**
     * enforce_on controls which requests are sent to the webhook.
     * - 'writes' (default): only non-GET/HEAD/OPTIONS requests are checked
     * - 'all': every request goes through the webhook
     */
    enforce_on: z.enum(['writes', 'all']).default('writes'),
    /**
     * Allowlist of header names to forward to the webhook.
     * Use '*' to forward all headers (with a startup warning).
     */
    header_allowlist: z.union([z.array(z.string()), z.literal('*')]).default([]),
  }),
});

/**
 * horus-principal auth — verifies the gateway-minted `X-Horus-Principal` JWT
 * against the shared internal-signing public JWK and derives identity from its
 * claims. Mirrors the Vault principal middleware so both services verify the
 * same token identically. The JWK itself is never stored in YAML; it is
 * resolved from env (HORUS_PRINCIPAL_PUBLIC_JWK / _FILE) by the loader.
 */
const HorusPrincipalAuthConfigSchema = z.object({
  strategy: z.literal('horus-principal'),
  /** Public JWK (internal signing key's public half). Injected from env. */
  publicJwk: z.record(z.unknown()).optional(),
  /** Header carrying the compact principal JWT (default: x-horus-principal). */
  header: z.string().min(1).default('x-horus-principal'),
  /** Clock-skew leeway in seconds applied to exp/nbf validation. */
  leewaySeconds: z.number().int().nonnegative().default(30),
  /**
   * Optional Horus-role → Forge-role overrides. Keys are Horus role strings
   * (matched case-insensitively); values are the target Forge role.
   */
  roleMap: z.record(z.enum(['consumer', 'publisher', 'registry-admin'])).optional(),
});

const AuthConfigSchema = z.discriminatedUnion('strategy', [
  BuiltinAuthConfigSchema,
  TrustedHeadersAuthConfigSchema,
  WebhookAuthConfigSchema,
  HorusPrincipalAuthConfigSchema,
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

const GitStorageConfigSchema = z.object({
  backend: z.literal('git'),
  /** Remote git repository URL to clone and push artifacts into. */
  url: z.string().min(1),
  /**
   * Absolute path to the SSH deploy key file inside the container.
   * Injected via FORGE_REGISTRY_GIT_DEPLOY_KEY_PATH env var.
   * Not stored in YAML — mount the key as a Docker secret or volume.
   */
  deployKeyPath: z.string().optional(),
  /**
   * Absolute path where the registry service will clone the remote repo
   * inside the container (default: /data/registry/git-store).
   */
  localPath: z.string().default('/data/registry/git-store'),
});

const StorageConfigSchema = z.discriminatedUnion('backend', [
  S3StorageConfigSchema,
  GitStorageConfigSchema,
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
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type BuiltinAuthConfig = z.infer<typeof BuiltinAuthConfigSchema>;
export type TrustedHeadersAuthConfig = z.infer<typeof TrustedHeadersAuthConfigSchema>;
export type TrustedHeadersJwtConfig = z.infer<typeof TrustedHeadersJwtConfigSchema>;
export type WebhookAuthConfig = z.infer<typeof WebhookAuthConfigSchema>;
export type HorusPrincipalAuthConfig = z.infer<typeof HorusPrincipalAuthConfigSchema>;
export type S3StorageConfig = z.infer<typeof S3StorageConfigSchema>;
export type GitStorageConfig = z.infer<typeof GitStorageConfigSchema>;

// ---------------------------------------------------------------------------
// Principal public JWK resolution (env only — same contract as Vault)
// ---------------------------------------------------------------------------

/**
 * Resolve the X-Horus-Principal public JWK from the environment. Accepts inline
 * JSON via HORUS_PRINCIPAL_PUBLIC_JWK or a file path via
 * HORUS_PRINCIPAL_PUBLIC_JWK_FILE. Returns undefined when neither is set.
 *
 * These env var names intentionally match services/vault (principal.py) so the
 * same Secret can be mounted into both Vault and Forge.
 */
export function loadPrincipalPublicJwkFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | undefined {
  const inline = env['HORUS_PRINCIPAL_PUBLIC_JWK'];
  if (inline) {
    return JSON.parse(inline) as Record<string, unknown>;
  }
  const path = env['HORUS_PRINCIPAL_PUBLIC_JWK_FILE'];
  if (path) {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load service config from a YAML file + env var overrides.
 *
 * Env vars take precedence over file values.
 * S3 credentials are ONLY accepted from env vars — never from config files.
 * When S3 credentials are absent, the AWS SDK uses the default credential
 * chain (EC2 instance profile, ECS task role, environment variables, etc.).
 *
 * @throws if config is structurally invalid
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

  // Determine which storage backend is active ─────────────────────────────
  const rawStorage = (raw['storage'] as Record<string, unknown> | undefined) ?? {};
  const storageBackend =
    (process.env['FORGE_REGISTRY_STORAGE_BACKEND'] as string | undefined) ??
    (rawStorage['backend'] as string | undefined) ??
    's3';

  let resolvedStorage: Record<string, unknown>;

  if (storageBackend === 'git') {
    // Git backend — credentials (deploy key path) only from env
    const gitConfig: Record<string, unknown> = {
      backend: 'git',
      ...((rawStorage['backend'] === 'git' ? rawStorage : {}) as Record<string, unknown>),
    };
    // Strip any deploy key that may have leaked into the yaml
    delete gitConfig['deployKeyPath'];

    if (process.env['FORGE_REGISTRY_GIT_URL']) {
      gitConfig['url'] = process.env['FORGE_REGISTRY_GIT_URL'];
    }
    if (process.env['FORGE_REGISTRY_GIT_LOCAL_PATH']) {
      gitConfig['localPath'] = process.env['FORGE_REGISTRY_GIT_LOCAL_PATH'];
    }
    // Deploy key path — only from env so credentials stay in the container
    if (process.env['FORGE_REGISTRY_GIT_DEPLOY_KEY_PATH']) {
      gitConfig['deployKeyPath'] = process.env['FORGE_REGISTRY_GIT_DEPLOY_KEY_PATH'];
    }
    resolvedStorage = gitConfig;
  } else {
    // S3 backend (default)
    // Strip credentials from any raw yaml value — only from env
    const s3Raw = rawStorage['backend'] === 's3' ? { ...rawStorage } : {};
    delete (s3Raw as Record<string, unknown>)['accessKeyId'];
    delete (s3Raw as Record<string, unknown>)['secretAccessKey'];

    const s3Config: Record<string, unknown> = { backend: 's3', ...s3Raw };
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
    resolvedStorage = s3Config;
  }

  const combined: Record<string, unknown> = {
    ...raw,
    server,
    storage: resolvedStorage,
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

  // horus-principal auth — inject the public JWK from env (never from YAML).
  const rawAuth = raw['auth'] as Record<string, unknown> | undefined;
  if (rawAuth && rawAuth['strategy'] === 'horus-principal') {
    const auth: Record<string, unknown> = { ...rawAuth };
    const jwk = loadPrincipalPublicJwkFromEnv();
    if (jwk) auth['publicJwk'] = jwk;
    else delete auth['publicJwk']; // strip any JWK that leaked into YAML
    combined['auth'] = auth;
  }

  const result = ServiceConfigSchema.safeParse(combined);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid service configuration:\n${issues}`);
  }

  const config = result.data;

  // S3 credentials are optional — when absent the AWS SDK falls back to the
  // default credential chain (EC2 instance profile, ECS task role, env vars,
  // ~/.aws/credentials, etc.).  Explicit keys are still accepted for local
  // development, LocalStack, and non-EC2 environments.
  //
  // The S3StorageBackend constructor already handles this: it only sets
  // clientConfig.credentials when both accessKeyId and secretAccessKey are
  // present.  No validation is needed here.

  return config;
}
