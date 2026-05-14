/**
 * WebhookAuthStrategy — delegates auth decisions to an external HTTP endpoint.
 *
 * On a privileged action the service POSTs a structured request payload to the
 * configured webhook URL and interprets the JSON response to identify the caller.
 *
 * Behaviour summary:
 *   - enforce_on: 'writes' (default) — GET/HEAD/OPTIONS are treated as public reads;
 *     all other methods go through the webhook.
 *   - enforce_on: 'all' — every request calls the webhook.
 *   - Timeout is enforced via AbortController (default 500 ms).
 *   - On timeout or non-2xx: fail_mode is applied (default 'deny').
 *   - fail_mode: 'permit' emits a startup warning and must be explicitly configured.
 *   - No server-side caching — the webhook is expected to cache decisions.
 *   - Authorization uses the role returned by the webhook; service falls back to
 *     'anonymous' when the user is null (anonymous pass-through for public reads).
 *
 * Webhook request shape (POST):
 *   {
 *     action: string,
 *     resource: { type, id, version },
 *     request: { headers: Record<string,string>, method: string, path: string },
 *     metadata: { timestamp: string }
 *   }
 *
 * Webhook response shape:
 *   { decision: 'permit'|'deny', user_id?: string, role?: string, reason?: string }
 */

import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { AuthStrategy } from './types.js';
import type { ServiceAction, ServiceResource, ServiceUser } from '../types.js';
import type { WebhookAuthConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEBHOOK_VERSION_HEADER = 'X-Forge-Webhook-Version';
const WEBHOOK_VERSION = '1';

/** HTTP methods that are considered read-only. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface WebhookRequestPayload {
  action: string;
  resource: ServiceResource;
  request: {
    headers: Record<string, string>;
    method: string;
    path: string;
  };
  metadata: {
    timestamp: string;
  };
}

interface WebhookResponsePayload {
  decision: 'permit' | 'deny';
  user_id?: string;
  role?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter incoming request headers according to the allowlist.
 * When allowlist is '*', all headers are included (with a prior startup warning).
 */
function filterHeaders(
  headers: Record<string, string | string[] | undefined>,
  allowlist: string[] | '*',
): Record<string, string> {
  const out: Record<string, string> = {};
  if (allowlist === '*') {
    for (const [key, val] of Object.entries(headers)) {
      if (val === undefined) continue;
      out[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
    }
    return out;
  }

  const allowed = new Set(allowlist.map((h) => h.toLowerCase()));
  for (const key of allowed) {
    const val = headers[key];
    if (val === undefined) continue;
    out[key] = Array.isArray(val) ? val.join(', ') : val;
  }
  return out;
}

/**
 * Determine whether a request is a read (no auth needed when enforce_on=writes).
 */
function isReadRequest(request: FastifyRequest): boolean {
  return READ_METHODS.has((request.method ?? 'GET').toUpperCase());
}

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

export class WebhookAuthStrategy implements AuthStrategy {
  private readonly config: WebhookAuthConfig['webhook'];
  private readonly logger: FastifyBaseLogger;

  constructor(config: WebhookAuthConfig, logger: FastifyBaseLogger) {
    this.config = config.webhook;
    this.logger = logger;

    // Startup warnings for risky configurations
    if (config.webhook.fail_mode === 'permit') {
      this.logger.warn(
        {
          event: 'webhook_auth_fail_mode_permit',
          webhookUrl: config.webhook.url,
        },
        'webhook-auth: fail_mode=permit is active — webhook failures will ALLOW requests through. ' +
          'This should only be used during development or controlled rollout.',
      );
    }

    if (config.webhook.header_allowlist === '*') {
      this.logger.warn(
        {
          event: 'webhook_auth_header_allowlist_wildcard',
          webhookUrl: config.webhook.url,
        },
        'webhook-auth: header_allowlist="*" — ALL request headers will be forwarded to the webhook. ' +
          'This may leak sensitive data (auth tokens, cookies). Consider using an explicit allowlist.',
      );
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Identify the caller.
   *
   * - If enforce_on=writes and the request is a read, returns a synthetic
   *   anonymous identity immediately (no webhook call).
   * - Otherwise, calls the webhook and maps the response to a ServiceUser.
   * - On any failure (timeout, non-2xx, parse error), applies fail_mode.
   * - Never throws.
   */
  async identify(request: FastifyRequest): Promise<ServiceUser | null> {
    try {
      const enforceOnAll = this.config.enforce_on === 'all';
      if (!enforceOnAll && isReadRequest(request)) {
        // Public read: skip the webhook entirely
        return null;
      }

      return await this.callWebhook(request);
    } catch {
      // identify() must never throw — this is a belt-and-suspenders catch
      this.logger.error(
        { event: 'webhook_auth_unexpected_error' },
        'webhook-auth: unexpected error in identify(); applying fail_mode',
      );
      return this.applyFailMode('unexpected_error');
    }
  }

  /**
   * Authorize an identified (or anonymous) user.
   *
   * The webhook has already embedded the role in the ServiceUser returned by
   * identify(). We use that role here.
   *
   * - null user (anonymous) → permit reads, deny writes.
   * - admin role → permit everything.
   * - any other role → permit reads only.
   */
  authorize(
    user: ServiceUser | null,
    action: ServiceAction,
    _resource: ServiceResource,
  ): AuthDecision {
    if (action === 'read') return 'permit';
    if (user?.role === 'admin') return 'permit';
    return 'deny';
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * POST to the webhook endpoint and parse the response.
   * Returns a ServiceUser on permit, null on deny, or applies fail_mode on error.
   */
  private async callWebhook(request: FastifyRequest): Promise<ServiceUser | null> {
    const startMs = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout_ms);

    const filteredHeaders = filterHeaders(
      request.headers as Record<string, string | string[] | undefined>,
      this.config.header_allowlist,
    );

    const payload: WebhookRequestPayload = {
      action: this.inferAction(request),
      resource: this.inferResource(request),
      request: {
        headers: filteredHeaders,
        method: request.method ?? 'UNKNOWN',
        path: request.url ?? '/',
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    let response: Response;
    try {
      response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_VERSION_HEADER]: WEBHOOK_VERSION,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      const isTimeout = (err as Error)?.name === 'AbortError';

      this.logger.warn(
        {
          event: isTimeout ? 'webhook_auth_timeout' : 'webhook_auth_network_error',
          webhookUrl: this.config.url,
          latencyMs,
          fail_mode: this.config.fail_mode,
          err: isTimeout ? undefined : (err as Error)?.message,
        },
        isTimeout
          ? `webhook-auth: webhook timed out after ${latencyMs}ms; applying fail_mode=${this.config.fail_mode}`
          : `webhook-auth: network error calling webhook; applying fail_mode=${this.config.fail_mode}`,
      );

      return this.applyFailMode(isTimeout ? 'timeout' : 'network_error');
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!response.ok) {
      this.logger.warn(
        {
          event: 'webhook_auth_non2xx',
          webhookUrl: this.config.url,
          status: response.status,
          latencyMs,
          fail_mode: this.config.fail_mode,
        },
        `webhook-auth: webhook returned HTTP ${response.status}; applying fail_mode=${this.config.fail_mode}`,
      );
      return this.applyFailMode('non_2xx');
    }

    let parsed: WebhookResponsePayload;
    try {
      parsed = (await response.json()) as WebhookResponsePayload;
    } catch {
      this.logger.warn(
        {
          event: 'webhook_auth_parse_error',
          webhookUrl: this.config.url,
          latencyMs,
          fail_mode: this.config.fail_mode,
        },
        `webhook-auth: failed to parse webhook response JSON; applying fail_mode=${this.config.fail_mode}`,
      );
      return this.applyFailMode('parse_error');
    }

    const decision = parsed.decision;

    this.logger.info(
      {
        event: 'webhook_auth_decision',
        webhookUrl: this.config.url,
        decision,
        userId: parsed.user_id,
        role: parsed.role,
        reason: parsed.reason,
        latencyMs,
      },
      `webhook-auth: decision=${decision} user=${parsed.user_id ?? 'anonymous'} latency=${latencyMs}ms`,
    );

    if (decision !== 'permit') {
      return null;
    }

    // Map the webhook response to a ServiceUser
    const userId = parsed.user_id ?? 'webhook-anonymous';
    const role = parsed.role === 'admin' ? 'admin' : 'anonymous';

    return {
      userId,
      name: parsed.user_id ?? 'webhook-user',
      role,
    };
  }

  /**
   * Apply fail_mode config.
   * - 'deny' → return null (anonymous, authorization will deny writes)
   * - 'permit' → return a synthetic "permitted" user with anonymous role
   */
  private applyFailMode(
    trigger: 'timeout' | 'network_error' | 'non_2xx' | 'parse_error' | 'unexpected_error',
  ): ServiceUser | null {
    if (this.config.fail_mode === 'permit') {
      this.logger.warn(
        {
          event: 'webhook_auth_fail_mode_permit_triggered',
          trigger,
        },
        `webhook-auth: fail_mode=permit triggered by ${trigger} — request allowed through`,
      );
      return {
        userId: 'fail-open',
        name: 'fail-open',
        role: 'admin',
      };
    }

    // fail_mode === 'deny' (default)
    return null;
  }

  /**
   * Infer the service action from the HTTP method.
   * GET/HEAD/OPTIONS → 'read'; everything else → 'publish'.
   */
  private inferAction(request: FastifyRequest): string {
    return isReadRequest(request) ? 'read' : 'publish';
  }

  /**
   * Extract a best-effort ServiceResource from the request URL.
   * The webhook receives the raw path anyway; this is a convenience hint.
   */
  private inferResource(request: FastifyRequest): ServiceResource {
    // URL pattern: /<type>/<id>/<version>
    const parts = (request.url ?? '/').split('/').filter(Boolean);
    return {
      type: parts[0] ?? 'unknown',
      id: parts[1] ?? 'unknown',
      version: parts[2] ?? 'unknown',
    };
  }
}
