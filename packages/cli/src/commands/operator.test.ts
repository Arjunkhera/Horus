import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { operatorCommand } from './operator.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];

function mockFetch(responder: (url: string) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: { method?: string; body?: string }) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(responder(u)), { status: 200 });
    }),
  );
}

describe('horus operator user add', () => {
  beforeEach(() => {
    calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('onboards the user, mints a token, and writes a consumable bundle', async () => {
    mockFetch((u) => {
      if (u.endsWith('/requests')) return { status: 'provisioned' };
      if (u.endsWith('/tokens')) return { token: 'MINTED-TKN' };
      return {};
    });
    const dir = mkdtempSync(join(tmpdir(), 'op-add-'));
    const out = join(dir, 'alice.bundle.yaml');
    try {
      await operatorCommand.parseAsync(
        [
          'user', 'add', 'alice',
          '--tenant', 'acme',
          '--cp-url', 'https://cp.example.com',
          '--role', 'user',
          '--vault', 'acme/notes=http://vault-router/vaults/acme/notes',
          '--out', out,
          '--operator-url', 'http://operator',
        ],
        { from: 'user' },
      );

      const onboard = calls.find((c) => c.url.endsWith('/requests'));
      expect(onboard?.body).toMatchObject({
        kind: 'onboard',
        tenant: 'acme',
        payload: { userId: 'alice', role: 'user', assignedVaults: ['acme/notes'] },
      });
      const tokenCall = calls.find((c) => c.url.endsWith('/tokens'));
      expect(tokenCall?.body).toMatchObject({ userId: 'alice' });

      const bundle = parseYaml(readFileSync(out, 'utf8'));
      expect(bundle.control_plane_url).toBe('https://cp.example.com');
      expect(bundle.token_provider).toEqual({ kind: 'static', config: 'MINTED-TKN' });
      expect(bundle.vaults['acme/notes'].endpoint).toBe('http://vault-router/vaults/acme/notes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('horus operator login (forced rotation)', () => {
  beforeEach(() => {
    calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rotates when the bootstrap admin still has mustRotate set', async () => {
    mockFetch((u) => {
      if (u.endsWith('/users')) return [{ userId: 'admin', mustRotate: true }];
      if (u.endsWith('/admin/rotate')) return { userId: 'admin', mustRotate: false };
      return {};
    });
    await operatorCommand.parseAsync(['login', '--operator-url', 'http://operator'], { from: 'user' });
    expect(calls.some((c) => c.url.endsWith('/admin/rotate') && c.method === 'POST')).toBe(true);
  });

  it('does not rotate when mustRotate is already cleared', async () => {
    mockFetch((u) => {
      if (u.endsWith('/users')) return [{ userId: 'admin', mustRotate: false }];
      return {};
    });
    await operatorCommand.parseAsync(['login', '--operator-url', 'http://operator'], { from: 'user' });
    expect(calls.some((c) => c.url.endsWith('/admin/rotate'))).toBe(false);
  });
});
