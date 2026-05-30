/**
 * Shared service types for the Forge Registry Service.
 */

/**
 * Roles available within the registry service.
 * - admin: full read + write access (builtin/trusted-headers strategies)
 * - anonymous: read-only access (builtin/trusted-headers strategies)
 *
 * Forge-role vocabulary used by the horus-principal strategy:
 * - registry-admin: full read + write + verify/unverify
 * - publisher: read + publish
 * - consumer: read-only
 */
export type ServiceRole =
  | 'admin'
  | 'anonymous'
  | 'consumer'
  | 'publisher'
  | 'registry-admin';

/**
 * Represents a resolved, authenticated service user.
 */
export interface ServiceUser {
  /** Stable user identifier (from config, or the principal `user` claim) */
  userId: string;
  /** Display name */
  name: string;
  /** Role that governs what actions are permitted */
  role: ServiceRole;
  /** Tenant the caller belongs to (from the X-Horus-Principal `tenant` claim). */
  tenant?: string;
  /** Additional Horus roles carried on the principal (`roles[]` claim). */
  roles?: string[];
  /** Non-standard principal claims (extensions), excluding registered JWT claims. */
  claims?: Record<string, unknown>;
}

/**
 * Actions that can be authorized by the auth strategy.
 */
export type ServiceAction = 'publish' | 'read' | 'verify' | 'unverify';

/**
 * Resource descriptor passed to authorization checks.
 */
export interface ServiceResource {
  type: string;
  id: string;
  version: string;
}

/**
 * Augment Fastify request with optional resolved user.
 */
declare module 'fastify' {
  interface FastifyRequest {
    serviceUser?: ServiceUser;
  }
}
