/** Prometheus metrics for horus-service. */
import { Registry, collectDefaultMetrics, Counter } from 'prom-client';
import type { FastifyInstance } from 'fastify';

export function registerMetrics(fastify: FastifyInstance): void {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: 'horus_service_requests_total',
    help: 'Total HTTP requests handled by horus-service',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const route = (request.routeOptions?.url as string | undefined) ?? request.url.split('?')[0];
    requests.inc({
      method: request.method,
      route,
      status: String(reply.statusCode),
    });
  });

  fastify.get('/metrics', async (_request, reply) => {
    void reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
