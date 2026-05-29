import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import replyFrom from '@fastify/reply-from';
import { registerSseProxyRoute } from '../src/index.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('registerSseProxyRoute', () => {
  let upstream: Server;
  let upstreamUrl: string;
  let gateway: FastifyInstance;
  let gatewayUrl: string;

  beforeAll(async () => {
    // Upstream deliberately answers with a non-SSE content-type to prove the
    // gateway forces text/event-stream onto the response.
    upstream = createServer((_req, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('data: one\n\n');
      setTimeout(() => {
        res.write('data: two\n\n');
        res.end();
      }, 10);
    });
    upstreamUrl = await listen(upstream);

    gateway = Fastify();
    await gateway.register(replyFrom);
    registerSseProxyRoute(gateway, {
      url: '/api/v1/events',
      resolveTarget: () => `${upstreamUrl}/events`,
    });
    await gateway.listen({ port: 0, host: '127.0.0.1' });
    const { port } = gateway.server.address() as AddressInfo;
    gatewayUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await gateway.close();
    upstream.close();
  });

  it('forces text/event-stream and streams events through', async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    const text = await res.text();
    expect(text).toContain('data: one');
    expect(text).toContain('data: two');
  });
});
