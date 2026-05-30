/** Request lifecycle service: create → (admin auto-approve) → reconcile. */

import { randomUUID } from 'node:crypto';
import {
  type ProvisioningRequest,
  type RequestKind,
  canTransition,
  InvalidTransitionError,
} from './model.js';
import { Provisioner, type HandlerMap } from './provisioner.js';
import type { Store } from './store.js';

export interface CreateRequestInput {
  kind: RequestKind;
  payload: Record<string, unknown>;
  requester: string;
  tenant: string;
  /** 'admin' requests are auto-approved (solo-alpha policy dial). */
  requesterRole: string;
}

export class RequestService {
  private readonly provisioner: Provisioner;

  constructor(
    private readonly store: Store,
    handlers: HandlerMap,
  ) {
    this.provisioner = new Provisioner(store, handlers);
  }

  async create(input: CreateRequestInput): Promise<ProvisioningRequest> {
    const now = new Date().toISOString();
    const req: ProvisioningRequest = {
      id: randomUUID(),
      kind: input.kind,
      payload: input.payload,
      requester: input.requester,
      tenant: input.tenant,
      status: 'pending',
      decision: null,
      decidedBy: null,
      error: null,
      steps: {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertRequest(req);
    this.store.audit(input.requester, 'request.created', `${req.kind}:${req.id}`);

    if (input.requesterRole === 'admin') {
      return this.approve(req.id, input.requester);
    }
    return req;
  }

  async approve(id: string, decidedBy: string): Promise<ProvisioningRequest> {
    const req = this.requireRequest(id);
    if (!canTransition(req.status, 'approved')) {
      throw new InvalidTransitionError(req.status, 'approved');
    }
    req.status = 'approved';
    req.decision = 'approved';
    req.decidedBy = decidedBy;
    this.store.saveRequest(req);
    this.store.audit(decidedBy, 'request.approved', id);
    return this.provisioner.reconcile(id);
  }

  reject(id: string, decidedBy: string): ProvisioningRequest {
    const req = this.requireRequest(id);
    if (!canTransition(req.status, 'rejected')) {
      throw new InvalidTransitionError(req.status, 'rejected');
    }
    req.status = 'rejected';
    req.decision = 'rejected';
    req.decidedBy = decidedBy;
    this.store.saveRequest(req);
    this.store.audit(decidedBy, 'request.rejected', id);
    return req;
  }

  /** Resume a failed request (idempotent — skips completed steps). */
  async retry(id: string): Promise<ProvisioningRequest> {
    return this.provisioner.reconcile(id);
  }

  get(id: string): ProvisioningRequest | null {
    return this.store.getRequest(id);
  }

  list(): ProvisioningRequest[] {
    return this.store.listRequests();
  }

  private requireRequest(id: string): ProvisioningRequest {
    const req = this.store.getRequest(id);
    if (!req) throw new Error(`No such request: ${id}`);
    return req;
  }
}

/**
 * §H bootstrap admin: on first boot create a single admin user flagged
 * mustRotate=true. Idempotent — never overwrites an existing admin.
 */
export function ensureBootstrapAdmin(store: Store, adminId: string, tenant: string): boolean {
  if (store.getUser(adminId)) return false;
  store.upsertUser({
    userId: adminId,
    tenant,
    role: 'admin',
    assignedVaults: [],
    mustRotate: true,
    createdAt: new Date().toISOString(),
  });
  store.audit('operator-service', 'bootstrap-admin.created', adminId);
  return true;
}
