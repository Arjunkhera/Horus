import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/app.js';
import { makeAuthFixture } from './helpers.js';

const upstreams = { vaultRouter: 'http://x', forgeRegistry: 'http://y', events: 'http://z' };

describe('fail-closed edge auth', () => {
  it('rejects a protected route with no Authorization → 401 envelope', async () => {
    const fx = await makeAuthFixture();
    const app = buildServer({ ...fx, upstreams });
    const res = await app.inject({ method: 'GET', url: '/api/v1/vault/notes' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(res.json().error.request_id).toBeTruthy();
    await app.close();
  });

  it('rejects an invalid token → 401', async () => {
    const fx = await makeAuthFixture();
    const app = buildServer({ ...fx, upstreams });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vault/notes',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a token from the wrong tenant → 403 TENANT_MISMATCH', async () => {
    const fx = await makeAuthFixture('acme');
    const app = buildServer({ ...fx, upstreams });
    const wrongTenant = await fx.clientAuthHeader({ tenant: 'evil', user: 'm', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vault/notes',
      headers: { authorization: wrongTenant },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('TENANT_MISMATCH');
    await app.close();
  });

  it('echoes an X-Request-ID on responses', async () => {
    const fx = await makeAuthFixture();
    const app = buildServer({ ...fx, upstreams });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-request-id']).toBeTruthy();
    await app.close();
  });
});
