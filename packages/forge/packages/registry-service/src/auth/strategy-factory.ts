/**
 * Strategy factory — instantiates the correct AuthStrategy based on config.
 *
 * Adding a new strategy in the future requires:
 *   1. Adding its config shape to AuthConfigSchema (config.ts)
 *   2. Implementing AuthStrategy in a new file
 *   3. Adding a case here — zero changes elsewhere in the core service.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { AuthConfig } from '../config.js';
import type { AuthStrategy } from './types.js';
import { BuiltinAuthStrategy } from './builtin.js';
import { WebhookAuthStrategy } from './webhook.js';
import { TrustedHeadersAuthStrategy } from './trusted-headers.js';

/**
 * Create and return the auth strategy specified by `config.auth.strategy`.
 * Throws at startup for any unknown strategy value (fail-fast).
 */
export function createAuthStrategy(
  authConfig: AuthConfig,
  dbPath: string,
  logger: FastifyBaseLogger,
): AuthStrategy {
  switch (authConfig.strategy) {
    case 'builtin':
      return new BuiltinAuthStrategy(dbPath, authConfig.admins, logger);

    case 'webhook':
      return new WebhookAuthStrategy(authConfig);

    case 'trusted-headers':
      return new TrustedHeadersAuthStrategy(authConfig);

    default: {
      // TypeScript exhaustiveness check — this branch is unreachable at
      // compile time, but guards against runtime config drift.
      const _never: never = authConfig;
      throw new Error(
        `Unknown auth strategy '${(_never as { strategy: string }).strategy}'. ` +
          `Valid values are: builtin, webhook, trusted-headers.`,
      );
    }
  }
}
