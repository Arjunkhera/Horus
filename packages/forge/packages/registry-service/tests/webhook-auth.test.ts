/**
 * Tests for WebhookAuthStrategy.
 *
 * Uses vi.stubGlobal to mock the global `fetch` for full control over
 * webhook responses (permit/deny/timeout/5xx) without any real HTTP.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookAuthStrategy } from '../src/auth/webhook.js';
import type { WebhookAuthConfig } from '../src/config.js';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function makeConfig(overrides: Partial<WebhookAuthConfig['webhook']> = {}): WebhookAuthConfig {
  return {
    strategy: 'webhook',
    webhook: {
      url: 'http://auth.internal/decide',
      timeout_ms: 500,
      fail_mode: 'deny',
      enforce_on: 'writes',
      header_allowlist: ['authorization', 'x-forwarded-for'],
      ...overrides,
    },
  };
}

function makeRequest(
  method: string,
  url = '/skills/my-skill/1.0.0',
  headers: Record<string, string> = {},
): FastifyRequest {
  return {
    method,
    url,
    headers: {
      authorization: 'Bearer test-token',
      'x-forwarded-for': '10.0.0.1',
      'x-internal-secret': 'secret',
      ...headers,
    },
  } as unknown as FastifyRequest;
}

/** Build a mock fetch that returns a resolved Response. */
function mockFetchOk(body: object, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

/** Build a mock fetch that returns a non-2xx Response. */
function mockFetchError(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockRejectedValue(new Error('not json')),
  } as unknown as Response);
}

/** Build a mock fetch that times out (AbortError). */
function mockFetchTimeout(): typeof fetch {
  return vi.fn().mockImplementation((_url: string, options: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = options.signal as AbortSignal;
      signal.addEventListener('abort', () => {
        const err = new DOMException('The operation was aborted', 'AbortError');
        reject(err);
      });
    });
  });
}

/** Build a mock fetch that rejects with a network error immediately. */
function mockFetchNetworkError(): typeof fetch {
  return vi.fn().mockRejectedValue(new TypeError('fetch failed'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookAuthStrategy', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ── enforce_on: writes ─────────────────────────────────────────────────────

  describe('enforce_on: writes (default)', () => {
    it('GET request returns null without calling webhook', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig({ enforce_on: 'writes' }), makeLogger());
      const user = await strat.identify(makeRequest('GET'));

      expect(user).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('HEAD request returns null without calling webhook', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig({ enforce_on: 'writes' }), makeLogger());
      const user = await strat.identify(makeRequest('HEAD'));

      expect(user).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('OPTIONS request returns null without calling webhook', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig({ enforce_on: 'writes' }), makeLogger());
      const user = await strat.identify(makeRequest('OPTIONS'));

      expect(user).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POST request calls webhook', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' }));

      const strat = new WebhookAuthStrategy(makeConfig({ enforce_on: 'writes' }), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).not.toBeNull();
      expect(user?.userId).toBe('alice');
    });
  });

  // ── enforce_on: all ────────────────────────────────────────────────────────

  describe('enforce_on: all', () => {
    it('GET request also calls webhook when enforce_on=all', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' }));

      const strat = new WebhookAuthStrategy(makeConfig({ enforce_on: 'all' }), makeLogger());
      const user = await strat.identify(makeRequest('GET'));

      expect(user).not.toBeNull();
      expect(user?.userId).toBe('alice');
      expect(global.fetch).toHaveBeenCalledOnce();
    });
  });

  // ── permit decision ────────────────────────────────────────────────────────

  describe('webhook returns permit', () => {
    it('returns ServiceUser with correct userId and role=admin', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' }),
      );

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).not.toBeNull();
      expect(user?.userId).toBe('alice');
      expect(user?.role).toBe('admin');
    });

    it('maps unknown role to anonymous', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk({ decision: 'permit', user_id: 'bob', role: 'viewer' }),
      );

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user?.role).toBe('anonymous');
    });

    it('uses fallback userId when user_id is absent', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ decision: 'permit' }));

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).not.toBeNull();
      expect(user?.userId).toBe('webhook-anonymous');
    });
  });

  // ── deny decision ──────────────────────────────────────────────────────────

  describe('webhook returns deny', () => {
    it('returns null', async () => {
      vi.stubGlobal('fetch', mockFetchOk({ decision: 'deny', reason: 'forbidden' }));

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).toBeNull();
    });
  });

  // ── timeout ────────────────────────────────────────────────────────────────

  describe('timeout handling', () => {
    it('applies fail_mode=deny on timeout (returns null)', async () => {
      vi.stubGlobal('fetch', mockFetchTimeout());

      const strat = new WebhookAuthStrategy(
        makeConfig({ timeout_ms: 50, fail_mode: 'deny' }),
        makeLogger(),
      );
      const user = await strat.identify(makeRequest('POST'));

      expect(user).toBeNull();
    }, 3000);

    it('applies fail_mode=permit on timeout (returns admin user)', async () => {
      vi.stubGlobal('fetch', mockFetchTimeout());

      const logger = makeLogger();
      const strat = new WebhookAuthStrategy(
        makeConfig({ timeout_ms: 50, fail_mode: 'permit' }),
        logger,
      );
      const user = await strat.identify(makeRequest('POST'));

      expect(user).not.toBeNull();
      expect(user?.role).toBe('admin');
    }, 3000);

    it('logs a timeout warning', async () => {
      vi.stubGlobal('fetch', mockFetchTimeout());

      const logger = makeLogger();
      const strat = new WebhookAuthStrategy(
        makeConfig({ timeout_ms: 50, fail_mode: 'deny' }),
        logger,
      );
      await strat.identify(makeRequest('POST'));

      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const timeoutWarn = warnCalls.find(
        (args) => String(args[0]).includes('timeout') || (args[0] as Record<string,unknown>)['event'] === 'webhook_auth_timeout',
      );
      expect(timeoutWarn).toBeDefined();
    }, 3000);
  });

  // ── non-2xx responses ──────────────────────────────────────────────────────

  describe('non-2xx response', () => {
    it('applies fail_mode=deny on 500', async () => {
      vi.stubGlobal('fetch', mockFetchError(500));

      const strat = new WebhookAuthStrategy(makeConfig({ fail_mode: 'deny' }), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).toBeNull();
    });

    it('applies fail_mode=deny on 403', async () => {
      vi.stubGlobal('fetch', mockFetchError(403));

      const strat = new WebhookAuthStrategy(makeConfig({ fail_mode: 'deny' }), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).toBeNull();
    });

    it('applies fail_mode=permit on 503', async () => {
      vi.stubGlobal('fetch', mockFetchError(503));

      const logger = makeLogger();
      const strat = new WebhookAuthStrategy(
        makeConfig({ fail_mode: 'permit' }),
        logger,
      );
      const user = await strat.identify(makeRequest('POST'));

      expect(user).not.toBeNull();
      expect(user?.role).toBe('admin');
    });

    it('logs a non-2xx warning', async () => {
      vi.stubGlobal('fetch', mockFetchError(500));

      const logger = makeLogger();
      const strat = new WebhookAuthStrategy(makeConfig(), logger);
      await strat.identify(makeRequest('POST'));

      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const non2xxWarn = warnCalls.find(
        (args) => (args[0] as Record<string,unknown>)['event'] === 'webhook_auth_non2xx',
      );
      expect(non2xxWarn).toBeDefined();
    });
  });

  // ── network error ──────────────────────────────────────────────────────────

  describe('network error', () => {
    it('applies fail_mode=deny on network failure', async () => {
      vi.stubGlobal('fetch', mockFetchNetworkError());

      const strat = new WebhookAuthStrategy(makeConfig({ fail_mode: 'deny' }), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).toBeNull();
    });

    it('applies fail_mode=permit on network failure', async () => {
      vi.stubGlobal('fetch', mockFetchNetworkError());

      const strat = new WebhookAuthStrategy(makeConfig({ fail_mode: 'permit' }), makeLogger());
      const user = await strat.identify(makeRequest('POST'));

      expect(user).not.toBeNull();
    });
  });

  // ── header forwarding ──────────────────────────────────────────────────────

  describe('header forwarding', () => {
    it('only forwards allowed headers to webhook', async () => {
      const fetchMock = mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' });
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(
        makeConfig({ header_allowlist: ['authorization'] }),
        makeLogger(),
      );
      await strat.identify(makeRequest('POST', '/skills/x/1.0.0', {
        authorization: 'Bearer abc',
        'x-internal-secret': 'should-not-forward',
        cookie: 'session=xyz',
      }));

      expect(fetchMock).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(fetchMock).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string) as { request: { headers: Record<string, string> } };
      expect(body.request.headers['authorization']).toBe('Bearer abc');
      expect(body.request.headers['x-internal-secret']).toBeUndefined();
      expect(body.request.headers['cookie']).toBeUndefined();
    });

    it('forwards all headers when allowlist is "*"', async () => {
      const fetchMock = mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' });
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(
        makeConfig({ header_allowlist: '*' }),
        makeLogger(),
      );
      await strat.identify(makeRequest('POST', '/skills/x/1.0.0', {
        authorization: 'Bearer abc',
        'x-custom': 'value',
      }));

      const callArgs = vi.mocked(fetchMock).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string) as { request: { headers: Record<string, string> } };
      expect(body.request.headers['authorization']).toBe('Bearer abc');
      expect(body.request.headers['x-custom']).toBe('value');
    });

    it('logs a startup warning when header_allowlist is "*"', () => {
      const logger = makeLogger();
      new WebhookAuthStrategy(makeConfig({ header_allowlist: '*' }), logger);

      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const wildcardWarn = warnCalls.find(
        (args) => (args[0] as Record<string,unknown>)['event'] === 'webhook_auth_header_allowlist_wildcard',
      );
      expect(wildcardWarn).toBeDefined();
    });
  });

  // ── webhook request shape ──────────────────────────────────────────────────

  describe('webhook request shape', () => {
    it('sends X-Forge-Webhook-Version: 1 header', async () => {
      const fetchMock = mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' });
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      await strat.identify(makeRequest('POST'));

      const callArgs = vi.mocked(fetchMock).mock.calls[0];
      const reqHeaders = callArgs[1]!.headers as Record<string, string>;
      expect(reqHeaders['X-Forge-Webhook-Version']).toBe('1');
    });

    it('sends Content-Type: application/json', async () => {
      const fetchMock = mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' });
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      await strat.identify(makeRequest('POST'));

      const callArgs = vi.mocked(fetchMock).mock.calls[0];
      const reqHeaders = callArgs[1]!.headers as Record<string, string>;
      expect(reqHeaders['Content-Type']).toBe('application/json');
    });

    it('includes action, resource, request and metadata fields', async () => {
      const fetchMock = mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' });
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      await strat.identify(makeRequest('POST', '/skills/my-skill/2.0.0'));

      const callArgs = vi.mocked(fetchMock).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string) as {
        action: string;
        resource: { type: string; id: string; version: string };
        request: { method: string; path: string; headers: Record<string, string> };
        metadata: { timestamp: string };
      };
      expect(body.action).toBe('publish');
      expect(body.resource.type).toBe('skills');
      expect(body.resource.id).toBe('my-skill');
      expect(body.resource.version).toBe('2.0.0');
      expect(body.request.method).toBe('POST');
      expect(body.request.path).toBe('/skills/my-skill/2.0.0');
      expect(body.metadata.timestamp).toBeTruthy();
    });

    it('POSTs to configured webhook URL', async () => {
      const fetchMock = mockFetchOk({ decision: 'permit', user_id: 'alice', role: 'admin' });
      vi.stubGlobal('fetch', fetchMock);

      const strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
      await strat.identify(makeRequest('POST'));

      const callArgs = vi.mocked(fetchMock).mock.calls[0];
      expect(callArgs[0]).toBe('http://auth.internal/decide');
    });
  });

  // ── fail_mode startup warnings ─────────────────────────────────────────────

  describe('fail_mode=permit startup warning', () => {
    it('logs a startup warning when fail_mode=permit', () => {
      const logger = makeLogger();
      new WebhookAuthStrategy(makeConfig({ fail_mode: 'permit' }), logger);

      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const permitWarn = warnCalls.find(
        (args) => (args[0] as Record<string,unknown>)['event'] === 'webhook_auth_fail_mode_permit',
      );
      expect(permitWarn).toBeDefined();
    });

    it('does NOT log a startup warning when fail_mode=deny', () => {
      const logger = makeLogger();
      new WebhookAuthStrategy(makeConfig({ fail_mode: 'deny' }), logger);

      const warnCalls = vi.mocked(logger.warn).mock.calls;
      const permitWarn = warnCalls.find(
        (args) => (args[0] as Record<string,unknown>)['event'] === 'webhook_auth_fail_mode_permit',
      );
      expect(permitWarn).toBeUndefined();
    });
  });

  // ── authorize ──────────────────────────────────────────────────────────────

  describe('authorize()', () => {
    const resource = { type: 'skill', id: 'x', version: '1.0.0' };
    let strat: WebhookAuthStrategy;

    beforeEach(() => {
      strat = new WebhookAuthStrategy(makeConfig(), makeLogger());
    });

    it('permits read for null (anonymous) user', () => {
      expect(strat.authorize(null, 'read', resource)).toBe('permit');
    });

    it('denies publish for null (anonymous) user', () => {
      expect(strat.authorize(null, 'publish', resource)).toBe('deny');
    });

    it('permits publish for admin user', () => {
      const admin = { userId: 'alice', name: 'Alice', role: 'admin' as const };
      expect(strat.authorize(admin, 'publish', resource)).toBe('permit');
    });

    it('denies publish for anonymous-role user', () => {
      const anon = { userId: 'bob', name: 'Bob', role: 'anonymous' as const };
      expect(strat.authorize(anon, 'publish', resource)).toBe('deny');
    });

    it('permits read for anonymous-role user', () => {
      const anon = { userId: 'bob', name: 'Bob', role: 'anonymous' as const };
      expect(strat.authorize(anon, 'read', resource)).toBe('permit');
    });
  });
});
