import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AddressInfo } from 'node:net';
import { buildServer } from '../src/app.js';
import { makeAuthFixture, startUpstream, type FakeUpstream, type AuthFixture } from './helpers.js';

describe('principal-normalizing proxy', () => {
  let vault: FakeUpstream;
  let forge: FakeUpstream;
  let fx: AuthFixture;
  let app: ReturnType<typeof buildServer>;
  let baseUrl: string;

  beforeAll(async () => {
    vault = await startUpstream();
    forge = await startUpstream();
    fx = await makeAuthFixture();
    app = buildServer({
      tokenVerifier: fx.tokenVerifier,
      principalSigner: fx.principalSigner,
      upstreams: { vaultRouter: vault.url, forgeRegistry: forge.url, events: vault.url },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    vault.close();
    forge.close();
  });

  it('proxies /api/v1/vault/* with the path rewritten and the raw token stripped', async () => {
    const auth = await fx.clientAuthHeader({ tenant: 'acme', user: 'alice', role: 'admin' });
    const res = await fetch(`${baseUrl}/api/v1/vault/notes/x?q=1`, {
      headers: { authorization: auth },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('/notes/x?q=1');

    // Raw client Authorization must NOT reach the backend.
    expect(vault.lastHeaders['authorization']).toBeUndefined();

    // A minted X-Horus-Principal JWT must reach the backend and verify to alice.
    const minted = vault.lastHeaders['x-horus-principal'] as string;
    expect(minted).toBeTruthy();
    const principal = await fx.internalVerifier.verify(`Bearer ${minted}`);
    expect(principal).toEqual({ tenant: 'acme', user: 'alice', role: 'admin' });

    // X-Request-ID is forwarded downstream.
    expect(vault.lastHeaders['x-request-id']).toBeTruthy();
  });

  it('routes /api/v1/forge/* to the forge upstream', async () => {
    const auth = await fx.clientAuthHeader({ tenant: 'acme', user: 'bob', role: 'user' });
    const res = await fetch(`${baseUrl}/api/v1/forge/artifacts`, {
      headers: { authorization: auth },
    });
    expect(res.status).toBe(200);
    expect(forge.lastUrl).toBe('/artifacts');
    expect(forge.lastHeaders['x-horus-principal']).toBeTruthy();
  });

  it('serves anonymous GET /api/v1/forge/* reads without a token (public community reads)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/forge/artifacts/skill/capture/1.0.0`);
    expect(res.status).toBe(200);
    expect(forge.lastUrl).toBe('/artifacts/skill/capture/1.0.0');
    // No client token → no minted principal is injected downstream.
    expect(forge.lastHeaders['authorization']).toBeUndefined();
    expect(forge.lastHeaders['x-horus-principal']).toBeUndefined();
  });

  it('still requires auth for forge writes (POST without a token → 401)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/forge/artifacts/skill/capture/1.0.0`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('aggregate/status federates remote domains only', async () => {
    const auth = await fx.clientAuthHeader({ tenant: 'acme', user: 'alice', role: 'admin' });
    const res = await fetch(`${baseUrl}/api/v1/aggregate/status`, {
      headers: { authorization: auth },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domains).toEqual({ vault: 'up', forge: 'up' });
    expect(body.principal.user).toBe('alice');
  });
});
