import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/app.js';
import { makeAuthFixture } from './helpers.js';

describe('GET /health', () => {
  it('returns ok without authentication (Seq 1 client probe)', async () => {
    const fx = await makeAuthFixture();
    const app = buildServer({
      tokenVerifier: fx.tokenVerifier,
      principalSigner: fx.principalSigner,
      upstreams: { vaultRouter: 'http://x', forgeRegistry: 'http://y', events: 'http://z' },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'horus-service' });
    await app.close();
  });

  it('exposes /metrics without authentication', async () => {
    const fx = await makeAuthFixture();
    const app = buildServer({
      tokenVerifier: fx.tokenVerifier,
      principalSigner: fx.principalSigner,
      upstreams: { vaultRouter: 'http://x', forgeRegistry: 'http://y', events: 'http://z' },
    });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('horus_service_requests_total');
    await app.close();
  });
});
