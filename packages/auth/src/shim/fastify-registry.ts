/**
 * Fastify → registry-service integration shim.
 *
 * Maps @horus/auth Principal values to the registry-service ServiceUser shape
 * and provides a Fastify preHandler that attaches the resolved identity to the
 * request object.
 */

import type { Principal, CredentialVerifier } from '../index.js';

/** Matches registry-service ServiceRole: only 'admin' | 'anonymous'. */
type ServiceRole = 'admin' | 'anonymous';

/** Matches registry-service ServiceUser. */
interface ServiceUser {
  userId: string;
  name: string;
  role: ServiceRole;
}

/**
 * Convert a Principal from @horus/auth into a registry-service ServiceUser.
 * Non-admin roles collapse to 'anonymous' (the registry's two-valued ServiceRole).
 */
export function principalToServiceUser(p: Principal): ServiceUser {
  return {
    userId: p.user,
    name: p.user,
    role: p.role === 'admin' ? 'admin' : 'anonymous',
  };
}

/**
 * Build a Fastify preHandler that verifies the Authorization header and, on
 * success, attaches a ServiceUser to `req.serviceUser`.
 *
 * On any failure (missing header, bad token, wrong tenant) the handler leaves
 * `req.serviceUser` undefined and does NOT throw — the downstream route handler
 * is responsible for enforcing authentication requirements.
 */
export function makeAuthPreHandler(
  verifier: CredentialVerifier,
): (req: { headers: Record<string, string | undefined>; serviceUser?: unknown }, reply: unknown) => Promise<void> {
  return async (req) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return;

    try {
      const principal = await verifier.verify(authHeader);
      req.serviceUser = principalToServiceUser(principal);
    } catch {
      // Leave serviceUser undefined — never throw from a preHandler.
    }
  };
}
