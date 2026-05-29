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

export interface AppDeps {
  service: RequestService;
  keys: KeyManager;
  store: Store;
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
    const out = await deps.service.create({
      kind: parsed.data.kind,
      payload: parsed.data.payload,
      tenant: parsed.data.tenant,
      requester: requester(req),
      requesterRole: requesterRole(req),
    });
    return reply.status(201).send(out);
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

  // Public JWKS discovery (verify keys only — the private signing key ships
  // out-of-band as a Secret, never over HTTP).
  app.get('/keys/jwks', async () => ({
    client: deps.keys.clientJwks(),
    internal: deps.keys.internalJwks(),
  }));

  app.get('/health', async () => ({ status: 'ok', service: 'operator-service' }));

  return app;
}
