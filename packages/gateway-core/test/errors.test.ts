import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  buildErrorBody,
  sendError,
  getRequestId,
  UpstreamResolutionError,
} from '../src/index.js';

describe('buildErrorBody', () => {
  it('produces the { error: { code, message, request_id } } envelope', () => {
    const env = buildErrorBody('BAD', 'nope', 'req-1');
    expect(env).toEqual({
      error: { code: 'BAD', message: 'nope', request_id: 'req-1' },
    });
  });

  it('includes retryAfter only when provided', () => {
    expect(buildErrorBody('X', 'y', 'r', 5).error.retryAfter).toBe(5);
    expect(buildErrorBody('X', 'y', 'r').error.retryAfter).toBeUndefined();
  });
});

describe('sendError', () => {
  it('writes the envelope with the given status and sets Retry-After when present', async () => {
    const app = Fastify();
    app.get('/boom', (_req, reply) =>
      sendError(reply, 425, 'NOT_YET_PROVISIONED', 'wait', 'req-9', 30),
    );
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(425);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toEqual({
      error: {
        code: 'NOT_YET_PROVISIONED',
        message: 'wait',
        request_id: 'req-9',
        retryAfter: 30,
      },
    });
    await app.close();
  });
});

describe('getRequestId', () => {
  it('uses the x-request-id header when present', async () => {
    const app = Fastify();
    app.get('/id', (req, reply) => reply.send({ id: getRequestId(req) }));
    const res = await app.inject({
      method: 'GET',
      url: '/id',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.json().id).toBe('abc-123');
    await app.close();
  });

  it('generates a UUID when the header is absent', async () => {
    const app = Fastify();
    app.get('/id', (req, reply) => reply.send({ id: getRequestId(req) }));
    const res = await app.inject({ method: 'GET', url: '/id' });
    expect(res.json().id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await app.close();
  });
});

describe('UpstreamResolutionError', () => {
  it('carries code, status and optional retryAfter', () => {
    const e = new UpstreamResolutionError('REGISTRY_MISS', 'not yet', 425, 30);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('REGISTRY_MISS');
    expect(e.status).toBe(425);
    expect(e.retryAfter).toBe(30);
  });
});
