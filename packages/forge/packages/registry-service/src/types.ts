/**
 * Shared service types for the Forge Registry Service.
 */

/**
 * Roles available within the registry service.
 * - admin: full read + write access
 * - anonymous: read-only access
 */
export type ServiceRole = 'admin' | 'anonymous';

/**
 * Represents a resolved, authenticated service user.
 */
export interface ServiceUser {
  /** Stable user identifier (from config, never the key) */
  userId: string;
  /** Display name */
  name: string;
  /** Role that governs what actions are permitted */
  role: ServiceRole;
}

/**
 * Actions that can be authorized by the auth strategy.
 */
export type ServiceAction = 'publish' | 'read';

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
