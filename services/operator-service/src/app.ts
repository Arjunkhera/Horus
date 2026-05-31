/**
 * operator-service admin API. ClusterIP + `kubectl port-forward` only — NO
 * ingress (ADR-0004 privilege boundary). Identity is taken from headers set by
 * the trusted port-forward caller (the `horus operator` CLI).
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequestService } from './service.js';
import { KeyManager } from './keys.js';
import type { Store } from './store.js';
import type { ClientTokenMinter } from './tokens.js';
import { CollisionError, ConfigError } from './infra-k8s.js';
import { InMemoryCollisionError } from './infra.js';

export interface AppDeps {
  service: RequestService;
  keys: KeyManager;
  store: Store;
  mintClientToken: ClientTokenMinter;
  /** TTL for the initial client token placed in the bundle. Default 24h. */
  initialTokenTtlSeconds?: number;
}

const createRequestSchema = z.object({
  kind: z.enum(['onboard', 'vault_create', 'vault_attach', 'vault_delete', 'teardown']),
  payload: z.record(z.unknown()).default({}),
  tenant: z.string().min(1),
});

function requester(req: FastifyRequest): string {
  const v = req.headers['x-operator-user'];
  return typeof v === 'string' ? v : 'admin';
}

function requesterRole(req: FastifyRequest): string {
  const v = req.headers['x-operator-role'];
  return typeof v === 'string' ? v : 'admin';
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post('/requests', async (req, reply) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    try {
      const out = await deps.service.create({
        kind: parsed.data.kind,
        payload: parsed.data.payload,
        tenant: parsed.data.tenant,
        requester: requester(req),
        requesterRole: requesterRole(req),
      });
      return reply.status(201).send(out);
    } catch (err) {
      if (err instanceof CollisionError || err instanceof InMemoryCollisionError) {
        // 409 Conflict — resource is already owned by another vault.
        return reply.status(409).send({
          error: { code: err.code, message: err.message, details: err.details },
        });
      }
      if (err instanceof ConfigError) {
        // 400 Bad Request — owner is not resolvable; caller must supply git_org or
        // the operator must configure GITHUB_OWNER.
        return reply.status(400).send({
          error: { code: 'CONFIG_ERROR', message: err.message },
        });
      }
      throw err; // unexpected — let Fastify's default 500 handler take it
    }
  });

  app.get('/requests', async () => deps.service.list());

  app.get('/requests/:id', async (req, reply) => {
    const r = deps.service.get((req.params as { id: string }).id);
    return r ?? reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'request not found' } });
  });

  app.post('/requests/:id/approve', async (req) =>
    deps.service.approve((req.params as { id: string }).id, requester(req)),
  );
  app.post('/requests/:id/reject', async (req) =>
    deps.service.reject((req.params as { id: string }).id, requester(req)),
  );
  app.post('/requests/:id/retry', async (req) =>
    deps.service.retry((req.params as { id: string }).id),
  );

  app.get('/users', async () => deps.store.listUsers());
  app.delete('/users/:id', async (req) => {
    deps.store.deleteUser((req.params as { id: string }).id);
    return { ok: true };
  });

  // Mint a user's initial client token (signed with the client-facing key so
  // horus-service accepts it). Placed in the pre-provisioned bundle by the CLI.
  const tokenSchema = z.object({ userId: z.string().min(1), ttlSeconds: z.number().int().positive().optional() });
  app.post('/tokens', async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const user = deps.store.getUser(parsed.data.userId);
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'user not found' } });
    }
    const ttl = parsed.data.ttlSeconds ?? deps.initialTokenTtlSeconds ?? 86400;
    const token = await deps.mintClientToken(
      { tenant: user.tenant, user: user.userId, role: user.role },
      ttl,
    );
    deps.store.audit('operator-service', 'token.minted', user.userId);
    return { token, expiresIn: ttl };
  });

  // §H forced bootstrap-admin rotation: clears the mustRotate gate on first login.
  const rotateSchema = z.object({ adminId: z.string().min(1) });
  app.post('/admin/rotate', async (req, reply) => {
    const parsed = rotateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }
    const admin = deps.store.getUser(parsed.data.adminId);
    if (!admin) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'admin not found' } });
    }
    deps.store.upsertUser({ ...admin, mustRotate: false });
    deps.store.audit(admin.userId, 'bootstrap-admin.rotated', admin.userId);
    return { ...admin, mustRotate: false };
  });

  // Public JWKS discovery (verify keys only — the private signing key ships
  // out-of-band as a Secret, never over HTTP).
  app.get('/keys/jwks', async () => ({
    client: deps.keys.clientJwks(),
    internal: deps.keys.internalJwks(),
  }));

  // Principal-wiring export for `horus operator init`. Returns everything the
  // CLI needs to build horus-service-secrets + horus-principal-pub in one call:
  // the client public JWKS, the internal signing PRIVATE key (mints
  // X-Horus-Principal), and the internal PUBLIC jwk (Vault + forge-registry
  // verify against it). Admin-only and reachable ONLY via the cluster-internal
  // port-forward — the NetworkPolicy denies external ingress (ADR-0004), so the
  // private key never crosses the public boundary. This replaces the manual
  // PVC/SQLite extraction documented in the alpha runbook §4.
  app.get('/admin/principal-bundle', async (req, reply) => {
    if (requesterRole(req) !== 'admin') {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'admin role required' } });
    }
    const internalSigningKey = deps.keys.internalSigningKey();
    const internalPublicJwk = deps.keys.internalJwks()[0].publicJwk;
    deps.store.audit(requester(req), 'principal-bundle.exported', 'operator-service');
    return {
      clientJwks: deps.keys.clientJwks(),
      internalSigningKey,
      internalPublicJwk,
    };
  });

  app.get('/health', async () => ({ status: 'ok', service: 'operator-service' }));

  return app;
}
