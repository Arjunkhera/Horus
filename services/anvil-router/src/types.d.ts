/**
 * Fastify type augmentations for anvil-router.
 *
 * Extends FastifyRequest with fields populated by the auth plugin:
 *   - request.principal   — verified Principal (tenant, user, role)
 *   - request.forwardedAuth — raw Authorization header for downstream forwarding
 */

import type { Principal } from '@horus/auth'

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the auth preHandler after successful JWT verification. */
    principal?: Principal
    /**
     * Raw Authorization header value stored for downstream proxy use.
     * Proxy stories TA-5/6/7 read this to forward the token to per-user Anvil instances.
     */
    forwardedAuth?: string
  }
}
