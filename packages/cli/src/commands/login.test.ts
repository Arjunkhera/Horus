import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultConfig } from '../lib/config.js';
import { runLogin } from './login.js';

function cfg(overrides: Partial<ReturnType<typeof defaultConfig>>) {
  return { ...defaultConfig(), ...overrides };
}

describe('runLogin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('local-only (no control plane) succeeds without contacting anything', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runLogin(cfg({ control_plane_url: '' }));
    expect(result.ok).toBe(true);
    expect(result.deferred).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('defers (non-fatal) when the control plane is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await runLogin(cfg({ control_plane_url: 'https://cp.example.com' }));
    expect(result.ok).toBe(false);
    expect(result.deferred).toBe(true);
  });

  it('authenticates with a static token when the control plane is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = await runLogin(
      cfg({ control_plane_url: 'https://cp.example.com', token_provider: { kind: 'static', config: 'tok-1' } }),
    );
    expect(result.ok).toBe(true);
    expect(result.deferred).toBe(false);
  });

  it('defers when static provider has no token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = await runLogin(
      cfg({ control_plane_url: 'https://cp.example.com', token_provider: { kind: 'static', config: '' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.deferred).toBe(true);
  });

  it('defers oidc login to the control plane', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = await runLogin(
      cfg({ control_plane_url: 'https://cp.example.com', token_provider: { kind: 'oidc', config: 'https://issuer' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.deferred).toBe(true);
  });
});
