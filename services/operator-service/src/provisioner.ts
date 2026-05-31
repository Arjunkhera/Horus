/**
 * Idempotent, resumable Provisioner (§F). Reconciles a Request by running its
 * kind's ordered steps with "ensure" (create-if-absent) semantics. Each step's
 * completion is recorded in the request's `steps` ledger and persisted, so a
 * `failed` retry re-enters here and SKIPS already-completed steps.
 *
 * Structured errors (CollisionError, ConfigError) are saved to req.error AND
 * re-thrown so the call-site (app.ts) can return a precise HTTP status code.
 * Non-structured errors are only saved to req.error (request stays `failed`).
 */

import { type ProvisioningRequest, type RequestKind, terminalSuccess } from './model.js';
import type { Store } from './store.js';
import { CollisionError, ConfigError } from './infra-k8s.js';
import { InMemoryCollisionError } from './infra.js';

export interface Step {
  name: string;
  ensure: () => Promise<void>;
}

export interface KindHandler {
  steps: (req: ProvisioningRequest) => Step[];
}

export type HandlerMap = Partial<Record<RequestKind, KindHandler>>;

export class Provisioner {
  constructor(
    private readonly store: Store,
    private readonly handlers: HandlerMap,
  ) {}

  async reconcile(id: string): Promise<ProvisioningRequest> {
    const req = this.store.getRequest(id);
    if (!req) throw new Error(`No such request: ${id}`);
    if (!['approved', 'failed', 'provisioning'].includes(req.status)) {
      throw new Error(`Request ${id} is not reconcilable from status "${req.status}"`);
    }

    const handler = this.handlers[req.kind];
    req.status = 'provisioning';
    req.error = null;
    this.store.saveRequest(req);

    if (!handler) {
      req.status = 'failed';
      req.error = `No handler registered for kind "${req.kind}"`;
      this.store.saveRequest(req);
      return req;
    }

    for (const step of handler.steps(req)) {
      if (req.steps[step.name]) continue; // idempotent resume: skip completed steps
      try {
        await step.ensure();
        req.steps[step.name] = true;
        this.store.saveRequest(req); // persist partial progress for resumability
      } catch (err) {
        req.status = 'failed';
        req.error = err instanceof Error ? err.message : String(err);
        this.store.saveRequest(req);
        this.store.audit('provisioner', 'request.failed', `${id}:${step.name}:${req.error}`);
        // Re-throw structured errors so the HTTP layer can map them to precise
        // status codes (409 for collisions, 400/500 for config errors).
        // The request is already persisted in `failed` state above.
        if (err instanceof CollisionError || err instanceof ConfigError || err instanceof InMemoryCollisionError) throw err;
        return req;
      }
    }

    req.status = terminalSuccess(req.kind);
    this.store.saveRequest(req);
    this.store.audit('provisioner', 'request.provisioned', id);
    return req;
  }
}
