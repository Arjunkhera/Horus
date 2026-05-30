import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import replyFrom from '@fastify/reply-from';
import { registerRestProxyRoute, UpstreamResolutionError } from '../src/index.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('registerRestProxyRoute', () => {
  let upstream: Server;
  let upstreamUrl: string;
  let gateway: FastifyInstance;
  let gatewayUrl: string;
  let lastUpstreamHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastUpstreamHeaders = req.headers;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, url: req.url, body }));
      });
    });
    upstreamUrl = await listen(upstream);
  });

  afterAll(async () => {
    upstream.close();
  });

  async function buildGateway(resolveTarget: (req: any) => string) {
    gateway = Fastify();
    await gateway.register(replyFrom);
    registerRestProxyRoute(gateway, {
      url: '/api/v1/vault/*',
      resolveTarget,
      rewriteRequestHeaders: (_req, headers) => {
        headers['x-horus-principal'] = 'minted-jwt';
        return headers;
      },
    });
    await gateway.listen({ port: 0, host: '127.0.0.1' });
    const { port } = gateway.server.address() as AddressInfo;
    gatewayUrl = `http://127.0.0.1:${port}`;
  }

  it('proxies method, path-rewrite and body to the resolved upstream', async () => {
    await buildGateway((req) => upstreamUrl + req.url.replace('/api/v1/vault', ''));
    const res = await fetch(`${gatewayUrl}/api/v1/vault/notes/x?q=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hi: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.method).toBe('POST');
    expect(json.url).toBe('/notes/x?q=1');
    expect(JSON.parse(json.body)).toEqual({ hi: true });
    expect(lastUpstreamHeaders['x-horus-principal']).toBe('minted-jwt');
    await gateway.close();
  });

  it('maps an unreachable upstream to a 502 UPSTREAM_UNAVAILABLE envelope', async () => {
    await buildGateway(() => 'http://127.0.0.1:1/dead');
    const res = await fetch(`${gatewayUrl}/api/v1/vault/x`);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(json.error.request_id).toBeTruthy();
    await gateway.close();
  });

  it('maps an UpstreamResolutionError to its status + envelope + Retry-After', async () => {
    await buildGateway(() => {
      throw new UpstreamResolutionError('NOT_YET_PROVISIONED', 'wait', 425, 30);
    });
    const res = await fetch(`${gatewayUrl}/api/v1/vault/x`);
    expect(res.status).toBe(425);
    expect(res.headers.get('retry-after')).toBe('30');
    const json = await res.json();
    expect(json.error.code).toBe('NOT_YET_PROVISIONED');
    await gateway.close();
  });
});
